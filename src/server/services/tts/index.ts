import { config } from '../../config.js';
import { BaseTTSProvider } from './base.js';
import { OpenAITTSProvider } from './openai.js';
import { ElevenLabsTTSProvider } from './elevenlabs.js';
import { EdgeTTSProvider } from './edge-tts.js';
import { KokoroTTSProvider } from './kokoro.js';

export type TTSProviderType = 'openai' | 'elevenlabs' | 'edge-tts' | 'kokoro';

const providers: Record<TTSProviderType, () => BaseTTSProvider> = {
  'openai': () => new OpenAITTSProvider(),
  'elevenlabs': () => new ElevenLabsTTSProvider(),
  'edge-tts': () => new EdgeTTSProvider(),
  'kokoro': () => new KokoroTTSProvider(),
};

let currentProvider: BaseTTSProvider | null = null;

/**
 * Get the configured TTS provider
 */
export function getTTSProvider(): BaseTTSProvider {
  if (!currentProvider) {
    const providerType = config.tts.provider;
    const factory = providers[providerType];
    if (!factory) {
      throw new Error(`Unknown TTS provider: ${providerType}`);
    }
    currentProvider = factory();
  }
  return currentProvider;
}

/**
 * Get a specific TTS provider by name
 */
export function getTTSProviderByName(name: TTSProviderType): BaseTTSProvider {
  const factory = providers[name];
  if (!factory) {
    throw new Error(`Unknown TTS provider: ${name}`);
  }
  return factory();
}

/**
 * List available TTS providers
 */
export function listTTSProviders(): TTSProviderType[] {
  return Object.keys(providers) as TTSProviderType[];
}

export { BaseTTSProvider } from './base.js';
export type { TTSRequest, TTSResult, TTSProviderConfig } from './base.js';
