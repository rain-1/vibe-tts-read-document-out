/**
 * Job Resume Service
 *
 * Handles resuming failed or paused jobs from their last checkpoint.
 * Key features:
 * - Tracks segment-level progress
 * - Can resume from any TTS segment
 * - Preserves already-generated audio files
 */

import * as db from '../database.js';
import { addJob } from './job-queue.js';
import { Job, TextSegment } from '../../shared/types.js';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import pino from 'pino';

const logger = pino({ name: 'job-resume' });

export interface ResumeResult {
  success: boolean;
  message: string;
  resumedFromSegment?: number;
}

/**
 * Check if a job can be resumed
 */
export function canResumeJob(job: Job): boolean {
  // Can only resume failed or paused jobs
  if (job.status !== 'failed' && job.status !== 'paused') {
    return false;
  }

  // Jobs can always be resumed - they'll restart from the appropriate step
  // Even if there are no segments yet (failed during parsing/analyzing),
  // the job can be re-queued to start over
  return true;
}

/**
 * Get resume checkpoint information
 */
export function getResumeCheckpoint(job: Job): {
  completedSegments: number;
  pendingSegments: number;
  failedSegments: number;
  lastCompletedIndex: number;
  audioFilesPresent: number;
} {
  const completedSegments = job.segments.filter((s) => s.status === 'completed');
  const pendingSegments = job.segments.filter((s) => s.status === 'pending');
  const failedSegments = job.segments.filter((s) => s.status === 'failed');

  // Find the last completed segment index
  let lastCompletedIndex = -1;
  for (const seg of completedSegments) {
    if (seg.index > lastCompletedIndex) {
      lastCompletedIndex = seg.index;
    }
  }

  // Check how many audio files are actually present
  let audioFilesPresent = 0;
  for (const seg of completedSegments) {
    if (seg.audioFile && fs.existsSync(seg.audioFile)) {
      audioFilesPresent++;
    }
  }

  return {
    completedSegments: completedSegments.length,
    pendingSegments: pendingSegments.length,
    failedSegments: failedSegments.length,
    lastCompletedIndex,
    audioFilesPresent,
  };
}

/**
 * Resume a failed or paused job
 */
export async function resumeJob(jobId: string): Promise<ResumeResult> {
  const job = db.getJob(jobId);

  if (!job) {
    return { success: false, message: 'Job not found' };
  }

  if (!canResumeJob(job)) {
    return {
      success: false,
      message: `Cannot resume job in status: ${job.status}`,
    };
  }

  // Check if we have segments (job got past analyzing step)
  const hasSegments = job.segments && job.segments.length > 0;

  if (hasSegments) {
    const checkpoint = getResumeCheckpoint(job);

    logger.info(
      {
        jobId,
        checkpoint,
      },
      'Resuming job with segments'
    );

    // Reset failed and pending segments to pending status
    const updatedSegments = job.segments.map((seg) => {
      if (seg.status === 'failed' || seg.status === 'processing') {
        return { ...seg, status: 'pending' as const, retryCount: seg.retryCount };
      }
      return seg;
    });

    db.updateJobSegments(jobId, updatedSegments);

    // Update job status to indicate it's being resumed
    db.updateJobStatus(jobId, 'generating_tts', {
      stepDescription: `Resuming from segment ${checkpoint.lastCompletedIndex + 2}`,
      overallProgress: Math.round(
        (checkpoint.completedSegments / job.segments.length) * 80 + 20
      ),
    });

    // Re-add to queue
    await addJob(jobId, '', job.fileType);

    return {
      success: true,
      message: `Job resumed from segment ${checkpoint.lastCompletedIndex + 2}`,
      resumedFromSegment: checkpoint.lastCompletedIndex + 2,
    };
  } else {
    // Job failed before generating segments - restart from beginning
    logger.info({ jobId }, 'Resuming job from beginning (no segments yet)');

    // Reset to pending status
    db.updateJobStatus(jobId, 'pending', {
      stepDescription: 'Restarting job',
      overallProgress: 0,
      stepProgress: 0,
    });

    // Re-add to queue - will start from parsing
    await addJob(jobId, '', job.fileType);

    return {
      success: true,
      message: 'Job restarted from beginning',
    };
  }
}

/**
 * Pause a running job
 */
export async function pauseJob(jobId: string): Promise<{ success: boolean; message: string }> {
  const job = db.getJob(jobId);

  if (!job) {
    return { success: false, message: 'Job not found' };
  }

  if (job.status === 'completed' || job.status === 'failed') {
    return { success: false, message: 'Cannot pause completed or failed jobs' };
  }

  db.updateJobStatus(jobId, 'paused', {
    stepDescription: 'Job paused by user',
  });

  logger.info({ jobId }, 'Job paused');

  return { success: true, message: 'Job paused' };
}

/**
 * Clean up orphaned audio files for a job
 */
export function cleanupJobFiles(jobId: string): void {
  const tempDir = path.join(config.paths.temp, jobId);

  if (fs.existsSync(tempDir)) {
    logger.info({ jobId, tempDir }, 'Cleaning up job temp files');
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Export job progress as JSONL (for debugging or manual resume)
 */
export function exportJobProgress(jobId: string): string | null {
  const job = db.getJob(jobId);
  if (!job) return null;

  const lines: string[] = [];

  // Job metadata
  lines.push(
    JSON.stringify({
      type: 'metadata',
      jobId: job.id,
      filename: job.originalFilename,
      status: job.status,
      createdAt: job.createdAt,
    })
  );

  // Speakers
  lines.push(
    JSON.stringify({
      type: 'speakers',
      speakers: job.speakers,
    })
  );

  // Segments
  for (const segment of job.segments) {
    lines.push(
      JSON.stringify({
        type: 'segment',
        ...segment,
      })
    );
  }

  return lines.join('\n');
}
