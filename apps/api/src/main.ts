import dotenv from 'dotenv';
import { initSequelize, initializeModels, createSchema } from '@core/index';
import { createApp } from './app';

dotenv.config();

async function bootstrap() {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  const sequelize = initSequelize();
  initializeModels(sequelize);
  await createSchema(sequelize);

  const app = createApp(sequelize);

  const server = app.listen(port, () => {
    console.log(`[API] Job Queue API server listening on http://0.0.0.0:${port}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[API] Received ${signal}. Shutting down API gracefully...`);
    server.close(async () => {
      await sequelize.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[API] Fatal error during API bootstrap:', err);
  process.exit(1);
});
