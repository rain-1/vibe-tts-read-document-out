import Database from 'better-sqlite3';
import { Job, JobStatus, Speaker, TextSegment, JobProgress } from '../shared/types.js';
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
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
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function rowToJob(row: JobRow): Job {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

export function createJob(
  id: string,
  originalFilename: string,
  fileType: Job['fileType']
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
    INSERT INTO jobs (id, original_filename, file_type, status, progress_json, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?)
  `);

  stmt.run(id, originalFilename, fileType, JSON.stringify(progress), now, now);

  return {
    id,
    originalFilename,
    fileType,
    status: 'pending',
    progress,
    speakers: [],
    segments: [],
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

export { db };
