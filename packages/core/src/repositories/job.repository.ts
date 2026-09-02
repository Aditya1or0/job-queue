import { Sequelize, QueryTypes, Transaction } from 'sequelize';
import crypto from 'crypto';
import { JobModel } from '../models/job.model';
import { JobAttemptRepository } from './job-attempt.repository';
import { JobEntity, ClaimedJob, CreateJobParams } from '../domain/job.types';
import { JobStatus, AttemptStatus } from '../domain/job-status.enum';
import {
  JobNotFoundError,
  JobNotDeadLetteredError,
  LeaseFenceLostError
} from '../domain/job-errors';

export class JobRepository {
  private readonly attemptRepo: JobAttemptRepository;

  constructor(private readonly sequelize: Sequelize) {
    this.attemptRepo = new JobAttemptRepository(sequelize);
  }

  public async createJob(params: CreateJobParams): Promise<JobEntity> {
    const job = await JobModel.create({
      job_id: params.jobId,
      payload: params.payload,
      status: JobStatus.READY,
      run_after: params.runAfter,
      attempt_count: 0,
      max_attempts: params.maxAttempts ?? 3,
      fail_times: params.failTimes ?? 0
    });
    return job.toEntity();
  }

  public async getJobById(jobId: string): Promise<JobEntity | null> {
    const job = await JobModel.findOne({
      where: { job_id: jobId }
    });
    return job ? job.toEntity() : null;
  }

  public async getAllJobs(statusFilter?: JobStatus): Promise<JobEntity[]> {
    const whereClause = statusFilter ? { status: statusFilter } : {};
    const jobs = await JobModel.findAll({
      where: whereClause,
      order: [
        ['run_after', 'ASC'],
        ['id', 'ASC']
      ]
    });
    return jobs.map((j) => j.toEntity());
  }

  public async getJobCountsByStatus(): Promise<Record<JobStatus, number>> {
    const results = await this.sequelize.query<{ status: JobStatus; count: number }>(
      `SELECT status, COUNT(*) as count FROM jobs GROUP BY status`,
      { type: QueryTypes.SELECT }
    );

    const counts: Record<JobStatus, number> = {
      [JobStatus.READY]: 0,
      [JobStatus.RUNNING]: 0,
      [JobStatus.DONE]: 0,
      [JobStatus.DEAD_LETTER]: 0
    };

    for (const r of results) {
      if (counts[r.status] !== undefined) {
        counts[r.status] = Number(r.count);
      }
    }

    return counts;
  }

  /**
   * First-class Atomic Claim & Reclaim operation using SELECT FOR UPDATE SKIP LOCKED
   * 
   * Generates a fresh lease_token fencing ID.
   * If reclaiming an expired RUNNING job, closes previous attempt as TIMED_OUT.
   * Atomically records new attempt in job_attempts.
   */
  public async claimNextDueOrExpiredJob(
    workerId: string,
    leaseDurationMs: number
  ): Promise<ClaimedJob | null> {
    return await this.sequelize.transaction(async (t: Transaction) => {
      // 1. Lock next eligible candidate without blocking other workers
      const rows = await this.sequelize.query<{
        id: number;
        job_id: string;
        payload: string;
        status: JobStatus;
        attempt_count: number;
        max_attempts: number;
        fail_times: number;
        lease_token: string | null;
      }>(
        `SELECT id, job_id, payload, status, attempt_count, max_attempts, fail_times, lease_token
         FROM jobs
         WHERE (status = :readyStatus AND run_after <= NOW(3))
            OR (status = :runningStatus AND lease_until < NOW(3))
         ORDER BY run_after ASC, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        {
          replacements: {
            readyStatus: JobStatus.READY,
            runningStatus: JobStatus.RUNNING
          },
          type: QueryTypes.SELECT,
          transaction: t
        }
      );

      if (!rows || rows.length === 0) {
        return null;
      }

      const jobRow = rows[0];
      const isReclaim = jobRow.status === JobStatus.RUNNING;

      // 2. If reclaiming, close the previous open attempt as TIMED_OUT
      if (isReclaim) {
        await this.attemptRepo.closePreviousAttemptAsTimedOut(jobRow.job_id, workerId, t);
      }

      // 3. Generate fresh execution fencing token and absolute lease expiration
      const newLeaseToken = crypto.randomUUID();
      const newLeaseUntil = new Date(Date.now() + leaseDurationMs);
      const newAttemptCount = jobRow.attempt_count + 1;
      const attemptNumber = await this.attemptRepo.getNextAttemptNumber(jobRow.job_id, t);

      // 4. Update job record with active ownership and fencing token
      await this.sequelize.query(
        `UPDATE jobs
         SET status = :runningStatus,
             lease_owner = :workerId,
             lease_token = :leaseToken,
             lease_until = :leaseUntil,
             attempt_count = :attemptCount,
             updated_at = NOW(3)
         WHERE id = :id`,
        {
          replacements: {
            runningStatus: JobStatus.RUNNING,
            workerId,
            leaseToken: newLeaseToken,
            leaseUntil: newLeaseUntil,
            attemptCount: newAttemptCount,
            id: jobRow.id
          },
          transaction: t
        }
      );

      // 5. Insert new attempt record
      await this.attemptRepo.recordAttemptStart(
        jobRow.job_id,
        attemptNumber,
        workerId,
        newLeaseToken,
        t
      );

      return {
        id: jobRow.id,
        jobId: jobRow.job_id,
        payload: jobRow.payload,
        attemptCount: newAttemptCount,
        attemptNumber,
        maxAttempts: jobRow.max_attempts,
        failTimes: jobRow.fail_times,
        leaseOwner: workerId,
        leaseToken: newLeaseToken,
        leaseUntil: newLeaseUntil,
        isReclaim
      };
    });
  }

  /**
   * Finalizes successful execution protected by fencing lease_token.
   */
  public async finalizeJobSuccess(jobId: string, leaseToken: string): Promise<boolean> {
    return await this.sequelize.transaction(async (t: Transaction) => {
      const [_, metadata] = await this.sequelize.query(
        `UPDATE jobs
         SET status = :doneStatus,
             completed_at = NOW(3),
             lease_owner = NULL,
             lease_token = NULL,
             lease_until = NULL,
             updated_at = NOW(3)
         WHERE job_id = :jobId AND status = :runningStatus AND lease_token = :leaseToken`,
        {
          replacements: {
            doneStatus: JobStatus.DONE,
            runningStatus: JobStatus.RUNNING,
            jobId,
            leaseToken
          },
          transaction: t
        }
      );

      const affected = (metadata as any)?.affectedRows ?? 0;
      if (affected === 0) {
        throw new LeaseFenceLostError(jobId, leaseToken);
      }

      await this.attemptRepo.finalizeAttempt(
        jobId,
        leaseToken,
        AttemptStatus.SUCCEEDED,
        null,
        t
      );

      return true;
    });
  }

  /**
   * Finalizes failed execution protected by fencing lease_token.
   * Schedules retry with backoff or moves to DEAD_LETTER when exhausted.
   */
  public async finalizeJobFailure(
    jobId: string,
    leaseToken: string,
    errorMessage: string,
    nextRunAfter: Date | null,
    isDeadLetter: boolean
  ): Promise<boolean> {
    return await this.sequelize.transaction(async (t: Transaction) => {
      let query: string;
      let replacements: Record<string, any>;

      if (isDeadLetter) {
        query = `
          UPDATE jobs
          SET status = :deadLetterStatus,
              last_error = :errorMessage,
              lease_owner = NULL,
              lease_token = NULL,
              lease_until = NULL,
              updated_at = NOW(3)
          WHERE job_id = :jobId AND status = :runningStatus AND lease_token = :leaseToken
        `;
        replacements = {
          deadLetterStatus: JobStatus.DEAD_LETTER,
          runningStatus: JobStatus.RUNNING,
          errorMessage,
          jobId,
          leaseToken
        };
      } else {
        query = `
          UPDATE jobs
          SET status = :readyStatus,
              run_after = :nextRunAfter,
              last_error = :errorMessage,
              lease_owner = NULL,
              lease_token = NULL,
              lease_until = NULL,
              updated_at = NOW(3)
          WHERE job_id = :jobId AND status = :runningStatus AND lease_token = :leaseToken
        `;
        replacements = {
          readyStatus: JobStatus.READY,
          runningStatus: JobStatus.RUNNING,
          nextRunAfter,
          errorMessage,
          jobId,
          leaseToken
        };
      }

      const [_, metadata] = await this.sequelize.query(query, {
        replacements,
        transaction: t
      });

      const affected = (metadata as any)?.affectedRows ?? 0;
      if (affected === 0) {
        throw new LeaseFenceLostError(jobId, leaseToken);
      }

      await this.attemptRepo.finalizeAttempt(
        jobId,
        leaseToken,
        AttemptStatus.FAILED,
        errorMessage,
        t
      );

      return true;
    });
  }

  /**
   * Requeues a dead-lettered job.
   * Retains full attempt history while granting a fresh cycle of attempts.
   */
  public async requeueDeadLetterJob(jobId: string): Promise<JobEntity> {
    return await this.sequelize.transaction(async (t: Transaction) => {
      const job = await JobModel.findOne({
        where: { job_id: jobId },
        lock: t.LOCK.UPDATE,
        transaction: t
      });

      if (!job) {
        throw new JobNotFoundError(jobId);
      }

      if (job.status !== JobStatus.DEAD_LETTER) {
        throw new JobNotDeadLetteredError(jobId, job.status);
      }

      await this.sequelize.query(
        `UPDATE jobs
         SET status = :readyStatus,
             run_after = NOW(3),
             attempt_count = 0,
             lease_owner = NULL,
             lease_token = NULL,
             lease_until = NULL,
             last_error = NULL,
             updated_at = NOW(3)
         WHERE job_id = :jobId`,
        {
          replacements: {
            readyStatus: JobStatus.READY,
            jobId
          },
          transaction: t
        }
      );

      await job.reload({ transaction: t });
      return job.toEntity();
    });
  }
}
