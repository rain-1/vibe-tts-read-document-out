import React from 'react';
import { Job, JobStatus } from '../../shared/types';

interface JobListProps {
  jobs: Job[];
  selectedJobId: string | null;
  onSelectJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
}

const STATUS_CONFIG: Record<
  JobStatus,
  { label: string; color: string; bgColor: string; animate?: boolean }
> = {
  pending: { label: 'Pending', color: 'text-gray-600', bgColor: 'bg-gray-100' },
  parsing: {
    label: 'Parsing',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    animate: true,
  },
  analyzing: {
    label: 'Analyzing',
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
    animate: true,
  },
  generating_tts: {
    label: 'Generating Audio',
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
    animate: true,
  },
  stitching: {
    label: 'Finalizing',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-100',
    animate: true,
  },
  completed: {
    label: 'Completed',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
  },
  failed: { label: 'Failed', color: 'text-red-600', bgColor: 'bg-red-100' },
  paused: { label: 'Paused', color: 'text-yellow-600', bgColor: 'bg-yellow-100' },
};

function getRelativeTime(date: string): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();

  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString();
}

export default function JobList({
  jobs,
  selectedJobId,
  onSelectJob,
  onDeleteJob,
}: JobListProps) {
  if (jobs.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500">
        <p className="text-sm">No jobs yet</p>
        <p className="text-xs text-gray-400 mt-1">
          Upload a document to get started
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
      {jobs.map((job) => {
        const statusConfig = STATUS_CONFIG[job.status];
        const isSelected = job.id === selectedJobId;

        return (
          <div
            key={job.id}
            className={`
              p-4 cursor-pointer transition-colors
              ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}
            `}
            onClick={() => onSelectJob(job.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-gray-900 truncate">
                  {job.originalFilename}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {getRelativeTime(job.createdAt)}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Status badge */}
                <span
                  className={`
                    inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                    ${statusConfig.bgColor} ${statusConfig.color}
                    ${statusConfig.animate ? 'animate-pulse' : ''}
                  `}
                >
                  {statusConfig.animate && (
                    <span className="w-1.5 h-1.5 bg-current rounded-full mr-1.5" />
                  )}
                  {statusConfig.label}
                </span>

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Delete this job?')) {
                      onDeleteJob(job.id);
                    }
                  }}
                  className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                  title="Delete job"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Progress bar for active jobs */}
            {statusConfig.animate && job.progress.overallProgress > 0 && (
              <div className="mt-2">
                <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${statusConfig.bgColor.replace('100', '500')} transition-all duration-500`}
                    style={{ width: `${job.progress.overallProgress}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {job.progress.overallProgress}%
                  {job.progress.estimatedTimeRemaining && (
                    <span> • ~{formatTimeRemaining(job.progress.estimatedTimeRemaining)} remaining</span>
                  )}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatTimeRemaining(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.ceil(seconds / 3600)}h`;
}
