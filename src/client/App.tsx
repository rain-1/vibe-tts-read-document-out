import React, { useState, useEffect, useCallback } from 'react';
import { Job, JobProgress, WSMessage } from '../shared/types';
import * as api from './api';
import FileUpload from './components/FileUpload';
import JobList from './components/JobList';
import JobDetail from './components/JobDetail';

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

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
    // Fetch the new job
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
              <FileUpload onJobCreated={handleJobCreated} />
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
                <JobDetail job={selectedJob} onDelete={() => handleDeleteJob(selectedJob.id)} />
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
    </div>
  );
}

export default App;
