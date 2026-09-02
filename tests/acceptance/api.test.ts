import express from 'express';
import { createJobsRouter } from '../../apps/api/src/routes/jobs.router';
import { JobRepository } from '../../packages/core/src/repositories/job.repository';
import { JobAttemptRepository } from '../../packages/core/src/repositories/job-attempt.repository';
import { JobStatus, AttemptStatus } from '../../packages/core/src/domain/job-status.enum';
import { JobNotFoundError, JobNotDeadLetteredError } from '../../packages/core/src/domain/job-errors';

describe('API Integration Tests', () => {
  let app: express.Express;
  let mockJobRepo: Partial<JobRepository>;
  let mockAttemptRepo: Partial<JobAttemptRepository>;

  beforeEach(() => {
    mockJobRepo = {
      getJobCountsByStatus: jest.fn().mockResolvedValue({
        [JobStatus.READY]: 5,
        [JobStatus.RUNNING]: 2,
        [JobStatus.DONE]: 10,
        [JobStatus.DEAD_LETTER]: 1
      }),
      getAllJobs: jest.fn().mockResolvedValue([
        {
          id: 1,
          jobId: 'JOB-0001',
          payload: 'Test Payload',
          status: JobStatus.READY,
          runAfter: new Date(),
          attemptCount: 0,
          maxAttempts: 3,
          leaseOwner: null,
          leaseToken: null,
          leaseUntil: null,
          failTimes: 0,
          lastError: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]),
      getJobById: jest.fn().mockImplementation(async (jobId: string) => {
        if (jobId === 'JOB-0001') {
          return {
            id: 1,
            jobId: 'JOB-0001',
            payload: 'Test Payload',
            status: JobStatus.DEAD_LETTER,
            runAfter: new Date(),
            attemptCount: 3,
            maxAttempts: 3,
            leaseOwner: null,
            leaseToken: null,
            leaseUntil: null,
            failTimes: 9,
            lastError: 'Simulated failure',
            completedAt: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
        return null;
      }),
      requeueDeadLetterJob: jest.fn().mockImplementation(async (jobId: string) => {
        if (jobId === 'JOB-0001') {
          return {
            id: 1,
            jobId: 'JOB-0001',
            payload: 'Test Payload',
            status: JobStatus.READY,
            runAfter: new Date(),
            attemptCount: 0,
            maxAttempts: 3,
            leaseOwner: null,
            leaseToken: null,
            leaseUntil: null,
            failTimes: 9,
            lastError: null,
            completedAt: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
        if (jobId === 'NON-EXISTENT') {
          throw new JobNotFoundError(jobId);
        }
        throw new JobNotDeadLetteredError(jobId, JobStatus.READY);
      })
    };

    mockAttemptRepo = {
      getAttemptsByJobId: jest.fn().mockResolvedValue([
        {
          id: 1,
          jobId: 'JOB-0001',
          attemptNumber: 1,
          workerId: 'worker-1',
          leaseToken: 'token-1',
          startedAt: new Date(),
          finishedAt: new Date(),
          status: AttemptStatus.FAILED,
          errorMessage: 'Attempt 1 failed',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ])
    };

    app = express();
    app.use(express.json());
    app.use('/api/jobs', createJobsRouter(mockJobRepo as JobRepository, mockAttemptRepo as JobAttemptRepository));
  });

  test('GET /api/jobs returns grouped counts and jobs list', async () => {
    // In-memory request simulation
    const req = { query: {} } as any;
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    } as any;

    const router = createJobsRouter(mockJobRepo as JobRepository, mockAttemptRepo as JobAttemptRepository);
    const handler = (router as any).stack.find((layer: any) => layer.route && layer.route.path === '/' && layer.route.methods.get).route.stack[0].handle;

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        counts: expect.objectContaining({ READY: 5, RUNNING: 2, DONE: 10, DEAD_LETTER: 1 }),
        jobs: expect.any(Array)
      })
    );
  });

  test('POST /api/jobs/:id/requeue returns 200 on successful dead-letter requeue', async () => {
    const req = { params: { id: 'JOB-0001' } } as any;
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    } as any;

    const router = createJobsRouter(mockJobRepo as JobRepository, mockAttemptRepo as JobAttemptRepository);
    const handler = (router as any).stack.find((layer: any) => layer.route && layer.route.path === '/:id/requeue' && layer.route.methods.post).route.stack[0].handle;

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Job 'JOB-0001' successfully requeued",
        job: expect.objectContaining({ status: JobStatus.READY, attemptCount: 0 })
      })
    );
  });

  test('POST /api/jobs/:id/requeue returns 404 for non-existent job', async () => {
    const req = { params: { id: 'NON-EXISTENT' } } as any;
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    } as any;

    const router = createJobsRouter(mockJobRepo as JobRepository, mockAttemptRepo as JobAttemptRepository);
    const handler = (router as any).stack.find((layer: any) => layer.route && layer.route.path === '/:id/requeue' && layer.route.methods.post).route.stack[0].handle;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
