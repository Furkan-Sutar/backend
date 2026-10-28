import { app } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

async function start(): Promise<void> {
  await connectDatabase();
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT, environment: env.NODE_ENV }, 'Skill Nova API listening'));
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown started');
    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out');
      process.exit(1);
    }, 25_000).unref();
    server.close((serverError?: Error) => {
      void disconnectDatabase().then(() => {
        clearTimeout(forceExit);
        if (serverError) {
          logger.error({ err: serverError }, 'HTTP server shutdown failed');
          process.exitCode = 1;
        } else {
          logger.info('Graceful shutdown complete');
        }
      }).catch((error: unknown) => {
        clearTimeout(forceExit);
        logger.error({ err: error }, 'Database shutdown failed');
        process.exitCode = 1;
      });
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

start().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Application startup failed');
  process.exit(1);
});
