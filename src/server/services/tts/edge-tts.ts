import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { TTSVoice } from '../../../shared/types.js';
import { BaseTTSProvider, TTSProviderConfig, TTSRequest, TTSResult } from './base.js';

/**
 * Edge TTS Provider - Uses Microsoft Edge's free TTS service via edge-tts CLI
 * Requires: pip install edge-tts
 */
export class EdgeTTSProvider extends BaseTTSProvider {
  readonly name = 'edge-tts';
  readonly config: TTSProviderConfig = {
    maxCharacters: 10000, // Edge TTS is quite generous
    supportedFormats: ['mp3', 'wav'],
    defaultFormat: 'mp3',
  };

  // Popular Edge TTS voices
  private static readonly VOICES: TTSVoice[] = [
    // English US voices
    { id: 'en-US-AriaNeural', name: 'Aria (US)', gender: 'female', description: 'Friendly, positive female' },
    { id: 'en-US-JennyNeural', name: 'Jenny (US)', gender: 'female', description: 'Warm, professional female' },
    { id: 'en-US-GuyNeural', name: 'Guy (US)', gender: 'male', description: 'Casual, friendly male' },
    { id: 'en-US-DavisNeural', name: 'Davis (US)', gender: 'male', description: 'Calm, professional male' },
    { id: 'en-US-TonyNeural', name: 'Tony (US)', gender: 'male', description: 'Friendly, conversational male' },
    { id: 'en-US-SaraNeural', name: 'Sara (US)', gender: 'female', description: 'Cheerful, expressive female' },
    { id: 'en-US-NancyNeural', name: 'Nancy (US)', gender: 'female', description: 'Warm, empathetic female' },
    // English UK voices
    { id: 'en-GB-SoniaNeural', name: 'Sonia (UK)', gender: 'female', description: 'Warm British female' },
    { id: 'en-GB-RyanNeural', name: 'Ryan (UK)', gender: 'male', description: 'Professional British male' },
    // English AU voices
    { id: 'en-AU-NatashaNeural', name: 'Natasha (AU)', gender: 'female', description: 'Clear Australian female' },
    { id: 'en-AU-WilliamNeural', name: 'William (AU)', gender: 'male', description: 'Friendly Australian male' },
  ];

  async getVoices(): Promise<TTSVoice[]> {
    return EdgeTTSProvider.VOICES;
  }

  async synthesize(request: TTSRequest): Promise<TTSResult> {
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(request.outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Use edge-tts CLI
      const result = await this.runEdgeTTS(
        request.text,
        request.voiceId,
        request.outputPath,
        request.speed
      );

      if (!result.success) {
        return result;
      }

      // Estimate duration
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

  private runEdgeTTS(
    text: string,
    voice: string,
    outputPath: string,
    speed?: number
  ): Promise<TTSResult> {
    return new Promise((resolve) => {
      const args = [
        '-m', 'edge_tts',
        '--voice', voice,
        '--text', text,
        '--write-media', outputPath,
      ];

      if (speed && speed !== 1.0) {
        // Convert speed to percentage change
        const ratePercent = Math.round((speed - 1) * 100);
        args.push('--rate', `${ratePercent >= 0 ? '+' : ''}${ratePercent}%`);
      }

      const proc = spawn('python3', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          resolve({ success: true, outputPath });
        } else {
          resolve({
            success: false,
            error: stderr || `edge-tts exited with code ${code}`,
          });
        }
      });

      proc.on('error', (err) => {
        resolve({
          success: false,
          error: `Failed to run edge-tts: ${err.message}. Make sure edge-tts is installed: pip install edge-tts`,
        });
      });
    });
  }
}
