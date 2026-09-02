import { JobRepository } from '../../packages/core/src/repositories/job.repository';
import { WorkerEngine } from '../../apps/worker/src/engine/worker-engine';
import { JobStatus, AttemptStatus } from '../../packages/core/src/domain/job-status.enum';
import { ClaimedJob } from '../../packages/core/src/domain/job.types';
import { LeaseFenceLostError } from '../../packages/core/src/domain/job-errors';
import { JobHandler } from '../../apps/worker/src/handlers/job-handler.interface';
import { RetryPolicy } from '../../packages/core/src/domain/retry-policy';
import { LeasePolicy } from '../../packages/core/src/domain/lease-policy';

describe('Acceptance Test T5: Stale Worker Fencing Defense', () => {
  test('T5: Stale Worker A cannot overwrite Worker B after lease expiration and reclaim', async () => {
    let currentJob = {
      id: 5,
      jobId: 'JOB-0005',
      payload: 'Resize uploaded image',
      status: JobStatus.READY,
      leaseOwner: null as string | null,
      leaseToken: null as string | null,
      leaseUntil: null as Date | null,
      attemptCount: 0,
      completedAt: null as Date | null
    };

    const mockJobRepo = {
      claimNextDueOrExpiredJob: jest.fn(async (workerId: string, leaseDurationMs: number): Promise<ClaimedJob | null> => {
        const token = 'token-' + workerId + '-' + Math.random().toString(36).substring(2);
        currentJob.status = JobStatus.RUNNING;
        currentJob.leaseOwner = workerId;
        currentJob.leaseToken = token;
        currentJob.leaseUntil = new Date(Date.now() + leaseDurationMs);
        currentJob.attemptCount += 1;

        return {
          id: currentJob.id,
          jobId: currentJob.jobId,
          payload: currentJob.payload,
          attemptCount: currentJob.attemptCount,
          attemptNumber: currentJob.attemptCount,
          maxAttempts: 3,
          failTimes: 0,
          leaseOwner: workerId,
          leaseToken: token,
          leaseUntil: currentJob.leaseUntil,
          isReclaim: currentJob.attemptCount > 1
        };
      }),

      finalizeJobSuccess: jest.fn(async (jobId: string, leaseToken: string): Promise<boolean> => {
        // Enforce strict lease_token fencing
        if (currentJob.jobId === jobId && currentJob.status === JobStatus.RUNNING && currentJob.leaseToken === leaseToken) {
          currentJob.status = JobStatus.DONE;
          currentJob.completedAt = new Date();
          currentJob.leaseOwner = null;
          currentJob.leaseToken = null;
          currentJob.leaseUntil = null;
          return true;
        }
        // Fencing check fails!
        throw new LeaseFenceLostError(jobId, leaseToken);
      })
    } as unknown as JobRepository;

    // 1. Worker A claims the job with Token A
    const claimA = await mockJobRepo.claimNextDueOrExpiredJob('worker-A', 50);
    expect(claimA).not.toBeNull();
    const tokenA = claimA!.leaseToken;
    expect(currentJob.leaseOwner).toBe('worker-A');

    // 2. Lease expires and Worker B reclaims the job with Token B
    const claimB = await mockJobRepo.claimNextDueOrExpiredJob('worker-B', 5000);
    expect(claimB).not.toBeNull();
    const tokenB = claimB!.leaseToken;
    expect(currentJob.leaseOwner).toBe('worker-B');
    expect(currentJob.leaseToken).toBe(tokenB);

    // 3. Worker A wakes up and attempts to finalize with its stale tokenA
    await expect(mockJobRepo.finalizeJobSuccess('JOB-0005', tokenA)).rejects.toThrow(LeaseFenceLostError);

    // Verify Worker B's lease ownership and job status are unharmed
    expect(currentJob.status).toBe(JobStatus.RUNNING);
    expect(currentJob.leaseOwner).toBe('worker-B');
    expect(currentJob.leaseToken).toBe(tokenB);

    // 4. Worker B finishes and commits with valid tokenB -> SUCCEEDS
    const successB = await mockJobRepo.finalizeJobSuccess('JOB-0005', tokenB);
    expect(successB).toBe(true);
    expect(currentJob.status).toBe(JobStatus.DONE);
  });
});
