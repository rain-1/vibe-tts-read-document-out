import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import * as db from '../database.js';
import { addJob, getQueueStats } from '../services/job-queue.js';
import { getTTSProvider, listTTSProviders } from '../services/tts/index.js';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';

// Request validation schemas
const createJobSchema = z.object({
  filename: z.string().min(1),
  fileContent: z.string().min(1),
  fileType: z.enum(['text', 'pdf', 'html']),
  voiceProfileId: z.string().optional(),
  autoUpdateProfile: z.boolean().optional().default(true),
  createProfileFromJob: z.boolean().optional(),
  newProfileName: z.string().optional(),
});

const jobIdSchema = z.object({
  id: z.string().min(1),
});

const listJobsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export async function jobRoutes(fastify: FastifyInstance) {
  // Create a new job
  fastify.post(
    '/api/jobs',
    async (
      request: FastifyRequest<{ Body: z.infer<typeof createJobSchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const body = createJobSchema.parse(request.body);

        // Validate voice profile if provided
        if (body.voiceProfileId) {
          const profile = db.getVoiceProfile(body.voiceProfileId);
          if (!profile) {
            return reply.code(400).send({ error: 'Voice profile not found' });
          }
        }

        // Generate job ID
        const jobId = nanoid();

        // Create job in database with voice profile reference
        const job = db.createJob(jobId, body.filename, body.fileType, body.voiceProfileId);

        // Add to processing queue with voice profile settings
        await addJob(
          jobId,
          body.fileContent,
          body.fileType,
          body.voiceProfileId,
          body.autoUpdateProfile
        );

        return reply.code(201).send({
          jobId: job.id,
          status: job.status,
          voiceProfileId: job.voiceProfileId,
          voiceProfileName: job.voiceProfileName,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }
        throw error;
      }
    }
  );

  // Get job status
  fastify.get(
    '/api/jobs/:id',
    async (
      request: FastifyRequest<{ Params: z.infer<typeof jobIdSchema> }>,
      reply: FastifyReply
    ) => {
      const { id } = jobIdSchema.parse(request.params);

      const job = db.getJob(id);
      if (!job) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      return { job };
    }
  );

  // List all jobs
  fastify.get(
    '/api/jobs',
    async (
      request: FastifyRequest<{ Querystring: z.infer<typeof listJobsSchema> }>,
      reply: FastifyReply
    ) => {
      const { limit, offset } = listJobsSchema.parse(request.query);

      const result = db.getAllJobs(limit, offset);

      return {
        jobs: result.jobs,
        total: result.total,
        limit,
        offset,
      };
    }
  );

  // Delete a job
  fastify.delete(
    '/api/jobs/:id',
    async (
      request: FastifyRequest<{ Params: z.infer<typeof jobIdSchema> }>,
      reply: FastifyReply
    ) => {
      const { id } = jobIdSchema.parse(request.params);

      const job = db.getJob(id);
      if (!job) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      // Delete output file if exists
      if (job.outputFile && fs.existsSync(job.outputFile)) {
        fs.unlinkSync(job.outputFile);
      }

      db.deleteJob(id);

      return { success: true };
    }
  );

  // Download audio file
  fastify.get(
    '/api/jobs/:id/download',
    async (
      request: FastifyRequest<{ Params: z.infer<typeof jobIdSchema> }>,
      reply: FastifyReply
    ) => {
      const { id } = jobIdSchema.parse(request.params);

      const job = db.getJob(id);
      if (!job) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      if (job.status !== 'completed' || !job.outputFile) {
        return reply.code(400).send({ error: 'Audio file not ready' });
      }

      if (!fs.existsSync(job.outputFile)) {
        return reply.code(404).send({ error: 'Audio file not found' });
      }

      const filename = `${job.originalFilename.replace(/\.[^.]+$/, '')}_audio.mp3`;

      return reply
        .header('Content-Type', 'audio/mpeg')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(fs.createReadStream(job.outputFile));
    }
  );

  // Stream audio file (for playback)
  fastify.get(
    '/api/jobs/:id/audio',
    async (
      request: FastifyRequest<{ Params: z.infer<typeof jobIdSchema> }>,
      reply: FastifyReply
    ) => {
      const { id } = jobIdSchema.parse(request.params);

      const job = db.getJob(id);
      if (!job) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      if (job.status !== 'completed' || !job.outputFile) {
        return reply.code(400).send({ error: 'Audio file not ready' });
      }

      if (!fs.existsSync(job.outputFile)) {
        return reply.code(404).send({ error: 'Audio file not found' });
      }

      const stat = fs.statSync(job.outputFile);

      return reply
        .header('Content-Type', 'audio/mpeg')
        .header('Content-Length', stat.size)
        .header('Accept-Ranges', 'bytes')
        .send(fs.createReadStream(job.outputFile));
    }
  );

  // Get queue statistics
  fastify.get('/api/queue/stats', async () => {
    const stats = await getQueueStats();
    return stats;
  });

  // Get available TTS providers and voices
  fastify.get('/api/tts/providers', async () => {
    const providers = listTTSProviders();
    const currentProvider = getTTSProvider();
    const voices = await currentProvider.getVoices();

    return {
      providers,
      currentProvider: currentProvider.name,
      voices,
      config: currentProvider.config,
    };
  });

  // Health check
  fastify.get('/api/health', async () => {
    const stats = await getQueueStats();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      queue: stats,
    };
  });
}
