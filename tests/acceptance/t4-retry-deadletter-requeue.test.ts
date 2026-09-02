import { JobRepository } from '../../packages/core/src/repositories/job.repository';
import { WorkerEngine } from '../../apps/worker/src/engine/worker-engine';
import { JobStatus, AttemptStatus } from '../../packages/core/src/domain/job-status.enum';
import { ClaimedJob } from '../../packages/core/src/domain/job.types';
import { JobHandler } from '../../apps/worker/src/handlers/job-handler.interface';
import { RetryPolicy } from '../../packages/core/src/domain/retry-policy';
import { LeasePolicy } from '../../packages/core/src/domain/lease-policy';

describe('Acceptance Test T4: Multi-Worker Retries, Dead-Lettering, and Requeue', () => {
  test('T4.1: Worker 1 fails job on Attempt 1 -> Worker 2 picks up Attempt 2 and succeeds', async () => {
    let jobState = {
      id: 3,
      jobId: 'JOB-0003',
      payload: 'Charge customer card',
      status: JobStatus.READY,
      runAfter: new Date(Date.now() - 1000),
      attemptCount: 0,
      maxAttempts: 3,
      failTimes: 1, // Fails once on attempt 1, then succeeds on attempt 2
      leaseOwner: null as string | null,
      leaseToken: null as string | null,
      leaseUntil: null as Date | null,
      lastError: null as string | null
    };

    const attempts: Array<{
      jobId: string;
      attemptNumber: number;
      workerId: string;
      leaseToken: string;
      status: AttemptStatus;
      errorMessage: string | null;
    }> = [];

    const mockJobRepo = {
      claimNextDueOrExpiredJob: jest.fn(async (workerId: string, leaseDurationMs: number): Promise<ClaimedJob | null> => {
        if (jobState.status === JobStatus.READY && jobState.runAfter.getTime() <= Date.now()) {
          const newLeaseToken = 'token-' + Math.random().toString(36).substring(2);
          jobState.status = JobStatus.RUNNING;
          jobState.leaseOwner = workerId;
          jobState.leaseToken = newLeaseToken;
          jobState.leaseUntil = new Date(Date.now() + leaseDurationMs);
          jobState.attemptCount += 1;

          attempts.push({
            jobId: jobState.jobId,
            attemptNumber: jobState.attemptCount,
            workerId,
            leaseToken: newLeaseToken,
            status: AttemptStatus.RUNNING,
            errorMessage: null
          });

          return {
            id: jobState.id,
            jobId: jobState.jobId,
            payload: jobState.payload,
            attemptCount: jobState.attemptCount,
            attemptNumber: jobState.attemptCount,
            maxAttempts: jobState.maxAttempts,
            failTimes: jobState.failTimes,
            leaseOwner: workerId,
            leaseToken: newLeaseToken,
            leaseUntil: jobState.leaseUntil,
            isReclaim: false
          };
        }
        return null;
      }),

      finalizeJobFailure: jest.fn(
        async (
          jobId: string,
          leaseToken: string,
          errorMessage: string,
          nextRunAfter: Date | null,
          isDeadLetter: boolean
        ): Promise<boolean> => {
          if (jobState.jobId === jobId && jobState.leaseToken === leaseToken) {
            jobState.status = isDeadLetter ? JobStatus.DEAD_LETTER : JobStatus.READY;
            jobState.runAfter = nextRunAfter ?? new Date();
            jobState.lastError = errorMessage;
            jobState.leaseOwner = null;
            jobState.leaseToken = null;
            jobState.leaseUntil = null;

            const att = attempts.find((a) => a.jobId === jobId && a.leaseToken === leaseToken);
            if (att) {
              att.status = AttemptStatus.FAILED;
              att.errorMessage = errorMessage;
            }
            return true;
          }
          return false;
        }
      ),

      finalizeJobSuccess: jest.fn(async (jobId: string, leaseToken: string): Promise<boolean> => {
        if (jobState.jobId === jobId && jobState.leaseToken === leaseToken) {
          jobState.status = JobStatus.DONE;
          jobState.leaseOwner = null;
          jobState.leaseToken = null;
          jobState.leaseUntil = null;

          const att = attempts.find((a) => a.jobId === jobId && a.leaseToken === leaseToken);
          if (att) {
            att.status = AttemptStatus.SUCCEEDED;
          }
          return true;
        }
        return false;
      })
    } as unknown as JobRepository;

    // Handler that fails on attempt 1, succeeds on attempt 2
    const handler: JobHandler = {
      execute: async (job: ClaimedJob) => {
        if (job.attemptNumber <= job.failTimes) {
          throw new Error(`Payment Gateway 503 error on attempt ${job.attemptNumber}`);
        }
        return; // Succeeded!
      }
    };

    const retryPolicy = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 });
    const leasePolicy = new LeasePolicy();

    const worker1 = new WorkerEngine(mockJobRepo, handler, retryPolicy, leasePolicy, { workerId: 'worker-1' });
    const worker2 = new WorkerEngine(mockJobRepo, handler, retryPolicy, leasePolicy, { workerId: 'worker-2' });

    // Step 1: Worker 1 runs Attempt 1 -> fails!
    await worker1.runOnce();
    expect(jobState.status).toBe(JobStatus.READY);
    expect(jobState.attemptCount).toBe(1);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].workerId).toBe('worker-1');
    expect(attempts[0].status).toBe(AttemptStatus.FAILED);
    expect(attempts[0].errorMessage).toContain('Payment Gateway 503');

    // Fast-forward retry backoff time
    jobState.runAfter = new Date(Date.now() - 10);

    // Step 2: Worker 2 runs Attempt 2 -> succeeds!
    await worker2.runOnce();
    expect(jobState.status).toBe(JobStatus.DONE);
    expect(jobState.attemptCount).toBe(2);
    expect(attempts).toHaveLength(2);
    expect(attempts[1].workerId).toBe('worker-2');
    expect(attempts[1].status).toBe(AttemptStatus.SUCCEEDED);
  });

  test('T4.2: Job fails across multiple workers -> transitions to DEAD_LETTER -> Requeue resets to READY with full history', async () => {
    let jobState = {
      id: 5,
      jobId: 'JOB-0005',
      payload: 'Sync contact to CRM',
      status: JobStatus.READY,
      runAfter: new Date(Date.now() - 1000),
      attemptCount: 0,
      maxAttempts: 3,
      failTimes: 9, // Always fails
      leaseOwner: null as string | null,
      leaseToken: null as string | null,
      leaseUntil: null as Date | null,
      lastError: null as string | null
    };

    const attempts: Array<{
      jobId: string;
      attemptNumber: number;
      workerId: string;
      leaseToken: string;
      status: AttemptStatus;
      errorMessage: string | null;
    }> = [];

    const mockJobRepo = {
      claimNextDueOrExpiredJob: jest.fn(async (workerId: string, leaseDurationMs: number): Promise<ClaimedJob | null> => {
        if (jobState.status === JobStatus.READY && jobState.runAfter.getTime() <= Date.now()) {
          const newLeaseToken = 'token-' + Math.random().toString(36).substring(2);
          jobState.status = JobStatus.RUNNING;
          jobState.leaseOwner = workerId;
          jobState.leaseToken = newLeaseToken;
          jobState.leaseUntil = new Date(Date.now() + leaseDurationMs);
          jobState.attemptCount += 1;

          attempts.push({
            jobId: jobState.jobId,
            attemptNumber: jobState.attemptCount,
            workerId,
            leaseToken: newLeaseToken,
            status: AttemptStatus.RUNNING,
            errorMessage: null
          });

          return {
            id: jobState.id,
            jobId: jobState.jobId,
            payload: jobState.payload,
            attemptCount: jobState.attemptCount,
            attemptNumber: jobState.attemptCount,
            maxAttempts: jobState.maxAttempts,
            failTimes: jobState.failTimes,
            leaseOwner: workerId,
            leaseToken: newLeaseToken,
            leaseUntil: jobState.leaseUntil,
            isReclaim: false
          };
        }
        return null;
      }),

      finalizeJobFailure: jest.fn(
        async (
          jobId: string,
          leaseToken: string,
          errorMessage: string,
          nextRunAfter: Date | null,
          isDeadLetter: boolean
        ): Promise<boolean> => {
          if (jobState.jobId === jobId && jobState.leaseToken === leaseToken) {
            jobState.status = isDeadLetter ? JobStatus.DEAD_LETTER : JobStatus.READY;
            jobState.runAfter = nextRunAfter ?? new Date();
            jobState.lastError = errorMessage;
            jobState.leaseOwner = null;
            jobState.leaseToken = null;
            jobState.leaseUntil = null;

            const att = attempts.find((a) => a.jobId === jobId && a.leaseToken === leaseToken);
            if (att) {
              att.status = AttemptStatus.FAILED;
              att.errorMessage = errorMessage;
            }
            return true;
          }
          return false;
        }
      ),

      requeueDeadLetterJob: jest.fn(async (jobId: string) => {
        if (jobState.jobId === jobId && jobState.status === JobStatus.DEAD_LETTER) {
          jobState.status = JobStatus.READY;
          jobState.runAfter = new Date();
          jobState.attemptCount = 0;
          jobState.lastError = null;
          return jobState;
        }
        throw new Error('Cannot requeue non-dead-letter job');
      })
    } as unknown as JobRepository;

    const failingHandler: JobHandler = {
      execute: async (job: ClaimedJob) => {
        throw new Error(`CRM endpoint 503 Service Unavailable on attempt ${job.attemptNumber}`);
      }
    };

    const retryPolicy = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 });
    const leasePolicy = new LeasePolicy();

    const worker1 = new WorkerEngine(mockJobRepo, failingHandler, retryPolicy, leasePolicy, { workerId: 'worker-1' });
    const worker2 = new WorkerEngine(mockJobRepo, failingHandler, retryPolicy, leasePolicy, { workerId: 'worker-2' });

    // Attempt 1: Worker 1 claims and fails
    await worker1.runOnce();
    expect(jobState.status).toBe(JobStatus.READY);
    expect(attempts[0].workerId).toBe('worker-1');

    // Fast-forward backoff delay
    jobState.runAfter = new Date(Date.now() - 10);

    // Attempt 2: Worker 2 claims and fails
    await worker2.runOnce();
    expect(jobState.status).toBe(JobStatus.READY);
    expect(attempts[1].workerId).toBe('worker-2');

    // Fast-forward backoff delay
    jobState.runAfter = new Date(Date.now() - 10);

    // Attempt 3: Worker 1 claims and fails -> moves to DEAD_LETTER
    await worker1.runOnce();
    expect(jobState.status).toBe(JobStatus.DEAD_LETTER);
    expect(attempts[2].workerId).toBe('worker-1');

    // Requeue
    await mockJobRepo.requeueDeadLetterJob('JOB-0005');
    expect(jobState.status).toBe(JobStatus.READY);
    expect(jobState.attemptCount).toBe(0);

    // Verify all 3 attempts with alternating worker IDs are preserved
    expect(attempts).toHaveLength(3);
    expect(attempts[0].workerId).toBe('worker-1');
    expect(attempts[1].workerId).toBe('worker-2');
    expect(attempts[2].workerId).toBe('worker-1');
  });
});
