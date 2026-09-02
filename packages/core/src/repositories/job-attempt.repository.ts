import { Sequelize, Transaction, QueryTypes } from 'sequelize';
import { JobAttemptEntity } from '../domain/job.types';
import { AttemptStatus } from '../domain/job-status.enum';
import { JobAttemptModel } from '../models/job-attempt.model';

export class JobAttemptRepository {
  constructor(private readonly sequelize: Sequelize) {}

  public async getAttemptsByJobId(jobId: string): Promise<JobAttemptEntity[]> {
    const attempts = await JobAttemptModel.findAll({
      where: { job_id: jobId },
      order: [['attempt_number', 'ASC']]
    });
    return attempts.map((a) => a.toEntity());
  }

  public async getNextAttemptNumber(jobId: string, transaction?: Transaction): Promise<number> {
    const result = await this.sequelize.query<{ maxAttempt: number | null }>(
      `SELECT MAX(attempt_number) as maxAttempt FROM job_attempts WHERE job_id = :jobId`,
      {
        replacements: { jobId },
        type: QueryTypes.SELECT,
        transaction
      }
    );
    const max = result[0]?.maxAttempt ?? 0;
    return max + 1;
  }

  public async recordAttemptStart(
    jobId: string,
    attemptNumber: number,
    workerId: string,
    leaseToken: string,
    transaction?: Transaction
  ): Promise<JobAttemptEntity> {
    const record = await JobAttemptModel.create(
      {
        job_id: jobId,
        attempt_number: attemptNumber,
        worker_id: workerId,
        lease_token: leaseToken,
        started_at: new Date(),
        status: AttemptStatus.RUNNING,
        error_message: null
      },
      { transaction }
    );
    return record.toEntity();
  }

  public async closePreviousAttemptAsTimedOut(
    jobId: string,
    reclaimedByWorkerId: string,
    transaction?: Transaction
  ): Promise<number> {
    const [_, metadata] = await this.sequelize.query(
      `UPDATE job_attempts 
       SET status = :timedOutStatus,
           finished_at = NOW(3),
           error_message = :timeoutMessage,
           updated_at = NOW(3)
       WHERE job_id = :jobId AND status = :runningStatus`,
      {
        replacements: {
          timedOutStatus: AttemptStatus.TIMED_OUT,
          runningStatus: AttemptStatus.RUNNING,
          timeoutMessage: `Lease expired without completion; execution reclaimed by worker '${reclaimedByWorkerId}'`,
          jobId
        },
        transaction
      }
    );
    // In mysql2/Sequelize, affected rows is in metadata
    const affected = (metadata as any)?.affectedRows ?? 0;
    return affected;
  }

  public async finalizeAttempt(
    jobId: string,
    leaseToken: string,
    status: AttemptStatus,
    errorMessage: string | null = null,
    transaction?: Transaction
  ): Promise<boolean> {
    const [_, metadata] = await this.sequelize.query(
      `UPDATE job_attempts 
       SET status = :status,
           finished_at = NOW(3),
           error_message = :errorMessage,
           updated_at = NOW(3)
       WHERE job_id = :jobId AND lease_token = :leaseToken AND status = :runningStatus`,
      {
        replacements: {
          status,
          errorMessage,
          jobId,
          leaseToken,
          runningStatus: AttemptStatus.RUNNING
        },
        transaction
      }
    );
    const affected = (metadata as any)?.affectedRows ?? 0;
    return affected > 0;
  }
}
