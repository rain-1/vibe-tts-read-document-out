import Database from 'better-sqlite3';
import { Job, JobStatus, Speaker, TextSegment, JobProgress, VoiceProfile, VoiceProfileSpeaker } from '../shared/types.js';
import { config } from './config.js';
import fs from 'fs';
import path from 'path';

// Ensure data directory exists
const dbDir = path.dirname(config.paths.database);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.paths.database);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress_json TEXT NOT NULL DEFAULT '{}',
    speakers_json TEXT NOT NULL DEFAULT '[]',
    segments_json TEXT NOT NULL DEFAULT '[]',
    output_file TEXT,
    error_message TEXT,
    voice_profile_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles(id)
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
  CREATE INDEX IF NOT EXISTS idx_jobs_voice_profile ON jobs(voice_profile_id);

  -- Voice Profiles table for reusing speaker voices across documents
  CREATE TABLE IF NOT EXISTS voice_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    speakers_json TEXT NOT NULL DEFAULT '[]',
    source_job_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_voice_profiles_name ON voice_profiles(name);
`);

export interface JobRow {
  id: string;
  original_filename: string;
  file_type: string;
  status: string;
  progress_json: string;
  speakers_json: string;
  segments_json: string;
  output_file: string | null;
  error_message: string | null;
  voice_profile_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface VoiceProfileRow {
  id: string;
  name: string;
  description: string | null;
  speakers_json: string;
  source_job_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: JobRow): Job {
  // Get voice profile name if profile ID exists
  let voiceProfileName: string | undefined;
  if (row.voice_profile_id) {
    const profile = getVoiceProfile(row.voice_profile_id);
    voiceProfileName = profile?.name;
  }

  return {
    id: row.id,
    originalFilename: row.original_filename,
    fileType: row.file_type as Job['fileType'],
    status: row.status as JobStatus,
    progress: JSON.parse(row.progress_json) as JobProgress,
    speakers: JSON.parse(row.speakers_json) as Speaker[],
    segments: JSON.parse(row.segments_json) as TextSegment[],
    outputFile: row.output_file ?? undefined,
    errorMessage: row.error_message ?? undefined,
    voiceProfileId: row.voice_profile_id ?? undefined,
    voiceProfileName,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function rowToVoiceProfile(row: VoiceProfileRow): VoiceProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    speakers: JSON.parse(row.speakers_json) as VoiceProfileSpeaker[],
    sourceJobId: row.source_job_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createJob(
  id: string,
  originalFilename: string,
  fileType: Job['fileType'],
  voiceProfileId?: string
): Job {
  const now = new Date().toISOString();
  const progress: JobProgress = {
    currentStep: 'pending',
    stepDescription: 'Waiting to start',
    overallProgress: 0,
    stepProgress: 0,
    segmentsTotal: 0,
    segmentsCompleted: 0,
    lastUpdatedAt: now,
  };

  const stmt = db.prepare(`
    INSERT INTO jobs (id, original_filename, file_type, status, progress_json, voice_profile_id, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
  `);

  stmt.run(id, originalFilename, fileType, JSON.stringify(progress), voiceProfileId ?? null, now, now);

  // Get voice profile name if provided
  let voiceProfileName: string | undefined;
  if (voiceProfileId) {
    const profile = getVoiceProfile(voiceProfileId);
    voiceProfileName = profile?.name;
  }

  return {
    id,
    originalFilename,
    fileType,
    status: 'pending',
    progress,
    speakers: [],
    segments: [],
    voiceProfileId,
    voiceProfileName,
    createdAt: now,
    updatedAt: now,
  };
}

export function getJob(id: string): Job | null {
  const stmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const row = stmt.get(id) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

export function getAllJobs(limit = 50, offset = 0): { jobs: Job[]; total: number } {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM jobs');
  const { count } = countStmt.get() as { count: number };

  const stmt = db.prepare(
    'SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?'
  );
  const rows = stmt.all(limit, offset) as JobRow[];

  return {
    jobs: rows.map(rowToJob),
    total: count,
  };
}

export function updateJobStatus(
  id: string,
  status: JobStatus,
  progress: Partial<JobProgress>,
  errorMessage?: string
): void {
  const job = getJob(id);
  if (!job) return;

  const now = new Date().toISOString();
  const newProgress: JobProgress = {
    ...job.progress,
    ...progress,
    currentStep: status,
    lastUpdatedAt: now,
  };

  const stmt = db.prepare(`
    UPDATE jobs
    SET status = ?, progress_json = ?, error_message = ?, updated_at = ?,
        completed_at = CASE WHEN ? IN ('completed', 'failed') THEN ? ELSE completed_at END
    WHERE id = ?
  `);

  stmt.run(
    status,
    JSON.stringify(newProgress),
    errorMessage ?? null,
    now,
    status,
    now,
    id
  );
}

export function updateJobSpeakers(id: string, speakers: Speaker[]): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE jobs SET speakers_json = ?, updated_at = ? WHERE id = ?
  `);
  stmt.run(JSON.stringify(speakers), now, id);
}

export function updateJobSegments(id: string, segments: TextSegment[]): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE jobs SET segments_json = ?, updated_at = ? WHERE id = ?
  `);
  stmt.run(JSON.stringify(segments), now, id);
}

export function updateSegmentStatus(
  jobId: string,
  segmentId: string,
  status: TextSegment['status'],
  audioFile?: string,
  durationMs?: number,
  errorMessage?: string
): void {
  const job = getJob(jobId);
  if (!job) return;

  const segments = job.segments.map((seg) => {
    if (seg.id === segmentId) {
      return {
        ...seg,
        status,
        audioFile: audioFile ?? seg.audioFile,
        durationMs: durationMs ?? seg.durationMs,
        errorMessage: errorMessage ?? seg.errorMessage,
        retryCount: status === 'failed' ? seg.retryCount + 1 : seg.retryCount,
      };
    }
    return seg;
  });

  updateJobSegments(jobId, segments);
}

export function setJobOutputFile(id: string, outputFile: string): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE jobs SET output_file = ?, updated_at = ? WHERE id = ?
  `);
  stmt.run(outputFile, now, id);
}

export function deleteJob(id: string): boolean {
  const stmt = db.prepare('DELETE FROM jobs WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ============================================
// Voice Profile Functions
// ============================================

export function createVoiceProfile(
  id: string,
  name: string,
  speakers: VoiceProfileSpeaker[],
  description?: string,
  sourceJobId?: string
): VoiceProfile {
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO voice_profiles (id, name, description, speakers_json, source_job_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, name, description ?? null, JSON.stringify(speakers), sourceJobId ?? null, now, now);

  return {
    id,
    name,
    description,
    speakers,
    sourceJobId,
    createdAt: now,
    updatedAt: now,
  };
}

export function getVoiceProfile(id: string): VoiceProfile | null {
  const stmt = db.prepare('SELECT * FROM voice_profiles WHERE id = ?');
  const row = stmt.get(id) as VoiceProfileRow | undefined;
  return row ? rowToVoiceProfile(row) : null;
}

export function getVoiceProfileByName(name: string): VoiceProfile | null {
  const stmt = db.prepare('SELECT * FROM voice_profiles WHERE name = ? COLLATE NOCASE');
  const row = stmt.get(name) as VoiceProfileRow | undefined;
  return row ? rowToVoiceProfile(row) : null;
}

export function getAllVoiceProfiles(): VoiceProfile[] {
  const stmt = db.prepare('SELECT * FROM voice_profiles ORDER BY updated_at DESC');
  const rows = stmt.all() as VoiceProfileRow[];
  return rows.map(rowToVoiceProfile);
}

export function updateVoiceProfile(
  id: string,
  updates: {
    name?: string;
    description?: string;
    speakers?: VoiceProfileSpeaker[];
  }
): VoiceProfile | null {
  const profile = getVoiceProfile(id);
  if (!profile) return null;

  const now = new Date().toISOString();
  const newName = updates.name ?? profile.name;
  const newDescription = updates.description ?? profile.description;
  const newSpeakers = updates.speakers ?? profile.speakers;

  const stmt = db.prepare(`
    UPDATE voice_profiles
    SET name = ?, description = ?, speakers_json = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(newName, newDescription ?? null, JSON.stringify(newSpeakers), now, id);

  return {
    ...profile,
    name: newName,
    description: newDescription,
    speakers: newSpeakers,
    updatedAt: now,
  };
}

export function addSpeakerToProfile(
  profileId: string,
  speaker: VoiceProfileSpeaker
): VoiceProfile | null {
  const profile = getVoiceProfile(profileId);
  if (!profile) return null;

  // Check if speaker already exists (by name)
  const existingIndex = profile.speakers.findIndex(
    (s) => s.name.toLowerCase() === speaker.name.toLowerCase()
  );

  let newSpeakers: VoiceProfileSpeaker[];
  if (existingIndex >= 0) {
    // Update existing speaker
    newSpeakers = [...profile.speakers];
    newSpeakers[existingIndex] = speaker;
  } else {
    // Add new speaker
    newSpeakers = [...profile.speakers, speaker];
  }

  return updateVoiceProfile(profileId, { speakers: newSpeakers });
}

export function deleteVoiceProfile(id: string): boolean {
  // First, unlink any jobs using this profile
  const unlinkStmt = db.prepare('UPDATE jobs SET voice_profile_id = NULL WHERE voice_profile_id = ?');
  unlinkStmt.run(id);

  const stmt = db.prepare('DELETE FROM voice_profiles WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

export function createVoiceProfileFromJob(
  jobId: string,
  profileName: string,
  description?: string
): VoiceProfile | null {
  const job = getJob(jobId);
  if (!job || job.speakers.length === 0) return null;

  const { nanoid } = require('nanoid');
  const profileId = nanoid();

  // Convert job speakers to profile speakers
  const profileSpeakers: VoiceProfileSpeaker[] = job.speakers.map((s) => ({
    name: s.name,
    voiceId: s.voiceId,
    voiceDescription: s.voiceDescription,
    gender: s.gender,
    characteristics: s.characteristics,
  }));

  return createVoiceProfile(profileId, profileName, profileSpeakers, description, jobId);
}

export function getJobsUsingProfile(profileId: string): Job[] {
  const stmt = db.prepare('SELECT * FROM jobs WHERE voice_profile_id = ? ORDER BY created_at DESC');
  const rows = stmt.all(profileId) as JobRow[];
  return rows.map(rowToJob);
}

export { db };
