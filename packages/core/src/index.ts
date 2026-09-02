export * from './domain/job-status.enum';
export * from './domain/job.types';
export * from './domain/job-errors';
export * from './domain/retry-policy';
export * from './domain/lease-policy';

export * from './database/connection';
export * from './database/schema';

export * from './models/job.model';
export * from './models/job-attempt.model';

export * from './repositories/job.repository';
export * from './repositories/job-attempt.repository';

import { Sequelize } from 'sequelize';
import { initJobModel } from './models/job.model';
import { initJobAttemptModel } from './models/job-attempt.model';

export function initializeModels(sequelize: Sequelize) {
  initJobModel(sequelize);
  initJobAttemptModel(sequelize);
}
