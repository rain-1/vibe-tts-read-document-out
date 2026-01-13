import fs from 'fs';
import path from 'path';
import { config } from '../../config.js';
import { TTSVoice } from '../../../shared/types.js';
import { BaseTTSProvider, TTSProviderConfig, TTSRequest, TTSResult } from './base.js';

export class ElevenLabsTTSProvider extends BaseTTSProvider {
  readonly name = 'elevenlabs';
  readonly config: TTSProviderConfig = {
    maxCharacters: 5000, // Conservative limit for standard models
    supportedFormats: ['mp3', 'pcm', 'ulaw'],
    defaultFormat: 'mp3',
  };

  private apiKey: string;
  private model: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  // Some popular ElevenLabs voices (you can fetch more via API)
  private static readonly DEFAULT_VOICES: TTSVoice[] = [
    { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female', description: 'Calm, young female' },
    { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', gender: 'female', description: 'Strong, confident female' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', gender: 'female', description: 'Soft, gentle female' },
    { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', gender: 'male', description: 'Well-rounded male' },
    { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', gender: 'female', description: 'Emotional, expressive female' },
    { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male', description: 'Deep, narrative male' },
    { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', gender: 'male', description: 'Crisp, clear male' },
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male', description: 'Deep, mature male' },
    { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'male', description: 'Raspy, dynamic male' },
  ];

  constructor() {
    super();
    this.apiKey = config.tts.elevenlabs?.apiKey ?? '';
    this.model = config.tts.elevenlabs?.model ?? 'eleven_multilingual_v2';
  }

  async getVoices(): Promise<TTSVoice[]> {
    if (!this.apiKey) {
      return ElevenLabsTTSProvider.DEFAULT_VOICES;
    }

    try {
      const response = await fetch(`${this.baseUrl}/voices`, {
        headers: {
          'xi-api-key': this.apiKey,
        },
      });

      if (!response.ok) {
        return ElevenLabsTTSProvider.DEFAULT_VOICES;
      }

      const data = await response.json() as {
        voices: Array<{
          voice_id: string;
          name: string;
          labels?: { gender?: string };
          description?: string;
        }>;
      };

      return data.voices.map((v) => ({
        id: v.voice_id,
        name: v.name,
        gender: (v.labels?.gender as 'male' | 'female' | 'neutral') ?? 'neutral',
        description: v.description,
      }));
    } catch {
      return ElevenLabsTTSProvider.DEFAULT_VOICES;
    }
  }

  async synthesize(request: TTSRequest): Promise<TTSResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'ElevenLabs API key not configured',
      };
    }

    try {
      // Ensure output directory exists
      const outputDir = path.dirname(request.outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Make API request
      const response = await fetch(
        `${this.baseUrl}/text-to-speech/${request.voiceId}`,
        {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey,
          },
          body: JSON.stringify({
            text: request.text,
            model_id: this.model,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.5,
              use_speaker_boost: true,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
      }

      // Get audio data
      const buffer = Buffer.from(await response.arrayBuffer());

      // Write to file
      fs.writeFileSync(request.outputPath, buffer);

      // Estimate duration
      const wordCount = request.text.split(/\s+/).length;
      const durationMs = Math.round((wordCount / 150) * 60 * 1000);

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
