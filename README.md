# Document to Audio

A comprehensive system for converting long documents into multi-speaker audio narration. Upload any document (PDF, HTML, or plain text) and get a professionally narrated audio file with different voices for each speaker/character.

## Features

- **Multi-format Document Support**: PDF, HTML, and plain text files
- **Intelligent Speaker Detection**: Uses LLM to analyze documents and identify distinct speakers/characters
- **Voice Assignment**: Automatically assigns appropriate voices based on speaker characteristics
- **Multiple TTS Providers**: Supports OpenAI TTS, ElevenLabs, and Edge TTS (free)
- **Real-time Progress Tracking**: WebSocket-based live updates with progress bars and time estimates
- **Fault Tolerance**: Jobs can be resumed from the last checkpoint if they fail
- **Audio Normalization**: Uses ffmpeg to stitch and normalize the final audio

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Frontend (React)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐  │
│  │ File Upload │  │  Job List   │  │      Job Detail/Progress    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ REST API + WebSocket
┌────────────────────────────────┴────────────────────────────────────┐
│                         Backend (Fastify)                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      API Routes                               │   │
│  │  /api/jobs (CRUD)  |  /api/upload  |  /ws/jobs (real-time)  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────┴────────────────────────────────────┐
│                        Job Queue (BullMQ + Redis)                   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Document Processing Pipeline                     │   │
│  │  1. Parse Document → 2. Analyze Speakers → 3. Generate TTS   │   │
│  │                    → 4. Stitch Audio → 5. Complete           │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Processing Pipeline

1. **Document Parsing**: Extracts plain text from PDF, HTML, or text files
2. **Speaker Analysis**: LLM analyzes the document to identify:
   - Narrator (always present)
   - Characters/speakers with dialogue
   - Voice characteristics for each speaker
3. **Text Segmentation**: Document is split into segments, each annotated with speaker
4. **TTS Generation**: Each segment is converted to audio using the assigned voice
5. **Audio Stitching**: All segments are combined with ffmpeg, normalized, and exported

## Quick Start

### Prerequisites

- Node.js 20+
- Redis (for job queue)
- ffmpeg (for audio processing)
- API keys for LLM and TTS providers

### Installation

```bash
# Clone and install dependencies
cd document-to-audio
npm install

# Copy environment configuration
cp .env.example .env
# Edit .env with your API keys

# Start Redis (if not running)
redis-server

# Start the development server
npm run dev
```

### Environment Variables

```env
# LLM Configuration (OpenAI-compatible endpoint)
LLM_API_URL=https://api.openai.com/v1
LLM_API_KEY=your-api-key
LLM_MODEL=gpt-4o-mini

# TTS Provider (openai, elevenlabs, or edge-tts)
TTS_PROVIDER=openai

# OpenAI TTS
OPENAI_API_KEY=your-openai-key
OPENAI_TTS_MODEL=tts-1

# ElevenLabs (alternative)
ELEVENLABS_API_KEY=your-elevenlabs-key

# Redis
REDIS_URL=redis://localhost:6379
```

## API Reference

### Create Job
```http
POST /api/jobs
Content-Type: application/json

{
  "filename": "document.pdf",
  "fileContent": "<base64-encoded-content>",
  "fileType": "pdf"
}
```

### Get Job Status
```http
GET /api/jobs/:id
```

### List Jobs
```http
GET /api/jobs?limit=50&offset=0
```

### Download Audio
```http
GET /api/jobs/:id/download
```

### Resume Failed Job
```http
POST /api/jobs/:id/resume
```

### WebSocket Updates
```javascript
const ws = new WebSocket('ws://localhost:3000/ws/jobs/:jobId');
ws.onmessage = (event) => {
  const { type, data } = JSON.parse(event.data);
  // type: 'job_progress' | 'job_completed' | 'job_failed'
};
```

## TTS Providers

### OpenAI TTS
- **Voices**: alloy, echo, fable, onyx, nova, shimmer, ash, ballad, coral, sage, verse
- **Max Characters**: 4,096 per request
- **Quality**: High, natural-sounding

### ElevenLabs
- **Voices**: 1200+ available voices
- **Max Characters**: 5,000-40,000 depending on model
- **Quality**: Very high, emotional nuance

### Edge TTS (Free)
- **Voices**: Microsoft Azure neural voices
- **Max Characters**: 10,000 per request
- **Cost**: Free (uses Microsoft Edge's TTS)

To use Edge TTS, install the Python package:
```bash
pip install edge-tts
```

## Development

### Project Structure
```
├── src/
│   ├── client/           # React frontend
│   │   ├── components/   # UI components
│   │   ├── api.ts       # API client
│   │   └── App.tsx      # Main app
│   ├── server/           # Fastify backend
│   │   ├── routes/      # API routes
│   │   ├── services/    # Business logic
│   │   │   ├── tts/     # TTS providers
│   │   │   ├── document-parser.ts
│   │   │   ├── llm-analyzer.ts
│   │   │   ├── audio-stitcher.ts
│   │   │   └── job-queue.ts
│   │   └── database.ts  # SQLite storage
│   └── shared/           # Shared types
├── data/                 # Runtime data
│   ├── uploads/
│   ├── outputs/
│   └── temp/
└── package.json
```

### Scripts
```bash
npm run dev          # Start development server with hot reload
npm run dev:server   # Start only the backend
npm run dev:client   # Start only the frontend
npm run build        # Build for production
npm run start        # Start production server
npm run worker       # Start standalone worker (for scaling)
```

## Fault Tolerance

The system includes several fault-tolerance features:

1. **Segment-level Checkpointing**: Each audio segment's status is tracked in the database
2. **Automatic Retry**: Failed TTS requests are retried with exponential backoff
3. **Job Resume**: Failed jobs can be resumed from the last successful segment
4. **Progress Export**: Job progress can be exported as JSONL for debugging

### Resuming Failed Jobs
```bash
# Check resume status
curl http://localhost:3000/api/jobs/:id/resume-status

# Resume the job
curl -X POST http://localhost:3000/api/jobs/:id/resume
```

## Customization

### Adding a New TTS Provider

1. Create a new provider class in `src/server/services/tts/`:

```typescript
import { BaseTTSProvider, TTSProviderConfig, TTSRequest, TTSResult } from './base.js';

export class MyTTSProvider extends BaseTTSProvider {
  readonly name = 'my-tts';
  readonly config: TTSProviderConfig = {
    maxCharacters: 5000,
    supportedFormats: ['mp3'],
    defaultFormat: 'mp3',
  };

  async getVoices() { /* ... */ }
  async synthesize(request: TTSRequest) { /* ... */ }
}
```

2. Register in `src/server/services/tts/index.ts`

### Custom Voice Assignment

The LLM analyzer can be customized in `src/server/services/llm-analyzer.ts` to:
- Change voice assignment logic
- Add custom speaker detection rules
- Modify prompt templates

## License

MIT
