import OpenAI from 'openai';
import { config } from '../config.js';
import { DocumentAnalysis, Speaker, TTSVoice, VoiceProfile, VoiceProfileSpeaker } from '../../shared/types.js';
import { nanoid } from 'nanoid';
import { getTTSProvider } from './tts/index.js';

// Create OpenAI client pointing to configured endpoint (works with OpenRouter, etc.)
const openai = new OpenAI({
  baseURL: config.llm.apiUrl,
  apiKey: config.llm.apiKey,
});

// Cache for available voices from the TTS provider
let cachedVoices: TTSVoice[] | null = null;

/**
 * Get voices from the configured TTS provider
 */
async function getProviderVoices(): Promise<TTSVoice[]> {
  if (cachedVoices) {
    return cachedVoices;
  }

  try {
    const provider = getTTSProvider();
    cachedVoices = await provider.getVoices();
    console.log(`Loaded ${cachedVoices.length} voices from ${provider.name} TTS provider`);
    return cachedVoices;
  } catch (error) {
    console.warn('Failed to get voices from TTS provider, using fallback:', error);
    // Fallback to Kokoro voices
    return [
      { id: 'af_heart', name: 'Heart', gender: 'female', description: 'Warm, friendly female voice' },
      { id: 'af_bella', name: 'Bella', gender: 'female', description: 'Elegant female voice' },
      { id: 'af_nova', name: 'Nova', gender: 'female', description: 'Modern female voice' },
      { id: 'am_adam', name: 'Adam', gender: 'male', description: 'Strong male voice' },
      { id: 'am_michael', name: 'Michael', gender: 'male', description: 'Authoritative male voice' },
      { id: 'am_echo', name: 'Echo', gender: 'male', description: 'Resonant male voice' },
    ];
  }
}

// Fallback voices (Kokoro-compatible)
const DEFAULT_VOICES: TTSVoice[] = [
  { id: 'af_heart', name: 'Heart', gender: 'female', description: 'Warm, friendly female voice' },
  { id: 'af_bella', name: 'Bella', gender: 'female', description: 'Elegant female voice' },
  { id: 'af_nova', name: 'Nova', gender: 'female', description: 'Modern female voice' },
  { id: 'am_adam', name: 'Adam', gender: 'male', description: 'Strong male voice' },
  { id: 'am_michael', name: 'Michael', gender: 'male', description: 'Authoritative male voice' },
  { id: 'am_echo', name: 'Echo', gender: 'male', description: 'Resonant male voice' },
];

interface SpeakerAnalysis {
  speakers: Array<{
    name: string;
    gender: 'male' | 'female' | 'neutral';
    role: string;
    voiceDescription: string;
  }>;
}

interface SegmentAnnotation {
  segments: Array<{
    text: string;
    speaker: string;
  }>;
}

/**
 * First pass: Analyze document to identify all speakers/characters
 */
export async function analyzeSpeakers(text: string): Promise<SpeakerAnalysis> {
  const systemPrompt = `You are analyzing a document to identify all speakers/characters for a text-to-speech system.

Your task is to:
1. Identify all distinct speakers in the text (narrator + any characters who speak)
2. Always include a "Narrator" for non-dialogue text
3. For each speaker, determine their gender and provide a brief voice description

Return JSON in this exact format:
{
  "speakers": [
    {
      "name": "Narrator",
      "gender": "neutral",
      "role": "narrator",
      "voiceDescription": "calm, clear, authoritative"
    },
    {
      "name": "Character Name",
      "gender": "male|female|neutral",
      "role": "description of their role",
      "voiceDescription": "brief voice characteristics"
    }
  ]
}

Rules:
- Always include a Narrator
- Identify speakers by name if mentioned, otherwise use descriptive names like "Man", "Woman", "Child"
- Keep voice descriptions short (2-4 words)
- gender must be exactly: "male", "female", or "neutral"`;

  // For very long documents, sample the beginning, middle, and end
  const maxSampleLength = 8000;
  let sample = text;
  if (text.length > maxSampleLength) {
    const partLength = Math.floor(maxSampleLength / 3);
    const start = text.slice(0, partLength);
    const middle = text.slice(
      Math.floor(text.length / 2) - partLength / 2,
      Math.floor(text.length / 2) + partLength / 2
    );
    const end = text.slice(-partLength);
    sample = `[START OF DOCUMENT]\n${start}\n\n[MIDDLE OF DOCUMENT]\n${middle}\n\n[END OF DOCUMENT]\n${end}`;
  }

  const response = await openai.chat.completions.create({
    model: config.llm.model,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Analyze this document and identify all speakers:\n\n${sample}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from LLM');
  }

  try {
    return JSON.parse(content) as SpeakerAnalysis;
  } catch {
    // Fallback: return just narrator
    return {
      speakers: [
        {
          name: 'Narrator',
          gender: 'neutral',
          role: 'narrator',
          voiceDescription: 'calm, clear voice',
        },
      ],
    };
  }
}

/**
 * Second pass: Annotate each segment of text with the appropriate speaker
 */
export async function annotateSegments(
  text: string,
  speakers: string[],
  chunkSize = 3000
): Promise<SegmentAnnotation> {
  const systemPrompt = `You are annotating text segments for a multi-speaker text-to-speech system.

Available speakers: ${speakers.join(', ')}

Your task is to:
1. Split the text into logical segments (sentences or short paragraphs)
2. Assign each segment to the appropriate speaker
3. Use "Narrator" for all non-dialogue text, descriptions, and narration
4. Use character names for their direct speech/dialogue

Return JSON in this exact format:
{
  "segments": [
    {"text": "segment text here", "speaker": "Speaker Name"},
    {"text": "next segment", "speaker": "Another Speaker"}
  ]
}

Rules:
- Keep segments reasonably short (1-3 sentences max)
- Remove quotation marks from dialogue (the voice will convey it's speech)
- Preserve the exact text content (don't paraphrase)
- Every segment must have a speaker from the available list
- Use "Narrator" if unsure`;

  // Process text in chunks for long documents
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let currentChunk = '';

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    }
  }
  if (currentChunk) {
    chunks.push(currentChunk);
  }

  // Process each chunk
  const allSegments: Array<{ text: string; speaker: string }> = [];

  for (const chunk of chunks) {
    const response = await openai.chat.completions.create({
      model: config.llm.model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Annotate this text with speakers:\n\n${chunk}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const content = response.choices[0]?.message?.content;
    if (content) {
      try {
        const parsed = JSON.parse(content) as SegmentAnnotation;
        allSegments.push(...parsed.segments);
      } catch {
        // Fallback: treat entire chunk as narrator
        allSegments.push({ text: chunk, speaker: 'Narrator' });
      }
    }
  }

  return { segments: allSegments };
}

/**
 * Assign voices to speakers based on their characteristics
 */
export function assignVoices(
  speakerAnalysis: SpeakerAnalysis,
  availableVoices: TTSVoice[] = DEFAULT_VOICES
): Speaker[] {
  const assignedVoices = new Set<string>();
  const speakers: Speaker[] = [];

  for (const speaker of speakerAnalysis.speakers) {
    // Find best matching voice based on gender
    let voice = availableVoices.find(
      (v) => v.gender === speaker.gender && !assignedVoices.has(v.id)
    );

    // Fallback: any unassigned voice
    if (!voice) {
      voice = availableVoices.find((v) => !assignedVoices.has(v.id));
    }

    // Last resort: use first available voice
    if (!voice) {
      voice = availableVoices[0];
    }

    assignedVoices.add(voice.id);

    speakers.push({
      id: nanoid(),
      name: speaker.name,
      voiceId: voice.id,
      voiceDescription: speaker.voiceDescription,
      gender: speaker.gender,
      characteristics: [speaker.role],
    });
  }

  return speakers;
}

/**
 * Full document analysis: identify speakers and annotate all text
 */
export async function analyzeDocument(text: string): Promise<DocumentAnalysis> {
  // Step 1: Identify all speakers
  const speakerAnalysis = await analyzeSpeakers(text);

  // Step 2: Get voices from TTS provider and assign to speakers
  const availableVoices = await getProviderVoices();
  const speakers = assignVoices(speakerAnalysis, availableVoices);
  const speakerNames = speakers.map((s) => s.name);

  // Step 3: Annotate all segments with speakers
  const segmentAnnotation = await annotateSegments(text, speakerNames);

  // Map segments to include speaker IDs
  const segments = segmentAnnotation.segments.map((seg) => {
    const speaker = speakers.find((s) => s.name === seg.speaker) ?? speakers[0];
    return {
      text: seg.text,
      speakerId: speaker.id,
      speakerName: speaker.name,
    };
  });

  return { speakers, segments };
}

/**
 * Analyze speakers with an existing voice profile
 * Tries to match detected speakers to existing profile entries
 */
export async function analyzeSpeakersWithProfile(
  text: string,
  profile: VoiceProfile
): Promise<SpeakerAnalysis> {
  const existingSpeakers = profile.speakers.map((s) => {
    const aliases = s.aliases ? ` (also known as: ${s.aliases.join(', ')})` : '';
    return `- ${s.name}${aliases}: ${s.gender}, ${s.voiceDescription || 'no description'}`;
  }).join('\n');

  const systemPrompt = `You are analyzing a document to identify all speakers/characters for a text-to-speech system.

IMPORTANT: This document is part of a series. You MUST use the existing character names when they appear.

Existing characters from previous documents:
${existingSpeakers}

Your task is to:
1. Identify all distinct speakers in the text (narrator + any characters who speak)
2. Match speakers to existing characters when possible (use exact names from the list above)
3. For NEW characters not in the list, create new entries
4. Always include a "Narrator" for non-dialogue text

Return JSON in this exact format:
{
  "speakers": [
    {
      "name": "Narrator",
      "gender": "neutral",
      "role": "narrator",
      "voiceDescription": "calm, clear, authoritative",
      "isExisting": true
    },
    {
      "name": "Character Name",
      "gender": "male|female|neutral",
      "role": "description of their role",
      "voiceDescription": "brief voice characteristics",
      "isExisting": true|false
    }
  ]
}

Rules:
- Always include a Narrator
- Use EXACT names from the existing characters list when the same character appears
- Set "isExisting": true for characters that match the existing list
- Set "isExisting": false for completely new characters
- For new characters, identify by name if mentioned, otherwise use descriptive names
- Keep voice descriptions short (2-4 words)
- gender must be exactly: "male", "female", or "neutral"`;

  // For very long documents, sample the beginning, middle, and end
  const maxSampleLength = 8000;
  let sample = text;
  if (text.length > maxSampleLength) {
    const partLength = Math.floor(maxSampleLength / 3);
    const start = text.slice(0, partLength);
    const middle = text.slice(
      Math.floor(text.length / 2) - partLength / 2,
      Math.floor(text.length / 2) + partLength / 2
    );
    const end = text.slice(-partLength);
    sample = `[START OF DOCUMENT]\n${start}\n\n[MIDDLE OF DOCUMENT]\n${middle}\n\n[END OF DOCUMENT]\n${end}`;
  }

  const response = await openai.chat.completions.create({
    model: config.llm.model,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Analyze this document and identify all speakers, matching to existing characters when possible:\n\n${sample}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from LLM');
  }

  try {
    return JSON.parse(content) as SpeakerAnalysis;
  } catch {
    // Fallback: return just narrator
    return {
      speakers: [
        {
          name: 'Narrator',
          gender: 'neutral',
          role: 'narrator',
          voiceDescription: 'calm, clear voice',
        },
      ],
    };
  }
}

/**
 * Assign voices using an existing profile
 * Reuses voice IDs for existing speakers, assigns new ones for new speakers
 */
export function assignVoicesWithProfile(
  speakerAnalysis: SpeakerAnalysis & { speakers: Array<{ isExisting?: boolean } & SpeakerAnalysis['speakers'][0]> },
  profile: VoiceProfile,
  availableVoices: TTSVoice[] = DEFAULT_VOICES
): Speaker[] {
  const assignedVoices = new Set<string>();
  const speakers: Speaker[] = [];

  // First, mark profile voices as assigned so they're reserved
  for (const profileSpeaker of profile.speakers) {
    assignedVoices.add(profileSpeaker.voiceId);
  }

  for (const speaker of speakerAnalysis.speakers) {
    // Try to find matching profile speaker
    const profileSpeaker = findMatchingProfileSpeaker(speaker.name, profile.speakers);

    if (profileSpeaker) {
      // Use existing voice from profile
      speakers.push({
        id: nanoid(),
        name: speaker.name,
        voiceId: profileSpeaker.voiceId,
        voiceDescription: profileSpeaker.voiceDescription || speaker.voiceDescription,
        gender: profileSpeaker.gender || speaker.gender,
        characteristics: profileSpeaker.characteristics || [speaker.role],
      });
    } else {
      // New speaker - assign a new voice
      let voice = availableVoices.find(
        (v) => v.gender === speaker.gender && !assignedVoices.has(v.id)
      );

      if (!voice) {
        voice = availableVoices.find((v) => !assignedVoices.has(v.id));
      }

      if (!voice) {
        voice = availableVoices[0];
      }

      assignedVoices.add(voice.id);

      speakers.push({
        id: nanoid(),
        name: speaker.name,
        voiceId: voice.id,
        voiceDescription: speaker.voiceDescription,
        gender: speaker.gender,
        characteristics: [speaker.role],
      });
    }
  }

  return speakers;
}

/**
 * Find a matching speaker in the profile by name or aliases
 */
function findMatchingProfileSpeaker(
  name: string,
  profileSpeakers: VoiceProfileSpeaker[]
): VoiceProfileSpeaker | null {
  const normalizedName = name.toLowerCase().trim();

  for (const speaker of profileSpeakers) {
    // Check main name
    if (speaker.name.toLowerCase().trim() === normalizedName) {
      return speaker;
    }

    // Check aliases
    if (speaker.aliases) {
      for (const alias of speaker.aliases) {
        if (alias.toLowerCase().trim() === normalizedName) {
          return speaker;
        }
      }
    }
  }

  return null;
}

/**
 * Full document analysis with voice profile support
 * Uses existing profile to maintain consistent voices across documents
 */
export async function analyzeDocumentWithProfile(
  text: string,
  profile: VoiceProfile
): Promise<{ analysis: DocumentAnalysis; newSpeakers: VoiceProfileSpeaker[] }> {
  // Step 1: Identify speakers with awareness of existing profile
  const speakerAnalysis = await analyzeSpeakersWithProfile(text, profile);

  // Step 2: Get voices from TTS provider and assign, reusing profile voices where possible
  const availableVoices = await getProviderVoices();
  const speakers = assignVoicesWithProfile(speakerAnalysis, profile, availableVoices);
  const speakerNames = speakers.map((s) => s.name);

  // Step 3: Annotate all segments with speakers
  const segmentAnnotation = await annotateSegments(text, speakerNames);

  // Map segments to include speaker IDs
  const segments = segmentAnnotation.segments.map((seg) => {
    const speaker = speakers.find((s) => s.name === seg.speaker) ?? speakers[0];
    return {
      text: seg.text,
      speakerId: speaker.id,
      speakerName: speaker.name,
    };
  });

  // Identify new speakers that should be added to the profile
  const newSpeakers: VoiceProfileSpeaker[] = [];
  for (const speaker of speakers) {
    const existsInProfile = findMatchingProfileSpeaker(speaker.name, profile.speakers);
    if (!existsInProfile) {
      newSpeakers.push({
        name: speaker.name,
        voiceId: speaker.voiceId,
        voiceDescription: speaker.voiceDescription,
        gender: speaker.gender,
        characteristics: speaker.characteristics,
      });
    }
  }

  return {
    analysis: { speakers, segments },
    newSpeakers,
  };
}

/**
 * Get available voices for the current TTS provider
 */
export async function getAvailableVoices(): Promise<TTSVoice[]> {
  return getProviderVoices();
}
