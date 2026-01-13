import OpenAI from 'openai';
import { config } from '../config.js';
import { DocumentAnalysis, Speaker, TTSVoice } from '../../shared/types.js';
import { nanoid } from 'nanoid';

// Create OpenAI client pointing to configured endpoint (works with OpenRouter, etc.)
const openai = new OpenAI({
  baseURL: config.llm.apiUrl,
  apiKey: config.llm.apiKey,
});

// Default voice pool for speaker assignment
const DEFAULT_VOICES: TTSVoice[] = [
  { id: 'alloy', name: 'Alloy', gender: 'neutral', description: 'Neutral, balanced voice' },
  { id: 'echo', name: 'Echo', gender: 'male', description: 'Warm, conversational male voice' },
  { id: 'fable', name: 'Fable', gender: 'male', description: 'Expressive, storytelling male voice' },
  { id: 'onyx', name: 'Onyx', gender: 'male', description: 'Deep, authoritative male voice' },
  { id: 'nova', name: 'Nova', gender: 'female', description: 'Friendly, warm female voice' },
  { id: 'shimmer', name: 'Shimmer', gender: 'female', description: 'Clear, expressive female voice' },
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

  // Step 2: Assign voices to speakers
  const speakers = assignVoices(speakerAnalysis);
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
 * Get available voices for the current TTS provider
 */
export function getAvailableVoices(): TTSVoice[] {
  // Could be extended to fetch from TTS provider API
  return DEFAULT_VOICES;
}
