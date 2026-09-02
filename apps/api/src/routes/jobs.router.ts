import path from 'path';
import fs from 'fs';
import { Router, Request, Response } from 'express';
import { JobRepository } from '@core/repositories/job.repository';
import { JobAttemptRepository } from '@core/repositories/job-attempt.repository';
import { JobStatus } from '@core/domain/job-status.enum';
import {
  JobNotFoundError,
  JobNotDeadLetteredError
} from '@core/domain/job-errors';
import { JobModel } from '@core/models/job.model';
import { JobAttemptModel } from '@core/models/job-attempt.model';
import { parse } from 'csv-parse/sync';

export function createJobsRouter(
  jobRepo: JobRepository,
  attemptRepo: JobAttemptRepository
): Router {
  const router = Router();

  /**
   * GET /api/jobs
   * Retrieves all jobs (optionally filtered by status) and overall status counts.
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const statusQuery = req.query.status as string | undefined;
      let filter: JobStatus | undefined;

      if (statusQuery && Object.values(JobStatus).includes(statusQuery as JobStatus)) {
        filter = statusQuery as JobStatus;
      }

      const [counts, jobs] = await Promise.all([
        jobRepo.getJobCountsByStatus(),
        jobRepo.getAllJobs(filter)
      ]);

      res.json({
        counts,
        jobs
      });
    } catch (err: any) {
      console.error('[API] Error in GET /api/jobs:', err);
      res.status(500).json({ error: 'Failed to retrieve jobs', message: err.message });
    }
  });

  /**
   * POST /api/jobs/reset-seed
   * Wipes existing job and attempt records and re-seeds from CSV at base time = NOW().
   */
  router.post('/reset-seed', async (req: Request, res: Response) => {
    try {
      const candidatePaths = [
        process.env.SEED_FILE_PATH,
        '/app/jobs_seed.csv',
        path.resolve(process.cwd(), 'jobs_seed.csv'),
        path.resolve(__dirname, '../../../../jobs_seed.csv')
      ].filter(Boolean) as string[];

      let seedPath: string | null = null;
      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          seedPath = p;
          break;
        }
      }

      if (!seedPath) {
        res.status(404).json({ error: 'Seed CSV file not found on server' });
        return;
      }

      // Delete existing rows without violating foreign key constraints
      await JobAttemptModel.destroy({ where: {} });
      await JobModel.destroy({ where: {} });

      const fileContent = fs.readFileSync(seedPath, 'utf-8');
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      }) as any[];

      const baseTime = new Date();
      let count = 0;

      for (const record of records) {
        const offsetSec = parseInt(String(record.run_after_offset_sec), 10) || 0;
        const failTimes = parseInt(String(record.fail_times), 10) || 0;
        const runAfter = new Date(baseTime.getTime() + offsetSec * 1000);

        await JobModel.create({
          job_id: record.job_id,
          payload: record.payload,
          status: JobStatus.READY,
          run_after: runAfter,
          attempt_count: 0,
          max_attempts: 3,
          fail_times: failTimes,
          lease_owner: null,
          lease_token: null,
          lease_until: null,
          last_error: null,
          completed_at: null
        });
        count++;
      }

      console.log(`[API] Reset and re-seeded ${count} jobs from ${seedPath} at base time ${baseTime.toISOString()}`);
      res.json({
        message: `Successfully wiped database and enqueued ${count} jobs from seed CSV`,
        seededCount: count
      });
    } catch (err: any) {
      console.error('[API] Error in POST /api/jobs/reset-seed:', err);
      res.status(500).json({ error: 'Failed to reset and seed queue', message: err.message });
    }
  });

  /**
   * GET /api/jobs/:id
   * Retrieves a single job and its entire historical attempt timeline.
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const jobId = String(req.params.id);
      const job = await jobRepo.getJobById(jobId);

      if (!job) {
        res.status(404).json({ error: `Job '${jobId}' not found` });
        return;
      }

      const attempts = await attemptRepo.getAttemptsByJobId(jobId);

      res.json({
        job,
        attempts
      });
    } catch (err: any) {
      console.error(`[API] Error in GET /api/jobs/${String(req.params.id)}:`, err);
      res.status(500).json({ error: 'Failed to retrieve job details', message: err.message });
    }
  });

  /**
   * GET /api/jobs/:id/attempts
   * Retrieves all execution attempts for a given job.
   */
  router.get('/:id/attempts', async (req: Request, res: Response) => {
    try {
      const jobId = String(req.params.id);
      const attempts = await attemptRepo.getAttemptsByJobId(jobId);
      res.json({ attempts });
    } catch (err: any) {
      console.error(`[API] Error in GET /api/jobs/${String(req.params.id)}/attempts:`, err);
      res.status(500).json({ error: 'Failed to retrieve job attempts', message: err.message });
    }
  });

  /**
   * POST /api/jobs/:id/requeue
   * Requeues a dead-lettered job.
   */
  router.post('/:id/requeue', async (req: Request, res: Response) => {
    try {
      const jobId = String(req.params.id);
      const updatedJob = await jobRepo.requeueDeadLetterJob(jobId);
      console.log(`[API] Job '${jobId}' successfully requeued to READY.`);
      res.json({
        message: `Job '${jobId}' successfully requeued`,
        job: updatedJob
      });
    } catch (err: any) {
      if (err instanceof JobNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof JobNotDeadLetteredError) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error(`[API] Error in POST /api/jobs/${String(req.params.id)}/requeue:`, err);
      res.status(500).json({ error: 'Failed to requeue job', message: err.message });
    }
  });

  return router;
}
