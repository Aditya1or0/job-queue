import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';
import {
  initSequelize,
  initializeModels,
  createSchema,
  dropSchema,
  JobRepository,
  JobAttemptRepository
} from '../packages/core/src/index';

dotenv.config();

export interface TestHarness {
  sequelize: Sequelize;
  jobRepo: JobRepository;
  attemptRepo: JobAttemptRepository;
  cleanup: () => Promise<void>;
  resetDatabase: () => Promise<void>;
}

export async function setupTestHarness(): Promise<TestHarness> {
  const sequelize = initSequelize();
  initializeModels(sequelize);

  await dropSchema(sequelize);
  await createSchema(sequelize);

  const jobRepo = new JobRepository(sequelize);
  const attemptRepo = new JobAttemptRepository(sequelize);

  const resetDatabase = async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0;');
    await sequelize.query('TRUNCATE TABLE job_attempts;');
    await sequelize.query('TRUNCATE TABLE jobs;');
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1;');
  };

  const cleanup = async () => {
    await dropSchema(sequelize);
    await sequelize.close();
  };

  return {
    sequelize,
    jobRepo,
    attemptRepo,
    cleanup,
    resetDatabase
  };
}
