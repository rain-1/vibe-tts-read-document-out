import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export interface AudioSegment {
  filePath: string;
  index: number;
}

export interface StitchOptions {
  outputPath: string;
  format?: 'mp3' | 'wav' | 'ogg' | 'm4a';
  silenceBetweenSegments?: number; // milliseconds
  normalizeAudio?: boolean;
}

export interface StitchResult {
  success: boolean;
  outputPath?: string;
  totalDurationMs?: number;
  error?: string;
}

/**
 * Stitch multiple audio files together into a single file
 */
export async function stitchAudioFiles(
  segments: AudioSegment[],
  options: StitchOptions
): Promise<StitchResult> {
  const {
    outputPath,
    format = 'mp3',
    silenceBetweenSegments = 300, // 300ms default pause
    normalizeAudio = true,
  } = options;

  // Sort segments by index
  const sortedSegments = [...segments].sort((a, b) => a.index - b.index);

  // Verify all files exist
  for (const segment of sortedSegments) {
    if (!fs.existsSync(segment.filePath)) {
      return {
        success: false,
        error: `Audio file not found: ${segment.filePath}`,
      };
    }
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Create a file list for ffmpeg concat
  const listFilePath = path.join(config.paths.temp, `concat_${Date.now()}.txt`);

  try {
    // Create concat file list with silence between segments
    const silenceFile = await generateSilence(silenceBetweenSegments);

    let fileListContent = '';
    for (let i = 0; i < sortedSegments.length; i++) {
      // Escape single quotes in file paths for ffmpeg
      const escapedPath = sortedSegments[i].filePath.replace(/'/g, "'\\''");
      fileListContent += `file '${escapedPath}'\n`;

      // Add silence between segments (but not after the last one)
      if (silenceFile && i < sortedSegments.length - 1) {
        fileListContent += `file '${silenceFile}'\n`;
      }
    }

    fs.writeFileSync(listFilePath, fileListContent);

    // Run ffmpeg concat
    const result = await runFfmpegConcat(listFilePath, outputPath, format, normalizeAudio);

    // Clean up temp files
    fs.unlinkSync(listFilePath);
    if (silenceFile && fs.existsSync(silenceFile)) {
      fs.unlinkSync(silenceFile);
    }

    return result;
  } catch (error) {
    // Clean up on error
    if (fs.existsSync(listFilePath)) {
      fs.unlinkSync(listFilePath);
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during audio stitching',
    };
  }
}

/**
 * Generate a silent audio file of specified duration
 */
async function generateSilence(durationMs: number): Promise<string | null> {
  if (durationMs <= 0) return null;

  const silenceFile = path.join(config.paths.temp, `silence_${Date.now()}.mp3`);

  // Ensure temp directory exists
  if (!fs.existsSync(config.paths.temp)) {
    fs.mkdirSync(config.paths.temp, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input('anullsrc=r=44100:cl=stereo')
      .inputFormat('lavfi')
      .duration(durationMs / 1000)
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .output(silenceFile)
      .on('end', () => resolve(silenceFile))
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Run ffmpeg concat demuxer
 */
function runFfmpegConcat(
  listFile: string,
  outputPath: string,
  format: string,
  normalize: boolean
): Promise<StitchResult> {
  return new Promise((resolve) => {
    let command = ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0']);

    // Add normalization filter if requested
    if (normalize) {
      command = command.audioFilters([
        'loudnorm=I=-16:TP=-1.5:LRA=11',
      ]);
    }

    // Set output options based on format
    switch (format) {
      case 'mp3':
        command = command.audioCodec('libmp3lame').audioBitrate('192k');
        break;
      case 'wav':
        command = command.audioCodec('pcm_s16le');
        break;
      case 'ogg':
        command = command.audioCodec('libvorbis').audioBitrate('192k');
        break;
      case 'm4a':
        command = command.audioCodec('aac').audioBitrate('192k');
        break;
    }

    let totalDuration = 0;

    command
      .output(outputPath)
      .on('codecData', (data) => {
        // Parse duration if available
        if (data.duration) {
          const parts = data.duration.split(':');
          if (parts.length === 3) {
            totalDuration =
              parseFloat(parts[0]) * 3600000 +
              parseFloat(parts[1]) * 60000 +
              parseFloat(parts[2]) * 1000;
          }
        }
      })
      .on('end', () => {
        resolve({
          success: true,
          outputPath,
          totalDurationMs: totalDuration,
        });
      })
      .on('error', (err) => {
        resolve({
          success: false,
          error: `FFmpeg error: ${err.message}`,
        });
      })
      .run();
  });
}

/**
 * Get audio file duration in milliseconds
 */
export function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        const duration = metadata.format.duration ?? 0;
        resolve(Math.round(duration * 1000));
      }
    });
  });
}

/**
 * Convert audio file to a different format
 */
export function convertAudio(
  inputPath: string,
  outputPath: string,
  format: 'mp3' | 'wav' | 'ogg' | 'm4a'
): Promise<StitchResult> {
  return new Promise((resolve) => {
    let command = ffmpeg().input(inputPath);

    switch (format) {
      case 'mp3':
        command = command.audioCodec('libmp3lame').audioBitrate('192k');
        break;
      case 'wav':
        command = command.audioCodec('pcm_s16le');
        break;
      case 'ogg':
        command = command.audioCodec('libvorbis').audioBitrate('192k');
        break;
      case 'm4a':
        command = command.audioCodec('aac').audioBitrate('192k');
        break;
    }

    command
      .output(outputPath)
      .on('end', () => {
        resolve({ success: true, outputPath });
      })
      .on('error', (err) => {
        resolve({ success: false, error: err.message });
      })
      .run();
  });
}
