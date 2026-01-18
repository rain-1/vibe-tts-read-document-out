import React, { useState, useEffect, useCallback } from 'react';
import { Job, JobProgress, WSMessage, VoiceProfile } from '../shared/types';
import * as api from './api';
import FileUpload from './components/FileUpload';
import JobList from './components/JobList';
import JobDetail from './components/JobDetail';

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [newProfileJobId, setNewProfileJobId] = useState<string | null>(null);

  // Fetch jobs on mount
  const fetchJobs = useCallback(async () => {
    try {
      const result = await api.getJobs();
      setJobs(result.jobs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch voice profiles
  const fetchProfiles = useCallback(async () => {
    try {
      const result = await api.getVoiceProfiles();
      setVoiceProfiles(result.profiles);
    } catch (err) {
      console.error('Failed to fetch profiles:', err);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    fetchProfiles();
  }, [fetchJobs, fetchProfiles]);

  // Subscribe to all job updates
  useEffect(() => {
    const unsubscribe = api.subscribeToAllJobs((message: WSMessage) => {
      if (message.type === 'job_progress') {
        setJobs((prev) =>
          prev.map((job) =>
            job.id === message.jobId
              ? { ...job, progress: message.data as JobProgress, status: (message.data as JobProgress).currentStep }
              : job
          )
        );
      }
    });

    return unsubscribe;
  }, []);

  // Handle new job creation
  const handleJobCreated = async (jobId: string) => {
    try {
      const result = await api.getJob(jobId);
      setJobs((prev) => [result.job, ...prev]);
      setSelectedJobId(jobId);
    } catch {
      // Job will appear on next refresh
    }
  };

  // Handle job deletion
  const handleDeleteJob = async (jobId: string) => {
    try {
      await api.deleteJob(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      if (selectedJobId === jobId) {
        setSelectedJobId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete job');
    }
  };

  // Handle creating a profile from a job
  const handleCreateProfileFromJob = (jobId: string) => {
    setNewProfileJobId(jobId);
    setShowProfileModal(true);
  };

  // Get selected job
  const selectedJob = jobs.find((j) => j.id === selectedJobId);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Document to Audio
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                Convert documents into multi-speaker audio narration
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={fetchJobs}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
            <button
              onClick={() => setError(null)}
              className="float-right text-red-500 hover:text-red-700"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left column: Upload and Job List */}
          <div className="lg:col-span-1 space-y-6">
            {/* File Upload */}
            <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Upload Document
              </h2>
              <FileUpload
                onJobCreated={handleJobCreated}
                voiceProfiles={voiceProfiles}
                onRefreshProfiles={fetchProfiles}
              />
            </section>

            {/* Voice Profiles */}
            <section className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  Voice Profiles
                </h2>
                <span className="text-xs text-gray-400">{voiceProfiles.length} profiles</span>
              </div>
              <ProfileList
                profiles={voiceProfiles}
                onDelete={async (id) => {
                  await api.deleteVoiceProfile(id);
                  fetchProfiles();
                }}
              />
            </section>

            {/* Job List */}
            <section className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">
                  Recent Jobs
                </h2>
              </div>
              {loading ? (
                <div className="p-6 text-center text-gray-500">Loading...</div>
              ) : (
                <JobList
                  jobs={jobs}
                  selectedJobId={selectedJobId}
                  onSelectJob={setSelectedJobId}
                  onDeleteJob={handleDeleteJob}
                />
              )}
            </section>
          </div>

          {/* Right column: Job Detail */}
          <div className="lg:col-span-2">
            <section className="bg-white rounded-lg shadow-sm border border-gray-200 min-h-[500px]">
              {selectedJob ? (
                <JobDetail
                  job={selectedJob}
                  onDelete={() => handleDeleteJob(selectedJob.id)}
                  onCreateProfile={() => handleCreateProfileFromJob(selectedJob.id)}
                  onJobUpdate={fetchJobs}
                />
              ) : (
                <div className="flex items-center justify-center h-[500px] text-gray-500">
                  <div className="text-center">
                    <svg
                      className="mx-auto h-12 w-12 text-gray-300 mb-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                      />
                    </svg>
                    <p className="text-sm">Select a job to view details</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Or upload a new document to get started
                    </p>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Footer info */}
        <footer className="mt-12 text-center text-sm text-gray-400">
          <p>
            Supports PDF, HTML, and plain text documents.
            <br />
            Audio is generated using AI text-to-speech with automatic speaker detection.
          </p>
        </footer>
      </main>

      {/* Create Profile Modal */}
      {showProfileModal && newProfileJobId && (
        <CreateProfileModal
          jobId={newProfileJobId}
          onClose={() => {
            setShowProfileModal(false);
            setNewProfileJobId(null);
          }}
          onCreated={() => {
            fetchProfiles();
            setShowProfileModal(false);
            setNewProfileJobId(null);
          }}
        />
      )}
    </div>
  );
}

// Profile List Component
function ProfileList({
  profiles,
  onDelete,
}: {
  profiles: VoiceProfile[];
  onDelete: (id: string) => void;
}) {
  if (profiles.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        No voice profiles yet. Create one from a completed job.
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100 max-h-[200px] overflow-y-auto">
      {profiles.map((profile) => (
        <div
          key={profile.id}
          className="px-4 py-3 hover:bg-gray-50 flex items-center justify-between"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 truncate">
              {profile.name}
            </p>
            <p className="text-xs text-gray-500 truncate">
              {profile.speakers.length} speakers: {profile.speakers.map((s) => s.name).join(', ')}
            </p>
          </div>
          <button
            onClick={() => {
              if (confirm(`Delete profile "${profile.name}"?`)) {
                onDelete(profile.id);
              }
            }}
            className="ml-2 p-1 text-gray-400 hover:text-red-500"
            title="Delete profile"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

// Create Profile Modal
function CreateProfileModal({
  jobId,
  onClose,
  onCreated,
}: {
  jobId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    setError(null);

    try {
      await api.createVoiceProfileFromJob(jobId, name.trim(), description.trim() || undefined);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Create Voice Profile
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Save the speaker voices from this job as a reusable profile.
          Use it for subsequent chapters or related documents.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Profile Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., My Story Characters"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Characters from Chapter 1"
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded-md">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? 'Creating...' : 'Create Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
