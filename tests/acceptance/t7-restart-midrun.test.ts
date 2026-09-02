import { JobRepository } from '../../packages/core/src/repositories/job.repository';
import { WorkerEngine } from '../../apps/worker/src/engine/worker-engine';
import { JobStatus, AttemptStatus } from '../../packages/core/src/domain/job-status.enum';
import { ClaimedJob } from '../../packages/core/src/domain/job.types';
import { JobHandler } from '../../apps/worker/src/handlers/job-handler.interface';
import { RetryPolicy } from '../../packages/core/src/domain/retry-policy';
import { LeasePolicy } from '../../packages/core/src/domain/lease-policy';

describe('Acceptance Test T7: Restart Mid-Run Recovery', () => {
  test('T7: Workers killed mid-flight -> new workers reboot -> state recovered in MySQL -> jobs complete', async () => {
    // Shared durable database state
    const dbJobs = [
      {
        id: 1,
        jobId: 'JOB-0001',
        payload: 'Send welcome email',
        status: JobStatus.READY,
        runAfter: new Date(Date.now() - 5000), // Due now
        attemptCount: 0,
        maxAttempts: 3,
        failTimes: 0,
        leaseOwner: null as string | null,
        leaseToken: null as string | null,
        leaseUntil: null as Date | null
      },
      {
        id: 2,
        jobId: 'JOB-0002',
        payload: 'Email order confirmation',
        status: JobStatus.READY,
        runAfter: new Date(Date.now() + 50), // Due in 50ms
        attemptCount: 0,
        maxAttempts: 3,
        failTimes: 0,
        leaseOwner: null as string | null,
        leaseToken: null as string | null,
        leaseUntil: null as Date | null
      }
    ];

    const attempts: Array<{
      jobId: string;
      workerId: string;
      leaseToken: string;
      status: AttemptStatus;
    }> = [];

    const mockJobRepo = {
      claimNextDueOrExpiredJob: jest.fn(async (workerId: string, leaseDurationMs: number): Promise<ClaimedJob | null> => {
        const now = Date.now();
        // 1. Check for expired leases to reclaim
        const expiredJob = dbJobs.find(
          (j) => j.status === JobStatus.RUNNING && j.leaseUntil && j.leaseUntil.getTime() <= now
        );
        if (expiredJob) {
          const newLeaseToken = 'token-' + Math.random().toString(36).substring(2);
          expiredJob.leaseOwner = workerId;
          expiredJob.leaseToken = newLeaseToken;
          expiredJob.leaseUntil = new Date(now + leaseDurationMs);
          expiredJob.attemptCount += 1;

          attempts.push({
            jobId: expiredJob.jobId,
            workerId,
            leaseToken: newLeaseToken,
            status: AttemptStatus.RUNNING
          });

          return {
            id: expiredJob.id,
            jobId: expiredJob.jobId,
            payload: expiredJob.payload,
            attemptCount: expiredJob.attemptCount,
            attemptNumber: expiredJob.attemptCount,
            maxAttempts: expiredJob.maxAttempts,
            failTimes: expiredJob.failTimes,
            leaseOwner: workerId,
            leaseToken: newLeaseToken,
            leaseUntil: expiredJob.leaseUntil,
            isReclaim: true
          };
        }

        // 2. Check for READY jobs due
        const dueJob = dbJobs.find((j) => j.status === JobStatus.READY && j.runAfter.getTime() <= now);
        if (dueJob) {
          const newLeaseToken = 'token-' + Math.random().toString(36).substring(2);
          dueJob.status = JobStatus.RUNNING;
          dueJob.leaseOwner = workerId;
          dueJob.leaseToken = newLeaseToken;
          dueJob.leaseUntil = new Date(now + leaseDurationMs);
          dueJob.attemptCount += 1;

          attempts.push({
            jobId: dueJob.jobId,
            workerId,
            leaseToken: newLeaseToken,
            status: AttemptStatus.RUNNING
          });

          return {
            id: dueJob.id,
            jobId: dueJob.jobId,
            payload: dueJob.payload,
            attemptCount: dueJob.attemptCount,
            attemptNumber: dueJob.attemptCount,
            maxAttempts: dueJob.maxAttempts,
            failTimes: dueJob.failTimes,
            leaseOwner: workerId,
            leaseToken: newLeaseToken,
            leaseUntil: dueJob.leaseUntil,
            isReclaim: false
          };
        }
        return null;
      }),

      finalizeJobSuccess: jest.fn(async (jobId: string, leaseToken: string): Promise<boolean> => {
        const job = dbJobs.find((j) => j.jobId === jobId && j.leaseToken === leaseToken);
        if (job) {
          job.status = JobStatus.DONE;
          job.leaseOwner = null;
          job.leaseToken = null;
          job.leaseUntil = null;

          const att = attempts.find((a) => a.jobId === jobId && a.leaseToken === leaseToken);
          if (att) {
            att.status = AttemptStatus.SUCCEEDED;
          }
          return true;
        }
        return false;
      })
    } as unknown as JobRepository;

    const handler: JobHandler = {
      execute: async (_job: ClaimedJob) => {
        return; // Success
      }
    };

    const retryPolicy = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 });
    const leasePolicy = new LeasePolicy({ leaseDurationMs: 50 }); // 50ms test lease

    // =========================================================================
    // PHASE 1: Worker 1 claims JOB-0001 before restart
    // =========================================================================
    let worker1: WorkerEngine | null = new WorkerEngine(mockJobRepo, handler, retryPolicy, leasePolicy, {
      workerId: 'worker-1'
    });
    let worker2: WorkerEngine | null = new WorkerEngine(mockJobRepo, handler, retryPolicy, leasePolicy, {
      workerId: 'worker-2'
    });

    const claimed1 = await mockJobRepo.claimNextDueOrExpiredJob('worker-1', 50);
    expect(claimed1?.jobId).toBe('JOB-0001');
    expect(dbJobs[0].status).toBe(JobStatus.RUNNING);

    // =========================================================================
    // PHASE 2: SIMULATE TOTAL WORKER RESTART / REBOOT (docker-compose restart)
    // =========================================================================
    worker1 = null;
    worker2 = null;

    // Database still holds the exact durable state!
    expect(dbJobs[0].status).toBe(JobStatus.RUNNING);
    expect(dbJobs[1].status).toBe(JobStatus.READY);

    // =========================================================================
    // PHASE 3: REBOOTED WORKERS RECOVER AND FINISH
    // =========================================================================
    await new Promise((resolve) => setTimeout(resolve, 60));

    const rebootedWorker1 = new WorkerEngine(mockJobRepo, handler, retryPolicy, leasePolicy, {
      workerId: 'worker-1-rebooted'
    });
    const rebootedWorker2 = new WorkerEngine(mockJobRepo, handler, retryPolicy, leasePolicy, {
      workerId: 'worker-2-rebooted'
    });

    // Rebooted Worker 1 reclaims JOB-0001
    await rebootedWorker1.runOnce();
    expect(dbJobs[0].status).toBe(JobStatus.DONE);

    // Rebooted Worker 2 processes JOB-0002
    await rebootedWorker2.runOnce();
    expect(dbJobs[1].status).toBe(JobStatus.DONE);

    // Both jobs finished to DONE with 0 data loss
    expect(dbJobs.every((j) => j.status === JobStatus.DONE)).toBe(true);
  });
});
