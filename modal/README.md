# Kokoro TTS Modal Deployment

This directory contains the Modal deployment for the Kokoro-82M TTS model.

## Prerequisites

1. Install Modal CLI:
   ```bash
   pip install modal
   ```

2. Authenticate with Modal:
   ```bash
   modal token new
   ```

## Deployment

Deploy the TTS service to Modal:

```bash
cd modal
modal deploy kokoro_tts.py
```

After deployment, Modal will provide you with a URL like:
```
https://<your-workspace>--kokoro-tts-web-app.modal.run
```

## Local Testing

Run the service locally for testing:

```bash
modal serve kokoro_tts.py
```

## API Endpoints

### Health Check
```bash
GET /health
```

### List Voices
```bash
GET /voices
```

Returns available voices:
```json
[
  {
    "id": "af_heart",
    "name": "Heart",
    "gender": "female",
    "language": "en-US",
    "description": "Warm, friendly female voice"
  },
  ...
]
```

### Synthesize Speech
```bash
POST /synthesize
Content-Type: application/json

{
  "text": "Hello, world!",
  "voice": "af_heart",
  "speed": 1.0,
  "output_format": "wav"
}
```

Returns audio file as binary response.

## Example Usage

```bash
# List voices
curl https://your-app.modal.run/voices

# Synthesize speech
curl -X POST https://your-app.modal.run/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world!", "voice": "af_heart"}' \
  --output speech.wav
```

## Available Voices

### American English
| Voice ID | Name | Gender | Description |
|----------|------|--------|-------------|
| af_heart | Heart | Female | Warm, friendly |
| af_alloy | Alloy | Female | Clear, professional |
| af_bella | Bella | Female | Elegant |
| af_jessica | Jessica | Female | Youthful |
| af_nicole | Nicole | Female | Sophisticated |
| af_nova | Nova | Female | Modern |
| af_sarah | Sarah | Female | Friendly |
| af_sky | Sky | Female | Light, airy |
| am_adam | Adam | Male | Strong |
| am_echo | Echo | Male | Resonant |
| am_eric | Eric | Male | Professional |
| am_fenrir | Fenrir | Male | Deep, powerful |
| am_liam | Liam | Male | Friendly |
| am_michael | Michael | Male | Authoritative |
| am_onyx | Onyx | Male | Rich, dark |

### British English
| Voice ID | Name | Gender | Description |
|----------|------|--------|-------------|
| bf_alice | Alice | Female | British |
| bf_emma | Emma | Female | British |
| bf_isabella | Isabella | Female | British |
| bf_lily | Lily | Female | British |
| bm_daniel | Daniel | Male | British |
| bm_fable | Fable | Male | Storyteller |
| bm_george | George | Male | British |
| bm_lewis | Lewis | Male | British |

## Configuration

Set the Modal endpoint URL in your environment:

```bash
export KOKORO_MODAL_URL=https://your-workspace--kokoro-tts-web-app.modal.run
```

Then configure the TTS provider:

```bash
export TTS_PROVIDER=kokoro
```

## Cost Optimization

The deployment uses:
- **T4 GPU**: Cost-effective for inference (~$0.000164/sec)
- **Container idle timeout**: 5 minutes (keeps warm for subsequent requests)
- **Concurrent inputs**: Up to 10 requests per container
- **Model caching**: Weights cached in a Modal Volume

First request may have cold start latency (~30-60 seconds). Subsequent requests are fast (~1-2 seconds for short text).
