import React, { useState, useCallback, useRef, useEffect } from 'react';
import { VoiceProfile } from '../../shared/types';
import * as api from '../api';

interface FileUploadProps {
  onJobCreated: (jobId: string) => void;
  voiceProfiles: VoiceProfile[];
  onRefreshProfiles: () => void;
}

const ACCEPTED_TYPES = {
  'text/plain': 'text',
  'text/html': 'html',
  'application/pdf': 'pdf',
  'application/x-pdf': 'pdf',
} as const;

const ACCEPTED_EXTENSIONS = ['.txt', '.text', '.html', '.htm', '.pdf'];

export default function FileUpload({ onJobCreated, voiceProfiles, onRefreshProfiles }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [autoUpdateProfile, setAutoUpdateProfile] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getFileType = (file: File): 'text' | 'pdf' | 'html' | null => {
    // Check MIME type first
    if (file.type in ACCEPTED_TYPES) {
      return ACCEPTED_TYPES[file.type as keyof typeof ACCEPTED_TYPES];
    }

    // Check extension
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (ext === '.txt' || ext === '.text') return 'text';
    if (ext === '.html' || ext === '.htm') return 'html';
    if (ext === '.pdf') return 'pdf';

    return null;
  };

  const processFile = async (file: File) => {
    const fileType = getFileType(file);
    if (!fileType) {
      setError('Unsupported file type. Please upload a .txt, .html, or .pdf file.');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      let fileContent: string;

      if (fileType === 'pdf') {
        // For PDF, use base64 encoding
        fileContent = await api.readFileAsBase64(file);
      } else {
        // For text and HTML, read as text
        fileContent = await api.readFileAsText(file);
      }

      // Create job with voice profile if selected
      const result = await api.createJob(file.name, fileContent, fileType, {
        voiceProfileId: selectedProfileId || undefined,
        autoUpdateProfile: autoUpdateProfile,
      });

      onJobCreated(result.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        processFile(files[0]);
      }
    },
    [selectedProfileId, autoUpdateProfile]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClick = () => {
    if (!uploading) {
      fileInputRef.current?.click();
    }
  };

  const selectedProfile = voiceProfiles.find((p) => p.id === selectedProfileId);

  return (
    <div className="space-y-4">
      {/* Voice Profile Selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Voice Profile (for consistent character voices)
        </label>
        <div className="flex gap-2">
          <select
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            disabled={uploading}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
          >
            <option value="">No profile (create new voices)</option>
            {voiceProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} ({profile.speakers.length} speakers)
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onRefreshProfiles}
            className="px-3 py-2 text-gray-500 hover:text-gray-700 border border-gray-300 rounded-md"
            title="Refresh profiles"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Profile info */}
        {selectedProfile && (
          <div className="mt-2 p-2 bg-blue-50 rounded-md">
            <p className="text-xs text-blue-800">
              <span className="font-medium">Using profile:</span> {selectedProfile.name}
            </p>
            <p className="text-xs text-blue-600 mt-1">
              Speakers: {selectedProfile.speakers.map((s) => s.name).join(', ')}
            </p>
            <label className="flex items-center gap-2 mt-2 text-xs">
              <input
                type="checkbox"
                checked={autoUpdateProfile}
                onChange={(e) => setAutoUpdateProfile(e.target.checked)}
                className="rounded text-blue-600"
              />
              <span className="text-gray-600">
                Auto-add new characters to profile
              </span>
            </label>
          </div>
        )}
      </div>

      {/* Drop zone */}
      <div
        className={`
          drop-zone cursor-pointer
          ${isDragging ? 'active' : ''}
          ${uploading ? 'disabled' : ''}
        `}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(',')}
          onChange={handleFileSelect}
          className="hidden"
          disabled={uploading}
        />

        {uploading ? (
          <div className="flex flex-col items-center">
            <svg
              className="animate-spin h-8 w-8 text-blue-500 mb-2"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <p className="text-sm text-gray-600">Processing file...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <svg
              className="h-10 w-10 text-gray-400 mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-sm text-gray-600 mb-1">
              <span className="font-medium text-blue-600">Click to upload</span> or
              drag and drop
            </p>
            <p className="text-xs text-gray-400">
              PDF, HTML, or TXT (max 50MB)
            </p>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2 rounded-md">
          {error}
        </div>
      )}

      {/* Text input alternative */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-white px-2 text-gray-400">or paste text</span>
        </div>
      </div>

      <TextInput
        onSubmit={(text) => processFile(new File([text], 'pasted-text.txt', { type: 'text/plain' }))}
        disabled={uploading}
      />
    </div>
  );
}

// Text input component for pasting text directly
function TextInput({
  onSubmit,
  disabled,
}: {
  onSubmit: (text: string) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim()) {
      onSubmit(text.trim());
      setText('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste your text here..."
        rows={4}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed resize-none"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Convert to Audio
      </button>
    </form>
  );
}
