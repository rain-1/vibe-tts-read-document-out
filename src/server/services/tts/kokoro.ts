import { TTSVoice } from '../../../shared/types.js';
import { BaseTTSProvider, TTSRequest, TTSResult, TTSProviderConfig } from './base.js';
import { config } from '../../config.js';
import fs from 'fs/promises';

// Kokoro voices available via Modal deployment
const KOKORO_VOICES: TTSVoice[] = [
  // American English - Female
  { id: 'af_heart', name: 'Heart', gender: 'female', language: 'en-US', description: 'Warm, friendly female voice' },
  { id: 'af_alloy', name: 'Alloy', gender: 'female', language: 'en-US', description: 'Clear, professional female voice' },
  { id: 'af_aoede', name: 'Aoede', gender: 'female', language: 'en-US', description: 'Melodic female voice' },
  { id: 'af_bella', name: 'Bella', gender: 'female', language: 'en-US', description: 'Elegant female voice' },
  { id: 'af_jessica', name: 'Jessica', gender: 'female', language: 'en-US', description: 'Youthful female voice' },
  { id: 'af_kore', name: 'Kore', gender: 'female', language: 'en-US', description: 'Expressive female voice' },
  { id: 'af_nicole', name: 'Nicole', gender: 'female', language: 'en-US', description: 'Sophisticated female voice' },
  { id: 'af_nova', name: 'Nova', gender: 'female', language: 'en-US', description: 'Modern female voice' },
  { id: 'af_river', name: 'River', gender: 'female', language: 'en-US', description: 'Flowing, natural female voice' },
  { id: 'af_sarah', name: 'Sarah', gender: 'female', language: 'en-US', description: 'Friendly female voice' },
  { id: 'af_sky', name: 'Sky', gender: 'female', language: 'en-US', description: 'Light, airy female voice' },
  // American English - Male
  { id: 'am_adam', name: 'Adam', gender: 'male', language: 'en-US', description: 'Strong male voice' },
  { id: 'am_echo', name: 'Echo', gender: 'male', language: 'en-US', description: 'Resonant male voice' },
  { id: 'am_eric', name: 'Eric', gender: 'male', language: 'en-US', description: 'Professional male voice' },
  { id: 'am_fenrir', name: 'Fenrir', gender: 'male', language: 'en-US', description: 'Deep, powerful male voice' },
  { id: 'am_liam', name: 'Liam', gender: 'male', language: 'en-US', description: 'Friendly male voice' },
  { id: 'am_michael', name: 'Michael', gender: 'male', language: 'en-US', description: 'Authoritative male voice' },
  { id: 'am_onyx', name: 'Onyx', gender: 'male', language: 'en-US', description: 'Rich, dark male voice' },
  { id: 'am_puck', name: 'Puck', gender: 'male', language: 'en-US', description: 'Playful male voice' },
  { id: 'am_santa', name: 'Santa', gender: 'male', language: 'en-US', description: 'Jolly male voice' },
  // British English - Female
  { id: 'bf_alice', name: 'Alice', gender: 'female', language: 'en-GB', description: 'British female voice' },
  { id: 'bf_emma', name: 'Emma', gender: 'female', language: 'en-GB', description: 'British female voice' },
  { id: 'bf_isabella', name: 'Isabella', gender: 'female', language: 'en-GB', description: 'British female voice' },
  { id: 'bf_lily', name: 'Lily', gender: 'female', language: 'en-GB', description: 'British female voice' },
  // British English - Male
  { id: 'bm_daniel', name: 'Daniel', gender: 'male', language: 'en-GB', description: 'British male voice' },
  { id: 'bm_fable', name: 'Fable', gender: 'male', language: 'en-GB', description: 'British storyteller voice' },
  { id: 'bm_george', name: 'George', gender: 'male', language: 'en-GB', description: 'British male voice' },
  { id: 'bm_lewis', name: 'Lewis', gender: 'male', language: 'en-GB', description: 'British male voice' },
];

export class KokoroTTSProvider extends BaseTTSProvider {
  readonly name = 'kokoro';
  readonly config: TTSProviderConfig = {
    maxCharacters: 5000, // Kokoro handles long text well
    supportedFormats: ['wav', 'mp3'],
    defaultFormat: 'wav',
  };

  private apiUrl: string;

  constructor() {
    super();
    this.apiUrl = config.tts.kokoro?.apiUrl || process.env.KOKORO_MODAL_URL || '';
    if (!this.apiUrl) {
      console.warn('Kokoro TTS: No API URL configured. Set KOKORO_MODAL_URL environment variable.');
    }
  }

  async getVoices(): Promise<TTSVoice[]> {
    // If we have an API URL, try to fetch voices from the endpoint
    if (this.apiUrl) {
      try {
        const response = await fetch(`${this.apiUrl}/voices`);
        if (response.ok) {
          const voices = await response.json();
          return voices.map((v: any) => ({
            id: v.id,
            name: v.name,
            gender: v.gender as 'male' | 'female' | 'neutral',
            language: v.language,
            description: v.description,
          }));
        }
      } catch (error) {
        console.warn('Failed to fetch voices from Kokoro API, using defaults:', error);
      }
    }

    // Return default voice list
    return KOKORO_VOICES;
  }

  async synthesize(request: TTSRequest): Promise<TTSResult> {
    const startTime = Date.now();

    if (!this.apiUrl) {
      return {
        success: false,
        error: 'Kokoro TTS API URL not configured. Set KOKORO_MODAL_URL environment variable or deploy the Modal endpoint.',
      };
    }

    try {
      // Determine output format from the output path
      const format = request.outputPath.endsWith('.mp3') ? 'mp3' : 'wav';

      // Call the Modal endpoint
      const response = await fetch(`${this.apiUrl}/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: request.text,
          voice: request.voiceId,
          speed: request.speed || 1.0,
          output_format: format,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Kokoro API error (${response.status}): ${errorText}`);
      }

      // Get the audio data
      const audioBuffer = await response.arrayBuffer();

      // Write to file
      await fs.writeFile(request.outputPath, Buffer.from(audioBuffer));

      const durationMs = Date.now() - startTime;

      return {
        success: true,
        outputPath: request.outputPath,
        durationMs,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during Kokoro synthesis',
      };
    }
  }
}
