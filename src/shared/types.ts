// Job status enum
export type JobStatus =
  | 'pending'
  | 'parsing'
  | 'analyzing'
  | 'generating_tts'
  | 'stitching'
  | 'completed'
  | 'failed'
  | 'paused';

// Speaker definition
export interface Speaker {
  id: string;
  name: string;
  voiceId: string;
  voiceDescription?: string;
  gender?: 'male' | 'female' | 'neutral';
  characteristics?: string[];
}

// Text segment with speaker annotation
export interface TextSegment {
  id: string;
  index: number;
  text: string;
  speakerId: string;
  speakerName: string;
  audioFile?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  errorMessage?: string;
  retryCount: number;
  durationMs?: number;
}

// Progress information
export interface JobProgress {
  currentStep: JobStatus;
  stepDescription: string;
  overallProgress: number; // 0-100
  stepProgress: number; // 0-100
  segmentsTotal: number;
  segmentsCompleted: number;
  estimatedTimeRemaining?: number; // in seconds
  startedAt?: string;
  lastUpdatedAt: string;
}

// Job definition
export interface Job {
  id: string;
  originalFilename: string;
  fileType: 'text' | 'pdf' | 'html';
  status: JobStatus;
  progress: JobProgress;
  speakers: Speaker[];
  segments: TextSegment[];
  outputFile?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  voiceProfileId?: string; // Voice profile used for this job
  voiceProfileName?: string; // For display purposes
}

// API request/response types
export interface CreateJobRequest {
  filename: string;
  fileContent: string;
  fileType: 'text' | 'pdf' | 'html';
}

export interface CreateJobResponse {
  jobId: string;
  status: JobStatus;
}

export interface JobStatusResponse {
  job: Job;
}

export interface JobListResponse {
  jobs: Job[];
  total: number;
}

// TTS Provider types
export interface TTSProvider {
  name: string;
  maxCharacters: number;
  availableVoices: TTSVoice[];
}

export interface TTSVoice {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'neutral';
  language?: string;
  description?: string;
}

// WebSocket message types
export type WSMessageType =
  | 'job_progress'
  | 'job_completed'
  | 'job_failed'
  | 'segment_completed';

export interface WSMessage {
  type: WSMessageType;
  jobId: string;
  data: JobProgress | { outputFile: string } | { error: string } | { segmentId: string };
}

// LLM Analysis result
export interface DocumentAnalysis {
  speakers: Speaker[];
  segments: Array<{
    text: string;
    speakerId: string;
    speakerName: string;
  }>;
}

// Voice Profile - for consistent voices across multiple documents
export interface VoiceProfile {
  id: string;
  name: string;
  description?: string;
  speakers: VoiceProfileSpeaker[];
  createdAt: string;
  updatedAt: string;
  sourceJobId?: string; // The job this profile was created from
}

export interface VoiceProfileSpeaker {
  name: string; // Character/speaker name (used for matching)
  aliases?: string[]; // Alternative names (e.g., "Dr. Smith", "John Smith", "Smith")
  voiceId: string;
  voiceDescription?: string;
  gender?: 'male' | 'female' | 'neutral';
  characteristics?: string[];
}

// Extended job with voice profile support
export interface CreateJobWithProfileRequest extends CreateJobRequest {
  voiceProfileId?: string; // Use existing profile
  createProfile?: boolean; // Create a new profile from this job
  profileName?: string; // Name for the new profile
}

// Configuration
export interface AppConfig {
  llm: {
    apiUrl: string;
    apiKey: string;
    model: string;
  };
  tts: {
    provider: 'openai' | 'elevenlabs' | 'edge-tts';
    openai?: {
      apiKey: string;
      model: string;
    };
    elevenlabs?: {
      apiKey: string;
      model: string;
    };
  };
  paths: {
    uploads: string;
    outputs: string;
    temp: string;
    database: string;
  };
  redis: {
    url: string;
  };
}
