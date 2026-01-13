import { Job, JobProgress, WSMessage } from '../shared/types';

const API_BASE = '/api';

export interface ApiError {
  error: string;
  details?: unknown;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// Job API
export async function createJob(
  filename: string,
  fileContent: string,
  fileType: 'text' | 'pdf' | 'html'
): Promise<{ jobId: string; status: string }> {
  const response = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, fileContent, fileType }),
  });
  return handleResponse(response);
}

export async function getJob(jobId: string): Promise<{ job: Job }> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`);
  return handleResponse(response);
}

export async function getJobs(
  limit = 50,
  offset = 0
): Promise<{ jobs: Job[]; total: number }> {
  const response = await fetch(`${API_BASE}/jobs?limit=${limit}&offset=${offset}`);
  return handleResponse(response);
}

export async function deleteJob(jobId: string): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
    method: 'DELETE',
  });
  return handleResponse(response);
}

export function getDownloadUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/download`;
}

export function getAudioUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/audio`;
}

// Queue stats
export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}> {
  const response = await fetch(`${API_BASE}/queue/stats`);
  return handleResponse(response);
}

// TTS providers
export async function getTTSProviders(): Promise<{
  providers: string[];
  currentProvider: string;
  voices: Array<{
    id: string;
    name: string;
    gender: string;
    description?: string;
  }>;
}> {
  const response = await fetch(`${API_BASE}/tts/providers`);
  return handleResponse(response);
}

// File upload
export async function uploadFile(file: File): Promise<{
  filename: string;
  fileContent: string;
  fileType: 'text' | 'pdf' | 'html';
  size: number;
}> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });
  return handleResponse(response);
}

// WebSocket for real-time updates
export function subscribeToJob(
  jobId: string,
  onProgress: (progress: JobProgress) => void,
  onError?: (error: string) => void
): () => void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/jobs/${jobId}`;

  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const message: WSMessage = JSON.parse(event.data);
      if (message.type === 'job_progress') {
        onProgress(message.data as JobProgress);
      } else if (message.type === 'job_failed' && onError) {
        onError((message.data as { error: string }).error);
      }
    } catch {
      console.error('Failed to parse WebSocket message');
    }
  };

  ws.onerror = () => {
    if (onError) onError('WebSocket connection error');
  };

  // Return cleanup function
  return () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  };
}

// Subscribe to all job updates
export function subscribeToAllJobs(
  onMessage: (message: WSMessage) => void
): () => void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/jobs`;

  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const message: WSMessage = JSON.parse(event.data);
      onMessage(message);
    } catch {
      console.error('Failed to parse WebSocket message');
    }
  };

  return () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  };
}

// Helper to read file as base64
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Helper to read file as text
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
