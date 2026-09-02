import express, { Express } from 'express';
import cors from 'cors';
import { Sequelize } from 'sequelize';
import { JobRepository } from '@core/repositories/job.repository';
import { JobAttemptRepository } from '@core/repositories/job-attempt.repository';
import { createJobsRouter } from './routes/jobs.router';

export function createApp(sequelize: Sequelize): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  const jobRepo = new JobRepository(sequelize);
  const attemptRepo = new JobAttemptRepository(sequelize);

  // Health check endpoint
  app.get('/health', async (_req, res) => {
    try {
      await sequelize.authenticate();
      res.json({ status: 'ok', timestamp: new Date().toISOString(), database: 'connected' });
    } catch (err: any) {
      res.status(500).json({ status: 'error', database: 'disconnected', error: err.message });
    }
  });

  // API Routes
  app.use('/api/jobs', createJobsRouter(jobRepo, attemptRepo));

  return app;
}
