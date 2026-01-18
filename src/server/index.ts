import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticServe from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import { config } from './config.js';
import { jobRoutes } from './routes/jobs.js';
import { websocketRoutes } from './routes/websocket.js';
import { resumeRoutes } from './routes/resume.js';
import { voiceProfileRoutes } from './routes/voice-profiles.js';
import { createWorker } from './services/job-queue.js';

const logger = pino({
  name: 'server',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

// Ensure data directories exist
const dirs = [config.paths.uploads, config.paths.outputs, config.paths.temp];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info({ dir }, 'Created directory');
  }
}

const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    },
  },
});

async function start() {
  try {
    // Register plugins
    await fastify.register(cors, {
      origin: true,
      credentials: true,
    });

    await fastify.register(multipart, {
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max file size
      },
    });

    await fastify.register(websocket);

    // API routes
    await fastify.register(jobRoutes);
    await fastify.register(websocketRoutes);
    await fastify.register(resumeRoutes);
    await fastify.register(voiceProfileRoutes);

    // File upload endpoint (alternative to base64 in JSON)
    fastify.post('/api/upload', async (request, reply) => {
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: 'No file uploaded' });
      }

      const buffer = await data.toBuffer();
      const content = buffer.toString('base64');

      // Determine file type from extension
      const ext = path.extname(data.filename).toLowerCase();
      let fileType: 'text' | 'pdf' | 'html' = 'text';
      if (ext === '.pdf') fileType = 'pdf';
      else if (ext === '.html' || ext === '.htm') fileType = 'html';

      return {
        filename: data.filename,
        fileContent: content,
        fileType,
        size: buffer.length,
      };
    });

    // Serve static files in production
    const clientDist = path.join(process.cwd(), 'dist', 'client');
    if (fs.existsSync(clientDist)) {
      await fastify.register(staticServe, {
        root: clientDist,
        prefix: '/',
      });

      // SPA fallback
      fastify.setNotFoundHandler((request, reply) => {
        if (!request.url.startsWith('/api/') && !request.url.startsWith('/ws/')) {
          return reply.sendFile('index.html');
        }
        return reply.code(404).send({ error: 'Not found' });
      });
    }

    // Start worker in the same process (for simplicity)
    // In production, you might want to run workers separately
    const worker = createWorker();
    logger.info('Job worker started');

    // Start server
    const port = parseInt(process.env.PORT ?? '3000', 10);
    await fastify.listen({ port, host: '0.0.0.0' });

    logger.info({ port }, 'Server started');
    logger.info(`API: http://localhost:${port}/api`);
    logger.info(`WebSocket: ws://localhost:${port}/ws/jobs`);

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      await worker.close();
      await fastify.close();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error(error, 'Failed to start server');
    process.exit(1);
  }
}

start();
