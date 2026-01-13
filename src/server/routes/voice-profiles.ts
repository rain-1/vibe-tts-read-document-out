import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import * as db from '../database.js';
import { VoiceProfileSpeaker } from '../../shared/types.js';

// Request validation schemas
const createProfileSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  speakers: z.array(z.object({
    name: z.string().min(1),
    aliases: z.array(z.string()).optional(),
    voiceId: z.string().min(1),
    voiceDescription: z.string().optional(),
    gender: z.enum(['male', 'female', 'neutral']).optional(),
    characteristics: z.array(z.string()).optional(),
  })).optional(),
});

const createFromJobSchema = z.object({
  jobId: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const profileIdSchema = z.object({
  id: z.string().min(1),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

const addSpeakerSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  voiceId: z.string().min(1),
  voiceDescription: z.string().optional(),
  gender: z.enum(['male', 'female', 'neutral']).optional(),
  characteristics: z.array(z.string()).optional(),
});

const updateSpeakerSchema = z.object({
  speakerName: z.string().min(1),
  updates: z.object({
    name: z.string().min(1).optional(),
    aliases: z.array(z.string()).optional(),
    voiceId: z.string().optional(),
    voiceDescription: z.string().optional(),
    gender: z.enum(['male', 'female', 'neutral']).optional(),
    characteristics: z.array(z.string()).optional(),
  }),
});

export async function voiceProfileRoutes(fastify: FastifyInstance) {
  // Create a new voice profile
  fastify.post(
    '/api/voice-profiles',
    async (
      request: FastifyRequest<{ Body: z.infer<typeof createProfileSchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const body = createProfileSchema.parse(request.body);

        const profileId = nanoid();
        const profile = db.createVoiceProfile(
          profileId,
          body.name,
          body.speakers ?? [],
          body.description
        );

        return reply.code(201).send({ profile });
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

  // Create a voice profile from an existing job
  fastify.post(
    '/api/voice-profiles/from-job',
    async (
      request: FastifyRequest<{ Body: z.infer<typeof createFromJobSchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const body = createFromJobSchema.parse(request.body);

        const job = db.getJob(body.jobId);
        if (!job) {
          return reply.code(404).send({ error: 'Job not found' });
        }

        if (job.speakers.length === 0) {
          return reply.code(400).send({ error: 'Job has no speakers to create profile from' });
        }

        const profile = db.createVoiceProfileFromJob(body.jobId, body.name, body.description);
        if (!profile) {
          return reply.code(500).send({ error: 'Failed to create voice profile' });
        }

        return reply.code(201).send({ profile });
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

  // Get all voice profiles
  fastify.get('/api/voice-profiles', async () => {
    const profiles = db.getAllVoiceProfiles();
    return { profiles };
  });

  // Get a specific voice profile
  fastify.get(
    '/api/voice-profiles/:id',
    async (
      request: FastifyRequest<{ Params: z.infer<typeof profileIdSchema> }>,
      reply: FastifyReply
    ) => {
      const { id } = profileIdSchema.parse(request.params);

      const profile = db.getVoiceProfile(id);
      if (!profile) {
        return reply.code(404).send({ error: 'Voice profile not found' });
      }

      // Also get jobs that use this profile
      const jobs = db.getJobsUsingProfile(id);

      return { profile, jobs };
    }
  );

  // Update a voice profile
  fastify.patch(
    '/api/voice-profiles/:id',
    async (
      request: FastifyRequest<{
        Params: z.infer<typeof profileIdSchema>;
        Body: z.infer<typeof updateProfileSchema>;
      }>,
      reply: FastifyReply
    ) => {
      const { id } = profileIdSchema.parse(request.params);
      const body = updateProfileSchema.parse(request.body);

      const profile = db.updateVoiceProfile(id, body);
      if (!profile) {
        return reply.code(404).send({ error: 'Voice profile not found' });
      }

      return { profile };
    }
  );

  // Delete a voice profile
  fastify.delete(
    '/api/voice-profiles/:id',
    async (
      request: FastifyRequest<{ Params: z.infer<typeof profileIdSchema> }>,
      reply: FastifyReply
    ) => {
      const { id } = profileIdSchema.parse(request.params);

      const deleted = db.deleteVoiceProfile(id);
      if (!deleted) {
        return reply.code(404).send({ error: 'Voice profile not found' });
      }

      return { success: true };
    }
  );

  // Add a speaker to a profile
  fastify.post(
    '/api/voice-profiles/:id/speakers',
    async (
      request: FastifyRequest<{
        Params: z.infer<typeof profileIdSchema>;
        Body: z.infer<typeof addSpeakerSchema>;
      }>,
      reply: FastifyReply
    ) => {
      const { id } = profileIdSchema.parse(request.params);
      const speaker = addSpeakerSchema.parse(request.body) as VoiceProfileSpeaker;

      const profile = db.addSpeakerToProfile(id, speaker);
      if (!profile) {
        return reply.code(404).send({ error: 'Voice profile not found' });
      }

      return { profile };
    }
  );

  // Update a speaker in a profile
  fastify.patch(
    '/api/voice-profiles/:id/speakers',
    async (
      request: FastifyRequest<{
        Params: z.infer<typeof profileIdSchema>;
        Body: z.infer<typeof updateSpeakerSchema>;
      }>,
      reply: FastifyReply
    ) => {
      const { id } = profileIdSchema.parse(request.params);
      const { speakerName, updates } = updateSpeakerSchema.parse(request.body);

      const profile = db.getVoiceProfile(id);
      if (!profile) {
        return reply.code(404).send({ error: 'Voice profile not found' });
      }

      // Find and update the speaker
      const speakerIndex = profile.speakers.findIndex(
        (s) => s.name.toLowerCase() === speakerName.toLowerCase()
      );

      if (speakerIndex === -1) {
        return reply.code(404).send({ error: 'Speaker not found in profile' });
      }

      const updatedSpeakers = [...profile.speakers];
      updatedSpeakers[speakerIndex] = {
        ...updatedSpeakers[speakerIndex],
        ...updates,
      };

      const updatedProfile = db.updateVoiceProfile(id, { speakers: updatedSpeakers });
      return { profile: updatedProfile };
    }
  );

  // Remove a speaker from a profile
  fastify.delete(
    '/api/voice-profiles/:id/speakers/:speakerName',
    async (
      request: FastifyRequest<{
        Params: z.infer<typeof profileIdSchema> & { speakerName: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id, speakerName } = request.params;

      const profile = db.getVoiceProfile(id);
      if (!profile) {
        return reply.code(404).send({ error: 'Voice profile not found' });
      }

      const updatedSpeakers = profile.speakers.filter(
        (s) => s.name.toLowerCase() !== speakerName.toLowerCase()
      );

      if (updatedSpeakers.length === profile.speakers.length) {
        return reply.code(404).send({ error: 'Speaker not found in profile' });
      }

      const updatedProfile = db.updateVoiceProfile(id, { speakers: updatedSpeakers });
      return { profile: updatedProfile };
    }
  );

  // Add alias to a speaker
  fastify.post(
    '/api/voice-profiles/:id/speakers/:speakerName/aliases',
    async (
      request: FastifyRequest<{
        Params: z.infer<typeof profileIdSchema> & { speakerName: string };
        Body: { alias: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id, speakerName } = request.params;
      const { alias } = request.body;

      if (!alias) {
        return reply.code(400).send({ error: 'Alias is required' });
      }

      const profile = db.getVoiceProfile(id);
      if (!profile) {
        return reply.code(404).send({ error: 'Voice profile not found' });
      }

      const speakerIndex = profile.speakers.findIndex(
        (s) => s.name.toLowerCase() === speakerName.toLowerCase()
      );

      if (speakerIndex === -1) {
        return reply.code(404).send({ error: 'Speaker not found in profile' });
      }

      const updatedSpeakers = [...profile.speakers];
      const currentAliases = updatedSpeakers[speakerIndex].aliases ?? [];

      if (!currentAliases.includes(alias)) {
        updatedSpeakers[speakerIndex] = {
          ...updatedSpeakers[speakerIndex],
          aliases: [...currentAliases, alias],
        };
      }

      const updatedProfile = db.updateVoiceProfile(id, { speakers: updatedSpeakers });
      return { profile: updatedProfile };
    }
  );
}
