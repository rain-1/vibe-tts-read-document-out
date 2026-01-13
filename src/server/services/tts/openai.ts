import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { config } from '../../config.js';
import { TTSVoice } from '../../../shared/types.js';
import { BaseTTSProvider, TTSProviderConfig, TTSRequest, TTSResult } from './base.js';

export class OpenAITTSProvider extends BaseTTSProvider {
  readonly name = 'openai';
  readonly config: TTSProviderConfig = {
    maxCharacters: 4096,
    supportedFormats: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'],
    defaultFormat: 'mp3',
  };

  private client: OpenAI;
  private model: string;

  // OpenAI's built-in voices
  private static readonly VOICES: TTSVoice[] = [
    { id: 'alloy', name: 'Alloy', gender: 'neutral', description: 'Neutral, balanced voice' },
    { id: 'echo', name: 'Echo', gender: 'male', description: 'Warm, conversational male' },
    { id: 'fable', name: 'Fable', gender: 'male', description: 'Expressive storytelling male' },
    { id: 'onyx', name: 'Onyx', gender: 'male', description: 'Deep, authoritative male' },
    { id: 'nova', name: 'Nova', gender: 'female', description: 'Friendly, warm female' },
    { id: 'shimmer', name: 'Shimmer', gender: 'female', description: 'Clear, expressive female' },
    { id: 'ash', name: 'Ash', gender: 'male', description: 'Confident, direct male' },
    { id: 'ballad', name: 'Ballad', gender: 'male', description: 'Soft, soothing male' },
    { id: 'coral', name: 'Coral', gender: 'female', description: 'Warm, engaging female' },
    { id: 'sage', name: 'Sage', gender: 'female', description: 'Wise, measured female' },
    { id: 'verse', name: 'Verse', gender: 'neutral', description: 'Versatile, adaptable voice' },
  ];

  constructor() {
    super();
    this.client = new OpenAI({
      apiKey: config.tts.openai?.apiKey,
    });
    this.model = config.tts.openai?.model ?? 'tts-1';
  }

  async getVoices(): Promise<TTSVoice[]> {
    return OpenAITTSProvider.VOICES;
  }

  async synthesize(request: TTSRequest): Promise<TTSResult> {
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(request.outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Make API request
      const response = await this.client.audio.speech.create({
        model: this.model,
        voice: request.voiceId as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
        input: request.text,
        speed: request.speed ?? 1.0,
        response_format: 'mp3',
      });

      // Get the audio data as buffer
      const buffer = Buffer.from(await response.arrayBuffer());

      // Write to file
      fs.writeFileSync(request.outputPath, buffer);

      // Estimate duration (rough estimate: ~150 words per minute at 1.0 speed)
      const wordCount = request.text.split(/\s+/).length;
      const durationMs = Math.round((wordCount / 150) * 60 * 1000 / (request.speed ?? 1.0));

      return {
        success: true,
        outputPath: request.outputPath,
        durationMs,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
