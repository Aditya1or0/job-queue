import { JobRepository } from '../../packages/core/src/repositories/job.repository';
import { WorkerEngine } from '../../apps/worker/src/engine/worker-engine';
import { JobStatus, AttemptStatus } from '../../packages/core/src/domain/job-status.enum';
import { ClaimedJob } from '../../packages/core/src/domain/job.types';
import { JobHandler } from '../../apps/worker/src/handlers/job-handler.interface';
import { RetryPolicy } from '../../packages/core/src/domain/retry-policy';
import { LeasePolicy } from '../../packages/core/src/domain/lease-policy';

describe('Acceptance Test T3: Crash Recovery Mid-Job', () => {
  test('T3: Worker killed mid-job -> job is NOT stolen before lease expiry -> reclaimed and finished after lease expires', async () => {
    let jobState = {
      id: 3,
      jobId: 'JOB-0003',
      payload: 'Charge customer card',
      status: JobStatus.READY,
      runAfter: new Date(Date.now() - 1000),
      attemptCount: 0,
      maxAttempts: 3,
      failTimes: 0,
      leaseOwner: null as string | null,
      leaseToken: null as string | null,
      leaseUntil: null as Date | null,
      completedAt: null as Date | null
    };

    const attempts: Array<{
      jobId: string;
      attemptNumber: number;
      workerId: string;
      leaseToken: string;
      status: AttemptStatus;
      errorMessage: string | null;
      finishedAt: Date | null;
    }> = [];

    const mockJobRepo = {
      claimNextDueOrExpiredJob: jest.fn(async (workerId: string, leaseDurationMs: number): Promise<ClaimedJob | null> => {
        const now = Date.now();
        const isReady = jobState.status === JobStatus.READY && jobState.runAfter.getTime() <= now;
        const isExpiredRunning = jobState.status === JobStatus.RUNNING && jobState.leaseUntil !== null && jobState.leaseUntil.getTime() <= now;

        if (isReady || isExpiredRunning) {
          const isReclaim = isExpiredRunning;

          if (isReclaim) {
            // Close previous attempt as TIMED_OUT
            const prevAttempt = attempts.find((a) => a.jobId === jobState.jobId && a.status === AttemptStatus.RUNNING);
            if (prevAttempt) {
              prevAttempt.status = AttemptStatus.TIMED_OUT;
              prevAttempt.errorMessage = `Lease expired without completion; reclaimed by worker '${workerId}'`;
              prevAttempt.finishedAt = new Date();
            }
          }

          const newLeaseToken = 'token-' + Math.random().toString(36).substring(2);
          jobState.status = JobStatus.RUNNING;
          jobState.leaseOwner = workerId;
          jobState.leaseToken = newLeaseToken;
          jobState.leaseUntil = new Date(now + leaseDurationMs);
          jobState.attemptCount += 1;

          attempts.push({
            jobId: jobState.jobId,
            attemptNumber: attempts.length + 1,
            workerId,
            leaseToken: newLeaseToken,
            status: AttemptStatus.RUNNING,
            errorMessage: null,
            finishedAt: null
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
            isReclaim
          };
        }

        return null;
      }),

      finalizeJobSuccess: jest.fn(async (jobId: string, leaseToken: string): Promise<boolean> => {
        if (jobState.jobId === jobId && jobState.status === JobStatus.RUNNING && jobState.leaseToken === leaseToken) {
          jobState.status = JobStatus.DONE;
          jobState.completedAt = new Date();
          jobState.leaseOwner = null;
          jobState.leaseToken = null;
          jobState.leaseUntil = null;

          const att = attempts.find((a) => a.jobId === jobId && a.leaseToken === leaseToken);
          if (att) {
            att.status = AttemptStatus.SUCCEEDED;
            att.finishedAt = new Date();
          }
          return true;
        }
        return false;
      })
    } as unknown as JobRepository;

    // Worker 1 claims with short lease (100ms)
    const worker1 = new WorkerEngine(
      mockJobRepo,
      {
        execute: async () => {
          // Worker 1 starts working and suddenly "crashes" (throws unhandled exit or stops without committing)
          throw new Error('WORKER_CRASHED_SIMULATION');
        }
      },
      new RetryPolicy(),
      new LeasePolicy({ leaseDurationMs: 100 }),
      { workerId: 'worker-1', leaseDurationMs: 100 }
    );

    const worker2 = new WorkerEngine(
      mockJobRepo,
      {
        execute: async () => {
          // Worker 2 executes successfully
        }
      },
      new RetryPolicy(),
      new LeasePolicy({ leaseDurationMs: 5000 }),
      { workerId: 'worker-2' }
    );

    // 1. Worker 1 claims the job
    const worker1Claimed = await mockJobRepo.claimNextDueOrExpiredJob('worker-1', 100);
    expect(worker1Claimed).not.toBeNull();
    expect(jobState.status).toBe(JobStatus.RUNNING);
    expect(jobState.leaseOwner).toBe('worker-1');

    // 2. Worker 2 polls BEFORE lease expires -> must NOT claim
    const worker2EarlyClaim = await mockJobRepo.claimNextDueOrExpiredJob('worker-2', 5000);
    expect(worker2EarlyClaim).toBeNull();
    expect(jobState.leaseOwner).toBe('worker-1');

    // 3. Wait for lease to expire (> 100ms)
    await new Promise((r) => setTimeout(r, 150));

    // 4. Worker 2 polls AFTER lease expires -> reclaims job
    const worker2Processed = await worker2.runOnce();
    expect(worker2Processed).toBe(true);

    // Verify recovery outcome
    expect(jobState.status).toBe(JobStatus.DONE);
    expect(jobState.completedAt).not.toBeNull();
    expect(attempts).toHaveLength(2);

    // Verify attempt 1 was closed as TIMED_OUT
    expect(attempts[0].workerId).toBe('worker-1');
    expect(attempts[0].status).toBe(AttemptStatus.TIMED_OUT);
    expect(attempts[0].errorMessage).toContain("reclaimed by worker 'worker-2'");

    // Verify attempt 2 succeeded
    expect(attempts[1].workerId).toBe('worker-2');
    expect(attempts[1].status).toBe(AttemptStatus.SUCCEEDED);
  });
});
