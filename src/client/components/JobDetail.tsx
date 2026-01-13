import React, { useEffect, useState, useRef } from 'react';
import { Job, JobProgress, JobStatus } from '../../shared/types';
import * as api from '../api';

interface JobDetailProps {
  job: Job;
  onDelete: () => void;
  onCreateProfile?: () => void;
}

const STEPS: Array<{ status: JobStatus; label: string; icon: string }> = [
  { status: 'parsing', label: 'Parsing Document', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { status: 'analyzing', label: 'Analyzing Speakers', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
  { status: 'generating_tts', label: 'Generating Audio', icon: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z' },
  { status: 'stitching', label: 'Combining Audio', icon: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' },
];

const STEP_ORDER: JobStatus[] = ['pending', 'parsing', 'analyzing', 'generating_tts', 'stitching', 'completed'];

function getStepIndex(status: JobStatus): number {
  const idx = STEP_ORDER.indexOf(status);
  return idx === -1 ? 0 : idx;
}

export default function JobDetail({ job, onDelete, onCreateProfile }: JobDetailProps) {
  const [liveProgress, setLiveProgress] = useState<JobProgress>(job.progress);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Subscribe to real-time updates
  useEffect(() => {
    if (job.status === 'completed' || job.status === 'failed') {
      return;
    }

    const unsubscribe = api.subscribeToJob(
      job.id,
      (progress) => setLiveProgress(progress),
      (error) => console.error('Job error:', error)
    );

    return unsubscribe;
  }, [job.id, job.status]);

  // Update live progress when job changes
  useEffect(() => {
    setLiveProgress(job.progress);
  }, [job.progress]);

  const currentStepIndex = getStepIndex(liveProgress.currentStep);
  const isComplete = job.status === 'completed';
  const isFailed = job.status === 'failed';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {job.originalFilename}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Job ID: {job.id}
            </p>
          </div>
          {isComplete && (
            <div className="flex items-center gap-2">
              {onCreateProfile && job.speakers.length > 0 && !job.voiceProfileId && (
                <button
                  onClick={onCreateProfile}
                  className="inline-flex items-center px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
                  title="Save speaker voices for use in future documents"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  Save Voice Profile
                </button>
              )}
              <a
                href={api.getDownloadUrl(job.id)}
                download
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Audio
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Progress Steps */}
        <div className="mb-8">
          <h3 className="text-sm font-medium text-gray-700 mb-4">Progress</h3>
          <div className="space-y-4">
            {STEPS.map((step, index) => {
              const stepIndex = getStepIndex(step.status);
              const isActive = liveProgress.currentStep === step.status;
              const isDone = currentStepIndex > stepIndex || isComplete;
              const isPending = currentStepIndex < stepIndex;

              return (
                <div key={step.status} className="flex items-center">
                  {/* Step icon */}
                  <div
                    className={`
                      flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center
                      ${isDone ? 'bg-green-100' : isActive ? 'bg-blue-100' : 'bg-gray-100'}
                      ${isActive ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
                    `}
                  >
                    {isDone ? (
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg
                        className={`w-5 h-5 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={step.icon} />
                      </svg>
                    )}
                  </div>

                  {/* Step info */}
                  <div className="ml-4 flex-1">
                    <div className="flex items-center justify-between">
                      <span
                        className={`
                          text-sm font-medium
                          ${isDone ? 'text-green-600' : isActive ? 'text-blue-600' : 'text-gray-400'}
                        `}
                      >
                        {step.label}
                      </span>
                      {isActive && liveProgress.stepProgress > 0 && (
                        <span className="text-xs text-gray-500">
                          {liveProgress.stepProgress}%
                        </span>
                      )}
                    </div>

                    {/* Progress bar for active step */}
                    {isActive && (
                      <div className="mt-2">
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-all duration-300 animate-progress-pulse"
                            style={{ width: `${Math.max(liveProgress.stepProgress, 5)}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {liveProgress.stepDescription}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Connector line */}
                  {index < STEPS.length - 1 && (
                    <div
                      className={`
                        absolute left-5 w-0.5 h-8 mt-10
                        ${currentStepIndex > stepIndex ? 'bg-green-200' : 'bg-gray-200'}
                      `}
                      style={{ transform: 'translateY(100%)' }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Overall Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-700 font-medium">Overall Progress</span>
            <span className="text-gray-500">{liveProgress.overallProgress}%</span>
          </div>
          <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`
                h-full transition-all duration-500
                ${isFailed ? 'bg-red-500' : isComplete ? 'bg-green-500' : 'bg-blue-500'}
              `}
              style={{ width: `${liveProgress.overallProgress}%` }}
            />
          </div>
          {liveProgress.estimatedTimeRemaining && !isComplete && !isFailed && (
            <p className="text-xs text-gray-500 mt-1">
              Estimated time remaining: ~{formatDuration(liveProgress.estimatedTimeRemaining)}
            </p>
          )}
        </div>

        {/* Segment Progress */}
        {liveProgress.segmentsTotal > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              Audio Segments
            </h3>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>{liveProgress.segmentsCompleted}</span>
              <span className="text-gray-400">/</span>
              <span>{liveProgress.segmentsTotal}</span>
              <span className="text-gray-400">segments completed</span>
            </div>
          </div>
        )}

        {/* Speakers */}
        {job.speakers.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Detected Speakers
            </h3>
            <div className="flex flex-wrap gap-2">
              {job.speakers.map((speaker) => (
                <div
                  key={speaker.id}
                  className="inline-flex items-center px-3 py-1.5 bg-gray-100 rounded-full text-sm"
                >
                  <span
                    className={`
                      w-2 h-2 rounded-full mr-2
                      ${speaker.gender === 'female' ? 'bg-pink-400' : speaker.gender === 'male' ? 'bg-blue-400' : 'bg-gray-400'}
                    `}
                  />
                  <span className="font-medium">{speaker.name}</span>
                  {speaker.voiceDescription && (
                    <span className="text-gray-500 ml-1">
                      ({speaker.voiceDescription})
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Audio Player */}
        {isComplete && job.outputFile && (
          <div className="mb-8">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Preview Audio
            </h3>
            <div className="bg-gray-50 rounded-lg p-4">
              <audio
                ref={audioRef}
                controls
                className="w-full"
                src={api.getAudioUrl(job.id)}
              >
                Your browser does not support the audio element.
              </audio>
            </div>
          </div>
        )}

        {/* Error Message */}
        {isFailed && job.errorMessage && (
          <div className="mb-8 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex">
              <svg className="w-5 h-5 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="ml-3">
                <h4 className="text-sm font-medium text-red-800">
                  Processing Failed
                </h4>
                <p className="text-sm text-red-700 mt-1">
                  {job.errorMessage}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Voice Profile Info */}
        {job.voiceProfileName && (
          <div className="mb-8 bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-purple-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <div className="ml-3">
                <p className="text-sm font-medium text-purple-800">
                  Using Voice Profile: {job.voiceProfileName}
                </p>
                <p className="text-xs text-purple-600 mt-0.5">
                  Speaker voices are reused from this profile
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Job Info */}
        <div className="text-xs text-gray-400 space-y-1">
          <p>Created: {new Date(job.createdAt).toLocaleString()}</p>
          {job.completedAt && (
            <p>Completed: {new Date(job.completedAt).toLocaleString()}</p>
          )}
          {liveProgress.startedAt && (
            <p>Started: {new Date(liveProgress.startedAt).toLocaleString()}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins} minutes`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
}
