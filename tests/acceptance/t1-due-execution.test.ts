import { JobRepository } from '../../packages/core/src/repositories/job.repository';
import { JobAttemptRepository } from '../../packages/core/src/repositories/job-attempt.repository';
import { WorkerEngine } from '../../apps/worker/src/engine/worker-engine';
import { JobStatus, AttemptStatus } from '../../packages/core/src/domain/job-status.enum';
import { ClaimedJob } from '../../packages/core/src/domain/job.types';
import { JobHandler } from '../../apps/worker/src/handlers/job-handler.interface';
import { RetryPolicy } from '../../packages/core/src/domain/retry-policy';
import { LeasePolicy } from '../../packages/core/src/domain/lease-policy';

describe('Acceptance Test T1: Due Job Execution', () => {
  test('T1: A job becomes due and runs once under normal conditions (READY -> RUNNING -> DONE)', async () => {
    // In-memory / Mocked Repository simulating the exact atomic claim and fencing lifecycle
    let jobState = {
      id: 1,
      jobId: 'JOB-0001',
      payload: 'Send welcome email',
      status: JobStatus.READY,
      runAfter: new Date(Date.now() - 1000), // Due in the past
      attemptCount: 0,
      maxAttempts: 3,
      failTimes: 0,
      leaseOwner: null as string | null,
      leaseToken: null as string | null,
      leaseUntil: null as Date | null,
      completedAt: null as Date | null,
      lastError: null as string | null
    };

    const attempts: Array<{
      jobId: string;
      attemptNumber: number;
      workerId: string;
      leaseToken: string;
      status: AttemptStatus;
      finishedAt: Date | null;
    }> = [];

    const mockJobRepo = {
      claimNextDueOrExpiredJob: jest.fn(async (workerId: string, leaseDurationMs: number): Promise<ClaimedJob | null> => {
        if (jobState.status === JobStatus.READY && jobState.runAfter.getTime() <= Date.now()) {
          const leaseToken = 'token-' + Math.random().toString(36).substring(2);
          jobState.status = JobStatus.RUNNING;
          jobState.leaseOwner = workerId;
          jobState.leaseToken = leaseToken;
          jobState.leaseUntil = new Date(Date.now() + leaseDurationMs);
          jobState.attemptCount += 1;

          attempts.push({
            jobId: jobState.jobId,
            attemptNumber: jobState.attemptCount,
            workerId,
            leaseToken,
            status: AttemptStatus.RUNNING,
            finishedAt: null
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
            leaseToken,
            leaseUntil: jobState.leaseUntil,
            isReclaim: false
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
      }),

      finalizeJobFailure: jest.fn()
    } as unknown as JobRepository;

    let handlerExecutions = 0;
    const testHandler: JobHandler = {
      execute: async (job: ClaimedJob) => {
        handlerExecutions++;
        expect(job.jobId).toBe('JOB-0001');
      }
    };

    const worker = new WorkerEngine(
      mockJobRepo,
      testHandler,
      new RetryPolicy(),
      new LeasePolicy({ leaseDurationMs: 10000 }),
      { workerId: 'worker-t1', pollIntervalMs: 50 }
    );

    // Initial state: READY
    expect(jobState.status).toBe(JobStatus.READY);
    expect(jobState.attemptCount).toBe(0);

    // Run one worker cycle
    const processed = await worker.runOnce();

    expect(processed).toBe(true);
    expect(handlerExecutions).toBe(1);

    // Final state: DONE
    expect(jobState.status).toBe(JobStatus.DONE);
    expect(jobState.completedAt).not.toBeNull();
    expect(jobState.leaseOwner).toBeNull();
    expect(jobState.leaseToken).toBeNull();

    // Verify exactly 1 attempt recorded
    expect(attempts).toHaveLength(1);
    expect(attempts[0].attemptNumber).toBe(1);
    expect(attempts[0].workerId).toBe('worker-t1');
    expect(attempts[0].status).toBe(AttemptStatus.SUCCEEDED);
    expect(attempts[0].finishedAt).not.toBeNull();
  });
});
