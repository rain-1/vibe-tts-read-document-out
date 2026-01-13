import { TTSVoice } from '../../../shared/types.js';

export interface TTSRequest {
  text: string;
  voiceId: string;
  outputPath: string;
  speed?: number;
}

export interface TTSResult {
  success: boolean;
  outputPath?: string;
  durationMs?: number;
  error?: string;
}

export interface TTSProviderConfig {
  maxCharacters: number;
  supportedFormats: string[];
  defaultFormat: string;
}

export abstract class BaseTTSProvider {
  abstract readonly name: string;
  abstract readonly config: TTSProviderConfig;

  /**
   * Get available voices for this provider
   */
  abstract getVoices(): Promise<TTSVoice[]>;

  /**
   * Generate speech from text
   */
  abstract synthesize(request: TTSRequest): Promise<TTSResult>;

  /**
   * Split long text into chunks that fit within the provider's limits
   */
  splitText(text: string): string[] {
    const { maxCharacters } = this.config;
    if (text.length <= maxCharacters) {
      return [text];
    }

    const chunks: string[] = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let currentChunk = '';

    for (const sentence of sentences) {
      // If single sentence exceeds limit, split by words
      if (sentence.length > maxCharacters) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
        }
        const words = sentence.split(' ');
        for (const word of words) {
          if (currentChunk.length + word.length + 1 > maxCharacters) {
            if (currentChunk) chunks.push(currentChunk);
            currentChunk = word;
          } else {
            currentChunk += (currentChunk ? ' ' : '') + word;
          }
        }
        continue;
      }

      if (currentChunk.length + sentence.length + 1 > maxCharacters) {
        chunks.push(currentChunk);
        currentChunk = sentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }
}
