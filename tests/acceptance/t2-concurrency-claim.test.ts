import { JobRepository } from '../../packages/core/src/repositories/job.repository';
import { WorkerEngine } from '../../apps/worker/src/engine/worker-engine';
import { JobStatus, AttemptStatus } from '../../packages/core/src/domain/job-status.enum';
import { ClaimedJob } from '../../packages/core/src/domain/job.types';
import { JobHandler } from '../../apps/worker/src/handlers/job-handler.interface';
import { RetryPolicy } from '../../packages/core/src/domain/retry-policy';
import { LeasePolicy } from '../../packages/core/src/domain/lease-policy';

describe('Acceptance Test T2: Exclusive Concurrency Claiming', () => {
  test('T2: Two workers racing for 1 due job results in exactly one worker claiming and executing', async () => {
    let jobState = {
      id: 2,
      jobId: 'JOB-0002',
      payload: 'Email order confirmation',
      status: JobStatus.READY,
      runAfter: new Date(Date.now() - 5000),
      attemptCount: 0,
      maxAttempts: 3,
      failTimes: 0,
      leaseOwner: null as string | null,
      leaseToken: null as string | null,
      leaseUntil: null as Date | null
    };

    let isLocked = false;

    // Simulate atomic lock / SKIP LOCKED behavior
    const mockJobRepo = {
      claimNextDueOrExpiredJob: jest.fn(async (workerId: string, leaseDurationMs: number): Promise<ClaimedJob | null> => {
        // Atomic compare-and-swap / row lock simulation
        if (isLocked) {
          return null; // SKIP LOCKED skipped the row because other worker locked it
        }

        if (jobState.status === JobStatus.READY && jobState.runAfter.getTime() <= Date.now()) {
          isLocked = true; // Lock acquired
          const leaseToken = 'token-' + Math.random().toString(36).substring(2);
          jobState.status = JobStatus.RUNNING;
          jobState.leaseOwner = workerId;
          jobState.leaseToken = leaseToken;
          jobState.leaseUntil = new Date(Date.now() + leaseDurationMs);
          jobState.attemptCount += 1;
          isLocked = false; // Lock released after commit

          return {
            id: jobState.id,
            jobId: jobState.jobId,
            payload: jobState.payload,
            attemptCount: jobState.attemptCount,
            attemptNumber: jobState.attemptCount,
            maxAttempts: jobState.maxAttempts,
            failTimes: jobState.failTimes,
            leaseOwner: workerId,
            leaseToken,
            leaseUntil: jobState.leaseUntil,
            isReclaim: false
          };
        }
        return null;
      }),

      finalizeJobSuccess: jest.fn(async (jobId: string, leaseToken: string): Promise<boolean> => {
        if (jobState.jobId === jobId && jobState.leaseToken === leaseToken) {
          jobState.status = JobStatus.DONE;
          jobState.leaseOwner = null;
          jobState.leaseToken = null;
          return true;
        }
        return false;
      }),

      finalizeJobFailure: jest.fn()
    } as unknown as JobRepository;

    const executions: Array<{ workerId: string; jobId: string }> = [];

    const createHandlerForWorker = (wId: string): JobHandler => ({
      execute: async (job: ClaimedJob) => {
        executions.push({ workerId: wId, jobId: job.jobId });
        // Simulate handler delay
        await new Promise((r) => setTimeout(r, 20));
      }
    });

    const worker1 = new WorkerEngine(
      mockJobRepo,
      createHandlerForWorker('worker-1'),
      new RetryPolicy(),
      new LeasePolicy(),
      { workerId: 'worker-1' }
    );

    const worker2 = new WorkerEngine(
      mockJobRepo,
      createHandlerForWorker('worker-2'),
      new RetryPolicy(),
      new LeasePolicy(),
      { workerId: 'worker-2' }
    );

    // Both workers poll concurrently
    const [result1, result2] = await Promise.all([worker1.runOnce(), worker2.runOnce()]);

    // Exactly one worker processed the job, the other got false
    expect((result1 && !result2) || (!result1 && result2)).toBe(true);

    // Exactly one handler invocation occurred
    expect(executions).toHaveLength(1);
    expect(jobState.status).toBe(JobStatus.DONE);
    expect(jobState.attemptCount).toBe(1);
  });
});
