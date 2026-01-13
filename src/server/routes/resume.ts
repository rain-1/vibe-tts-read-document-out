import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import * as db from '../database.js';
import {
  resumeJob,
  pauseJob,
  canResumeJob,
  getResumeCheckpoint,
  exportJobProgress,
} from '../services/job-resume.js';

const jobIdSchema = z.object({
  id: z.string().min(1),
});

export async function resumeRoutes(fastify: FastifyInstance) {
  // Check if job can be resumed
  fastify.get(
    '/api/jobs/:id/resume-status',
    async (
      request: FastifyRequest<{ Params: z.infer<typeof jobIdSchema> }>,
      reply: FastifyReply
    ) => {
      const { id } = jobIdSchema.parse(request.params);

      const job = db.getJob(id);
      if (!job) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      const canResume = canResumeJob(job);
      const checkpoint = canResume ? getResumeCheckpoint(job) : null;

      return {
        canResume,
        checkpoint,
        currentStatus: job.status,
      };
    }
  );

  // Resume a failed/paused job
  fastify.post(
    '/api/jobs/:id/resume',
    async (
      request: FastifyRequest<{ Params: z.infer<typeof jobIdSchema> }>,
      reply: FastifyReply
    ) => {
      const { id } = jobIdSchema.parse(request.params);

      const result = await resumeJob(id);

      if (!result.success) {
        return reply.code(400).send({ error: result.message });
      }

      return result;
    }
  );

  // Pause a running job
  fastify.post(
    '/api/jobs/:id/pause',
    async (
      request: FastifyRequest<{ Params: z.infer<typeof jobIdSchema> }>,
      reply: FastifyReply
    ) => {
      const { id } = jobIdSchema.parse(request.params);

      const result = await pauseJob(id);

      if (!result.success) {
        return reply.code(400).send({ error: result.message });
      }

      return result;
    }
  );

  // Export job progress as JSONL
  fastify.get(
    '/api/jobs/:id/export',
    async (
      request: FastifyRequest<{ Params: z.infer<typeof jobIdSchema> }>,
      reply: FastifyReply
    ) => {
      const { id } = jobIdSchema.parse(request.params);

      const jsonl = exportJobProgress(id);
      if (!jsonl) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      return reply
        .header('Content-Type', 'application/x-ndjson')
        .header('Content-Disposition', `attachment; filename="${id}_progress.jsonl"`)
        .send(jsonl);
    }
  );

  // Retry specific failed segments
  fastify.post(
    '/api/jobs/:id/retry-segments',
    async (
      request: FastifyRequest<{
        Params: z.infer<typeof jobIdSchema>;
        Body: { segmentIds?: string[] };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = jobIdSchema.parse(request.params);
      const { segmentIds } = request.body || {};

      const job = db.getJob(id);
      if (!job) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      // Reset specified segments (or all failed ones if not specified)
      const updatedSegments = job.segments.map((seg) => {
        const shouldRetry = segmentIds
          ? segmentIds.includes(seg.id)
          : seg.status === 'failed';

        if (shouldRetry) {
          return { ...seg, status: 'pending' as const };
        }
        return seg;
      });

      db.updateJobSegments(id, updatedSegments);

      // Resume the job
      const result = await resumeJob(id);

      return result;
    }
  );
}
