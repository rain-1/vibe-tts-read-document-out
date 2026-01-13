import { AppConfig } from '../shared/types.js';
import path from 'path';

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    llm: {
      apiUrl: getEnv('LLM_API_URL', 'https://api.openai.com/v1'),
      apiKey: getEnv('LLM_API_KEY', ''),
      model: getEnv('LLM_MODEL', 'gpt-4o-mini'),
    },
    tts: {
      provider: getEnv('TTS_PROVIDER', 'openai') as 'openai' | 'elevenlabs' | 'edge-tts' | 'kokoro',
      openai: {
        apiKey: getEnv('OPENAI_API_KEY', ''),
        model: getEnv('OPENAI_TTS_MODEL', 'tts-1'),
      },
      elevenlabs: {
        apiKey: getEnv('ELEVENLABS_API_KEY', ''),
        model: getEnv('ELEVENLABS_MODEL', 'eleven_multilingual_v2'),
      },
      kokoro: {
        apiUrl: getEnv('KOKORO_MODAL_URL', ''),
      },
    },
    paths: {
      uploads: path.resolve(getEnv('UPLOAD_DIR', './data/uploads')),
      outputs: path.resolve(getEnv('OUTPUT_DIR', './data/outputs')),
      temp: path.resolve(getEnv('TEMP_DIR', './data/temp')),
      database: path.resolve(getEnv('DATABASE_PATH', './data/database.sqlite')),
    },
    redis: {
      url: getEnv('REDIS_URL', 'redis://localhost:6379'),
    },
  };
}

export const config = loadConfig();
