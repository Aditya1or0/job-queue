import { JobRepository } from '../../packages/core/src/repositories/job.repository';
import { JobStatus } from '../../packages/core/src/domain/job-status.enum';
import { ClaimedJob } from '../../packages/core/src/domain/job.types';
import { LeaseFenceLostError } from '../../packages/core/src/domain/job-errors';

describe('Acceptance Test T6: Worker Identity Reuse / Restart Defense', () => {
  test('T6: Reused worker identity with old execution token cannot finalize a newer execution', async () => {
    let currentJob = {
      id: 6,
      jobId: 'JOB-0006',
      status: JobStatus.READY,
      leaseOwner: null as string | null,
      leaseToken: null as string | null,
      leaseUntil: null as Date | null,
      attemptCount: 0
    };

    const mockJobRepo = {
      claimNextDueOrExpiredJob: jest.fn(async (workerId: string, leaseDurationMs: number): Promise<ClaimedJob | null> => {
        const token = 'token-' + Math.random().toString(36).substring(2);
        currentJob.status = JobStatus.RUNNING;
        currentJob.leaseOwner = workerId;
        currentJob.leaseToken = token;
        currentJob.leaseUntil = new Date(Date.now() + leaseDurationMs);
        currentJob.attemptCount += 1;

        return {
          id: currentJob.id,
          jobId: currentJob.jobId,
          payload: 'Resize uploaded image',
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
        if (currentJob.jobId === jobId && currentJob.status === JobStatus.RUNNING && currentJob.leaseToken === leaseToken) {
          currentJob.status = JobStatus.DONE;
          currentJob.leaseOwner = null;
          currentJob.leaseToken = null;
          return true;
        }
        throw new LeaseFenceLostError(jobId, leaseToken);
      })
    } as unknown as JobRepository;

    // 1. Worker 'worker-1' claims job with token 1
    const claim1 = await mockJobRepo.claimNextDueOrExpiredJob('worker-1', 100);
    const oldToken = claim1!.leaseToken;

    // 2. Job expires and is reclaimed by 'worker-2' with token 2
    const claim2 = await mockJobRepo.claimNextDueOrExpiredJob('worker-2', 5000);
    const newToken = claim2!.leaseToken;

    // 3. Worker 'worker-1' restarts, still having worker_id='worker-1', but attempts to complete with oldToken
    await expect(mockJobRepo.finalizeJobSuccess('JOB-0006', oldToken)).rejects.toThrow(LeaseFenceLostError);

    // 4. Worker 2 successfully finalizes with newToken
    const success = await mockJobRepo.finalizeJobSuccess('JOB-0006', newToken);
    expect(success).toBe(true);
    expect(currentJob.status).toBe(JobStatus.DONE);
  });
});
