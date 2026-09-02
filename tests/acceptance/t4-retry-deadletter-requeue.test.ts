import { JobRepository } from '../../packages/core/src/repositories/job.repository';
import { WorkerEngine } from '../../apps/worker/src/engine/worker-engine';
import { JobStatus, AttemptStatus } from '../../packages/core/src/domain/job-status.enum';
import { ClaimedJob } from '../../packages/core/src/domain/job.types';
import { JobHandler } from '../../apps/worker/src/handlers/job-handler.interface';
import { RetryPolicy } from '../../packages/core/src/domain/retry-policy';
import { LeasePolicy } from '../../packages/core/src/domain/lease-policy';

describe('Acceptance Test T4: Retry Exhaustion, Dead-Lettering, and Requeue', () => {
  test('T4: Job fails max_attempts times -> transitions to DEAD_LETTER -> Requeue resets to READY with history preserved', async () => {
    let jobState = {
      id: 4,
      jobId: 'JOB-0004',
      payload: 'Sync contact to CRM',
      status: JobStatus.READY,
      runAfter: new Date(Date.now() - 1000),
      attemptCount: 0,
      maxAttempts: 3,
      failTimes: 9, // Always fails initially
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
            attemptNumber: attempts.length + 1,
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
            attemptNumber: attempts.length,
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
    const worker = new WorkerEngine(
      mockJobRepo,
      failingHandler,
      retryPolicy,
      new LeasePolicy(),
      { workerId: 'worker-t4' }
    );

    // Attempt 1 -> fails -> READY
    await worker.runOnce();
    expect(jobState.status).toBe(JobStatus.READY);
    expect(jobState.attemptCount).toBe(1);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe(AttemptStatus.FAILED);

    // Fast-forward runAfter to due
    jobState.runAfter = new Date(Date.now() - 10);

    // Attempt 2 -> fails -> READY
    await worker.runOnce();
    expect(jobState.status).toBe(JobStatus.READY);
    expect(jobState.attemptCount).toBe(2);
    expect(attempts).toHaveLength(2);

    jobState.runAfter = new Date(Date.now() - 10);

    // Attempt 3 -> fails -> reaches max_attempts (3) -> DEAD_LETTER
    await worker.runOnce();
    expect(jobState.status).toBe(JobStatus.DEAD_LETTER);
    expect(jobState.attemptCount).toBe(3);
    expect(jobState.lastError).toContain('CRM endpoint 503');
    expect(attempts).toHaveLength(3);

    // Now execute REQUEUE
    await mockJobRepo.requeueDeadLetterJob('JOB-0004');

    expect(jobState.status).toBe(JobStatus.READY);
    expect(jobState.attemptCount).toBe(0);
    expect(jobState.lastError).toBeNull();

    // Verify historical 3 attempts are still intact!
    expect(attempts).toHaveLength(3);
    expect(attempts.every((a) => a.status === AttemptStatus.FAILED)).toBe(true);
  });
});
