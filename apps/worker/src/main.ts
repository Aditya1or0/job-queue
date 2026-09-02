import dotenv from 'dotenv';
import {
  initSequelize,
  initializeModels,
  createSchema,
  JobRepository,
  RetryPolicy,
  LeasePolicy
} from '@core/index';
import { OpaqueSimulationHandler } from './handlers/opaque-simulation.handler';
import { WorkerEngine } from './engine/worker-engine';

dotenv.config();

async function bootstrap() {
  const sequelize = initSequelize();
  initializeModels(sequelize);
  await createSchema(sequelize);

  const jobRepo = new JobRepository(sequelize);
  const handler = new OpaqueSimulationHandler(parseInt(process.env.HANDLER_SIMULATION_MS ?? '100', 10));

  const retryPolicy = new RetryPolicy({
    maxAttempts: parseInt(process.env.MAX_ATTEMPTS ?? '3', 10),
    baseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS ?? '2000', 10),
    maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS ?? '60000', 10)
  });

  const leasePolicy = new LeasePolicy({
    leaseDurationMs: parseInt(process.env.LEASE_DURATION_MS ?? '30000', 10)
  });

  const worker = new WorkerEngine(jobRepo, handler, retryPolicy, leasePolicy, {
    workerId: process.env.WORKER_ID,
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '500', 10),
    maxPollIntervalMs: parseInt(process.env.MAX_POLL_INTERVAL_MS ?? '3000', 10),
    leaseDurationMs: leasePolicy.leaseDurationMs
  });

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Gracefully stopping worker ${worker.workerId}...`);
    worker.stop();
    await sequelize.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await worker.start();
}

bootstrap().catch((err) => {
  console.error('Fatal error during worker bootstrap:', err);
  process.exit(1);
});
