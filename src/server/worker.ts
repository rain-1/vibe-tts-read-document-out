/**
 * Standalone worker process
 * Run with: npm run worker
 *
 * This allows running workers separately from the main server process,
 * useful for scaling and fault tolerance.
 */

import pino from 'pino';
import { createWorker } from './services/job-queue.js';

const logger = pino({
  name: 'worker',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

logger.info('Starting standalone worker...');

const worker = createWorker();

logger.info('Worker started and listening for jobs');

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down worker...');
  await worker.close();
  logger.info('Worker stopped');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Keep process alive
process.on('uncaughtException', (error) => {
  logger.error(error, 'Uncaught exception');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});
