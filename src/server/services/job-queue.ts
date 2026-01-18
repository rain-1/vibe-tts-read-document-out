import { Queue, Worker, Job as BullJob } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config.js';
import { Job, JobStatus, TextSegment, JobProgress, VoiceProfileSpeaker } from '../../shared/types.js';
import * as db from '../database.js';
import { parseDocument, cleanTextForTTS } from './document-parser.js';
import { analyzeDocument, analyzeDocumentWithProfile } from './llm-analyzer.js';
import { getTTSProvider } from './tts/index.js';
import { stitchAudioFiles } from './audio-stitcher.js';
import { nanoid } from 'nanoid';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

const logger = pino({ name: 'job-queue' });

// Redis connection
const connection = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null,
});

// Job data stored in queue
interface JobData {
  jobId: string;
  documentContent: string;
  fileType: 'text' | 'pdf' | 'html';
  voiceProfileId?: string;
  autoUpdateProfile?: boolean; // Automatically add new speakers to the profile
}

// Progress callback type
type ProgressCallback = (jobId: string, progress: JobProgress) => void;

// Global progress callback (set by websocket handler)
let progressCallback: ProgressCallback | null = null;

export function setProgressCallback(callback: ProgressCallback): void {
  progressCallback = callback;
}

// Create the queue
export const documentQueue = new Queue<JobData>('document-to-audio', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600, // Keep for 24 hours
    },
    removeOnFail: {
      count: 50,
    },
  },
});

/**
 * Add a new document processing job
 */
export async function addJob(
  jobId: string,
  documentContent: string,
  fileType: 'text' | 'pdf' | 'html',
  voiceProfileId?: string,
  autoUpdateProfile?: boolean
): Promise<void> {
  await documentQueue.add(
    'process',
    { jobId, documentContent, fileType, voiceProfileId, autoUpdateProfile },
    { jobId }
  );
}

/**
 * Update job progress and notify listeners
 */
function updateProgress(
  jobId: string,
  status: JobStatus,
  progress: Partial<JobProgress>,
  errorMessage?: string
): void {
  // Update database
  db.updateJobStatus(jobId, status, progress, errorMessage);

  // Get full job for progress callback
  const job = db.getJob(jobId);
  if (job && progressCallback) {
    progressCallback(jobId, job.progress);
  }
}

/**
 * Calculate estimated time remaining
 */
function estimateTimeRemaining(
  startTime: number,
  completed: number,
  total: number
): number | undefined {
  if (completed === 0) return undefined;

  const elapsed = Date.now() - startTime;
  const avgTimePerItem = elapsed / completed;
  const remaining = total - completed;

  return Math.round((remaining * avgTimePerItem) / 1000); // seconds
}

/**
 * Process a single TTS segment with retry logic
 */
async function processSegment(
  jobId: string,
  segment: TextSegment,
  voiceId: string,
  outputDir: string,
  maxRetries = 3
): Promise<{ success: boolean; audioFile?: string; durationMs?: number; error?: string }> {
  const ttsProvider = getTTSProvider();
  const outputPath = path.join(outputDir, `segment_${segment.index.toString().padStart(5, '0')}.mp3`);

  // Clean text for TTS
  const cleanedText = cleanTextForTTS(segment.text);
  if (!cleanedText) {
    return { success: true }; // Skip empty segments
  }

  // Split text if too long for provider
  const textChunks = ttsProvider.splitText(cleanedText);

  // If single chunk, process directly
  if (textChunks.length === 1) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const result = await ttsProvider.synthesize({
        text: textChunks[0],
        voiceId,
        outputPath,
      });

      if (result.success) {
        return {
          success: true,
          audioFile: outputPath,
          durationMs: result.durationMs,
        };
      }

      // Wait before retry
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      } else {
        return { success: false, error: result.error };
      }
    }
  }

  // Multiple chunks: synthesize each and concatenate
  const chunkFiles: string[] = [];

  for (let i = 0; i < textChunks.length; i++) {
    const chunkPath = path.join(
      outputDir,
      `segment_${segment.index.toString().padStart(5, '0')}_chunk_${i}.mp3`
    );

    let success = false;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const result = await ttsProvider.synthesize({
        text: textChunks[i],
        voiceId,
        outputPath: chunkPath,
      });

      if (result.success) {
        chunkFiles.push(chunkPath);
        success = true;
        break;
      }

      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }

    if (!success) {
      // Clean up partial files
      for (const f of chunkFiles) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      return { success: false, error: 'Failed to synthesize text chunks' };
    }
  }

  // Concatenate chunks
  const { stitchAudioFiles } = await import('./audio-stitcher.js');
  const stitchResult = await stitchAudioFiles(
    chunkFiles.map((f, i) => ({ filePath: f, index: i })),
    { outputPath, silenceBetweenSegments: 0 }
  );

  // Clean up chunk files
  for (const f of chunkFiles) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  if (!stitchResult.success) {
    return { success: false, error: stitchResult.error };
  }

  return {
    success: true,
    audioFile: outputPath,
    durationMs: stitchResult.totalDurationMs,
  };
}

/**
 * Main job processor
 */
async function processJob(bullJob: BullJob<JobData>): Promise<void> {
  const { jobId, documentContent, fileType, voiceProfileId, autoUpdateProfile } = bullJob.data;
  const startTime = Date.now();

  logger.info({ jobId, voiceProfileId }, 'Starting job processing');

  // Track new speakers for profile update
  let newSpeakersForProfile: VoiceProfileSpeaker[] = [];

  // Check if this is a resumed job (already has segments)
  const existingJob = db.getJob(jobId);
  const isResumedJob = existingJob && existingJob.segments.length > 0;
  let segments: TextSegment[] = isResumedJob ? existingJob.segments : [];

  if (isResumedJob) {
    logger.info({ jobId, segmentCount: existingJob.segments.length }, 'Resuming job with existing segments');
  }

  try {
    if (!isResumedJob) {
      // Need document content for new jobs
      if (!documentContent) {
        throw new Error('Cannot process job: no document content provided. Job cannot be restarted - please upload the document again.');
      }

      // Step 1: Parse document
      updateProgress(jobId, 'parsing', {
        stepDescription: 'Parsing document...',
        overallProgress: 5,
        stepProgress: 0,
      });

      const parsed = await parseDocument(
        fileType === 'pdf' ? Buffer.from(documentContent, 'base64') : documentContent,
        fileType
      );

      logger.info({ jobId, textLength: parsed.text.length }, 'Document parsed');

      updateProgress(jobId, 'parsing', {
        stepDescription: 'Document parsed',
        overallProgress: 10,
        stepProgress: 100,
      });

      // Step 2: Analyze document with LLM
      updateProgress(jobId, 'analyzing', {
        stepDescription: 'Analyzing speakers and content...',
        overallProgress: 15,
        stepProgress: 0,
      });

      // Check if we have a voice profile to use
      let analysis;
      const voiceProfile = voiceProfileId ? db.getVoiceProfile(voiceProfileId) : null;

      if (voiceProfile) {
        logger.info({ jobId, profileName: voiceProfile.name }, 'Using voice profile');
        updateProgress(jobId, 'analyzing', {
          stepDescription: `Analyzing with profile: ${voiceProfile.name}...`,
          overallProgress: 15,
          stepProgress: 10,
        });

        const result = await analyzeDocumentWithProfile(parsed.text, voiceProfile);
        analysis = result.analysis;
        newSpeakersForProfile = result.newSpeakers;

        if (newSpeakersForProfile.length > 0) {
          logger.info(
            { jobId, newSpeakers: newSpeakersForProfile.map((s) => s.name) },
            'New speakers detected'
          );
        }
      } else {
        analysis = await analyzeDocument(parsed.text);
      }

      logger.info(
        { jobId, speakerCount: analysis.speakers.length, segmentCount: analysis.segments.length },
        'Document analyzed'
      );

      // Save speakers to database
      db.updateJobSpeakers(jobId, analysis.speakers);

      // Create text segments with IDs
      segments = analysis.segments.map((seg, index) => ({
        id: nanoid(),
        index,
        text: seg.text,
        speakerId: seg.speakerId,
        speakerName: seg.speakerName,
        status: 'pending',
        retryCount: 0,
      }));

      db.updateJobSegments(jobId, segments);

      updateProgress(jobId, 'analyzing', {
        stepDescription: `Found ${analysis.speakers.length} speakers, ${segments.length} segments`,
        overallProgress: 25,
        stepProgress: 100,
        segmentsTotal: segments.length,
      });
    }

    // Step 3: Generate TTS for each segment
    const outputDir = path.join(config.paths.temp, jobId);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get speakers from database (for resumed jobs, or the just-saved ones)
    const currentJob = db.getJob(jobId)!;
    const speakers = currentJob.speakers;

    // Create a map of speaker ID to voice ID
    const speakerVoiceMap = new Map(
      speakers.map((s) => [s.id, s.voiceId])
    );

    // For resumed jobs, collect already completed segments and count them
    const audioSegments: Array<{ filePath: string; index: number }> = [];
    let alreadyCompletedCount = 0;

    if (isResumedJob) {
      for (const seg of segments) {
        if (seg.status === 'completed' && seg.audioFile && fs.existsSync(seg.audioFile)) {
          audioSegments.push({ filePath: seg.audioFile, index: seg.index });
          alreadyCompletedCount++;
        }
      }
      logger.info({ jobId, alreadyCompletedCount }, 'Found already completed segments');
    }

    updateProgress(jobId, 'generating_tts', {
      stepDescription: isResumedJob ? `Resuming speech generation (${alreadyCompletedCount} already done)...` : 'Generating speech...',
      overallProgress: 30 + Math.round((alreadyCompletedCount / segments.length) * 50),
      stepProgress: Math.round((alreadyCompletedCount / segments.length) * 100),
      segmentsTotal: segments.length,
      segmentsCompleted: alreadyCompletedCount,
    });

    let completedSegments = alreadyCompletedCount;
    let failedSegments = 0;

    for (const segment of segments) {
      // Skip already completed segments
      if (segment.status === 'completed' && segment.audioFile && fs.existsSync(segment.audioFile)) {
        continue;
      }

      const voiceId = speakerVoiceMap.get(segment.speakerId) ?? 'af_heart'; // Default to Kokoro voice

      // Update segment status to processing
      db.updateSegmentStatus(jobId, segment.id, 'processing');

      const result = await processSegment(jobId, segment, voiceId, outputDir);

      if (result.success && result.audioFile) {
        db.updateSegmentStatus(
          jobId,
          segment.id,
          'completed',
          result.audioFile,
          result.durationMs
        );
        audioSegments.push({
          filePath: result.audioFile,
          index: segment.index,
        });
      } else if (result.success) {
        // Empty segment, mark as completed
        db.updateSegmentStatus(jobId, segment.id, 'completed');
      } else {
        db.updateSegmentStatus(
          jobId,
          segment.id,
          'failed',
          undefined,
          undefined,
          result.error
        );
        failedSegments++;
      }

      completedSegments++;

      const ttsProgress = Math.round((completedSegments / segments.length) * 100);
      const overallProgress = 30 + Math.round((completedSegments / segments.length) * 50);

      updateProgress(jobId, 'generating_tts', {
        stepDescription: `Generating speech: ${completedSegments}/${segments.length}`,
        overallProgress,
        stepProgress: ttsProgress,
        segmentsCompleted: completedSegments,
        estimatedTimeRemaining: estimateTimeRemaining(startTime, completedSegments - alreadyCompletedCount, segments.length - alreadyCompletedCount),
      });

      // Allow some failures but not too many
      if (failedSegments > segments.length * 0.1) {
        throw new Error(`Too many failed segments: ${failedSegments}/${segments.length}`);
      }
    }

    logger.info(
      { jobId, completedSegments, failedSegments, audioSegmentCount: audioSegments.length },
      'TTS generation complete'
    );

    // Step 4: Stitch audio files
    if (audioSegments.length === 0) {
      throw new Error('No audio segments were generated');
    }

    updateProgress(jobId, 'stitching', {
      stepDescription: 'Combining audio files...',
      overallProgress: 85,
      stepProgress: 0,
    });

    const finalOutputPath = path.join(config.paths.outputs, `${jobId}.mp3`);
    const stitchResult = await stitchAudioFiles(audioSegments, {
      outputPath: finalOutputPath,
      silenceBetweenSegments: 400,
      normalizeAudio: true,
    });

    if (!stitchResult.success) {
      throw new Error(`Failed to stitch audio: ${stitchResult.error}`);
    }

    // Clean up temp files
    for (const seg of audioSegments) {
      if (fs.existsSync(seg.filePath)) {
        fs.unlinkSync(seg.filePath);
      }
    }
    if (fs.existsSync(outputDir)) {
      fs.rmdirSync(outputDir, { recursive: true });
    }

    // Update voice profile with new speakers if enabled
    if (voiceProfileId && autoUpdateProfile && newSpeakersForProfile.length > 0) {
      logger.info(
        { jobId, profileId: voiceProfileId, newSpeakers: newSpeakersForProfile.length },
        'Adding new speakers to voice profile'
      );

      for (const newSpeaker of newSpeakersForProfile) {
        db.addSpeakerToProfile(voiceProfileId, newSpeaker);
      }
    }

    // Update job as completed
    db.setJobOutputFile(jobId, finalOutputPath);
    updateProgress(jobId, 'completed', {
      stepDescription: 'Audio generation complete!',
      overallProgress: 100,
      stepProgress: 100,
    });

    logger.info(
      { jobId, outputPath: finalOutputPath, durationMs: stitchResult.totalDurationMs },
      'Job completed successfully'
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ jobId, error: errorMessage }, 'Job failed');

    updateProgress(
      jobId,
      'failed',
      {
        stepDescription: `Failed: ${errorMessage}`,
      },
      errorMessage
    );

    throw error; // Re-throw for BullMQ retry logic
  }
}

/**
 * Create and start the worker
 */
export function createWorker(): Worker<JobData> {
  const worker = new Worker<JobData>('document-to-audio', processJob, {
    connection,
    concurrency: 2, // Process up to 2 jobs at once
    limiter: {
      max: 10,
      duration: 60000, // Max 10 jobs per minute (rate limiting)
    },
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.data.jobId }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    if (job) {
      logger.error({ jobId: job.data.jobId, error: err.message }, 'Job failed');
    }
  });

  worker.on('error', (err) => {
    logger.error({ error: err.message }, 'Worker error');
  });

  return worker;
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const [waiting, active, completed, failed] = await Promise.all([
    documentQueue.getWaitingCount(),
    documentQueue.getActiveCount(),
    documentQueue.getCompletedCount(),
    documentQueue.getFailedCount(),
  ]);

  return { waiting, active, completed, failed };
}
