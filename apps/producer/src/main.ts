import path from 'path';
import dotenv from 'dotenv';
import { initSequelize, initializeModels, createSchema } from '@core/index';
import { SeedLoader } from './seed-loader';

dotenv.config();

async function bootstrap() {
  const sequelize = initSequelize();
  initializeModels(sequelize);
  await createSchema(sequelize);

  const seedLoader = new SeedLoader(sequelize);
  const seedPath = process.env.SEED_FILE_PATH ?? path.resolve(__dirname, '../jobs_seed.csv');
  const fallbackPath = path.resolve(process.cwd(), 'jobs_seed.csv');

  const resolvedPath = require('fs').existsSync(seedPath) ? seedPath : fallbackPath;

  await seedLoader.loadFromCsv(resolvedPath);

  await sequelize.close();
  console.log('[PRODUCER] Seed ingestion completed successfully.');
  process.exit(0);
}

bootstrap().catch((err) => {
  console.error('[PRODUCER] Fatal error during seed loading:', err);
  process.exit(1);
});
