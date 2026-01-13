import { FastifyInstance } from 'fastify';
import { WebSocket } from '@fastify/websocket';
import { setProgressCallback } from '../services/job-queue.js';
import { JobProgress, WSMessage } from '../../shared/types.js';
import * as db from '../database.js';
import pino from 'pino';

const logger = pino({ name: 'websocket' });

// Connected clients per job
const jobSubscriptions = new Map<string, Set<WebSocket>>();

// All connected clients (for broadcast)
const allClients = new Set<WebSocket>();

export async function websocketRoutes(fastify: FastifyInstance) {
  // Register progress callback
  setProgressCallback((jobId: string, progress: JobProgress) => {
    broadcastToJob(jobId, {
      type: 'job_progress',
      jobId,
      data: progress,
    });
  });

  // WebSocket endpoint for job updates
  fastify.get('/ws/jobs/:jobId', { websocket: true }, (socket, request) => {
    const { jobId } = request.params as { jobId: string };

    logger.info({ jobId }, 'Client connected to job updates');

    // Add to subscriptions
    if (!jobSubscriptions.has(jobId)) {
      jobSubscriptions.set(jobId, new Set());
    }
    jobSubscriptions.get(jobId)!.add(socket);
    allClients.add(socket);

    // Send current job state immediately
    const job = db.getJob(jobId);
    if (job) {
      socket.send(
        JSON.stringify({
          type: 'job_progress',
          jobId,
          data: job.progress,
        } as WSMessage)
      );
    }

    // Handle incoming messages (for future use)
    socket.on('message', (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString());
        logger.debug({ jobId, data }, 'Received message');
      } catch {
        // Ignore invalid messages
      }
    });

    // Handle disconnection
    socket.on('close', () => {
      logger.info({ jobId }, 'Client disconnected');
      jobSubscriptions.get(jobId)?.delete(socket);
      if (jobSubscriptions.get(jobId)?.size === 0) {
        jobSubscriptions.delete(jobId);
      }
      allClients.delete(socket);
    });

    socket.on('error', (err) => {
      logger.error({ jobId, error: err.message }, 'WebSocket error');
    });
  });

  // WebSocket endpoint for all job updates
  fastify.get('/ws/jobs', { websocket: true }, (socket) => {
    logger.info('Client connected to all job updates');

    allClients.add(socket);

    socket.on('close', () => {
      logger.info('Client disconnected from all jobs');
      allClients.delete(socket);
    });

    socket.on('error', (err) => {
      logger.error({ error: err.message }, 'WebSocket error');
    });
  });
}

/**
 * Broadcast message to all clients subscribed to a specific job
 */
function broadcastToJob(jobId: string, message: WSMessage): void {
  const subscribers = jobSubscriptions.get(jobId);
  const payload = JSON.stringify(message);

  if (subscribers) {
    for (const client of subscribers) {
      if (client.readyState === 1) {
        // OPEN
        client.send(payload);
      }
    }
  }

  // Also broadcast to "all jobs" subscribers
  for (const client of allClients) {
    if (client.readyState === 1 && !subscribers?.has(client)) {
      client.send(payload);
    }
  }
}

/**
 * Broadcast job completion
 */
export function notifyJobCompleted(jobId: string, outputFile: string): void {
  broadcastToJob(jobId, {
    type: 'job_completed',
    jobId,
    data: { outputFile },
  });
}

/**
 * Broadcast job failure
 */
export function notifyJobFailed(jobId: string, error: string): void {
  broadcastToJob(jobId, {
    type: 'job_failed',
    jobId,
    data: { error },
  });
}
