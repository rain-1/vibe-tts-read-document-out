"""
Modal deployment for Kokoro-82M TTS model.

Deploy with:
    modal deploy kokoro_tts.py

Test locally with:
    modal serve kokoro_tts.py
"""

import io
import modal

# Define the Modal app
app = modal.App("kokoro-tts")

# Create a volume to cache model weights
model_cache = modal.Volume.from_name("kokoro-model-cache", create_if_missing=True)

# Define the image with all required dependencies
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("espeak-ng", "ffmpeg")
    .pip_install(
        "kokoro>=0.9.4",
        "soundfile",
        "torch",
        "numpy",
        "fastapi[standard]",
    )
)

# Available Kokoro voices organized by language and gender
KOKORO_VOICES = {
    # American English
    "af_heart": {"name": "Heart", "gender": "female", "language": "en-US", "description": "Warm, friendly female voice"},
    "af_alloy": {"name": "Alloy", "gender": "female", "language": "en-US", "description": "Clear, professional female voice"},
    "af_aoede": {"name": "Aoede", "gender": "female", "language": "en-US", "description": "Melodic female voice"},
    "af_bella": {"name": "Bella", "gender": "female", "language": "en-US", "description": "Elegant female voice"},
    "af_jessica": {"name": "Jessica", "gender": "female", "language": "en-US", "description": "Youthful female voice"},
    "af_kore": {"name": "Kore", "gender": "female", "language": "en-US", "description": "Expressive female voice"},
    "af_nicole": {"name": "Nicole", "gender": "female", "language": "en-US", "description": "Sophisticated female voice"},
    "af_nova": {"name": "Nova", "gender": "female", "language": "en-US", "description": "Modern female voice"},
    "af_river": {"name": "River", "gender": "female", "language": "en-US", "description": "Flowing, natural female voice"},
    "af_sarah": {"name": "Sarah", "gender": "female", "language": "en-US", "description": "Friendly female voice"},
    "af_sky": {"name": "Sky", "gender": "female", "language": "en-US", "description": "Light, airy female voice"},
    "am_adam": {"name": "Adam", "gender": "male", "language": "en-US", "description": "Strong male voice"},
    "am_echo": {"name": "Echo", "gender": "male", "language": "en-US", "description": "Resonant male voice"},
    "am_eric": {"name": "Eric", "gender": "male", "language": "en-US", "description": "Professional male voice"},
    "am_fenrir": {"name": "Fenrir", "gender": "male", "language": "en-US", "description": "Deep, powerful male voice"},
    "am_liam": {"name": "Liam", "gender": "male", "language": "en-US", "description": "Friendly male voice"},
    "am_michael": {"name": "Michael", "gender": "male", "language": "en-US", "description": "Authoritative male voice"},
    "am_onyx": {"name": "Onyx", "gender": "male", "language": "en-US", "description": "Rich, dark male voice"},
    "am_puck": {"name": "Puck", "gender": "male", "language": "en-US", "description": "Playful male voice"},
    "am_santa": {"name": "Santa", "gender": "male", "language": "en-US", "description": "Jolly male voice"},
    # British English
    "bf_alice": {"name": "Alice", "gender": "female", "language": "en-GB", "description": "British female voice"},
    "bf_emma": {"name": "Emma", "gender": "female", "language": "en-GB", "description": "British female voice"},
    "bf_isabella": {"name": "Isabella", "gender": "female", "language": "en-GB", "description": "British female voice"},
    "bf_lily": {"name": "Lily", "gender": "female", "language": "en-GB", "description": "British female voice"},
    "bm_daniel": {"name": "Daniel", "gender": "male", "language": "en-GB", "description": "British male voice"},
    "bm_fable": {"name": "Fable", "gender": "male", "language": "en-GB", "description": "British storyteller voice"},
    "bm_george": {"name": "George", "gender": "male", "language": "en-GB", "description": "British male voice"},
    "bm_lewis": {"name": "Lewis", "gender": "male", "language": "en-GB", "description": "British male voice"},
}


@app.cls(
    image=image,
    gpu="T4",  # Use T4 GPU for cost-effective inference
    volumes={"/cache": model_cache},
    container_idle_timeout=300,  # Keep warm for 5 minutes
    allow_concurrent_inputs=10,
)
class KokoroTTS:
    """Kokoro TTS inference class deployed on Modal."""

    @modal.enter()
    def setup(self):
        """Initialize the model on container startup."""
        import os
        os.environ["HF_HOME"] = "/cache/huggingface"

        from kokoro import KPipeline

        # Initialize pipelines for different languages
        self.pipelines = {}

        # Pre-load American English pipeline (most common)
        print("Loading American English pipeline...")
        self.pipelines["a"] = KPipeline(lang_code="a")

        # Pre-load British English pipeline
        print("Loading British English pipeline...")
        self.pipelines["b"] = KPipeline(lang_code="b")

        print("Kokoro TTS model loaded successfully!")

        # Commit the cache to persist model weights
        model_cache.commit()

    def _get_pipeline(self, lang_code: str):
        """Get or create a pipeline for the given language code."""
        if lang_code not in self.pipelines:
            from kokoro import KPipeline
            self.pipelines[lang_code] = KPipeline(lang_code=lang_code)
        return self.pipelines[lang_code]

    @modal.method()
    def synthesize(
        self,
        text: str,
        voice: str = "af_heart",
        speed: float = 1.0,
        output_format: str = "wav",
    ) -> bytes:
        """
        Synthesize speech from text.

        Args:
            text: Text to synthesize
            voice: Voice ID (e.g., 'af_heart', 'am_adam')
            speed: Speech speed multiplier (0.5 to 2.0)
            output_format: Output format ('wav' or 'mp3')

        Returns:
            Audio data as bytes
        """
        import soundfile as sf
        import numpy as np

        # Determine language from voice prefix
        lang_code = voice[0] if voice else "a"
        pipeline = self._get_pipeline(lang_code)

        # Generate audio
        audio_chunks = []
        for _, _, audio in pipeline(text, voice=voice, speed=speed):
            audio_chunks.append(audio)

        # Concatenate all chunks
        if not audio_chunks:
            raise ValueError("No audio generated")

        full_audio = np.concatenate(audio_chunks)

        # Write to buffer
        buffer = io.BytesIO()
        sf.write(buffer, full_audio, 24000, format=output_format.upper())
        buffer.seek(0)

        return buffer.read()

    @modal.method()
    def get_voices(self) -> list[dict]:
        """Return list of available voices."""
        return [
            {
                "id": voice_id,
                "name": info["name"],
                "gender": info["gender"],
                "language": info["language"],
                "description": info["description"],
            }
            for voice_id, info in KOKORO_VOICES.items()
        ]


# Create a web endpoint for HTTP access
@app.function(image=image)
@modal.asgi_app()
def web_app():
    """FastAPI web application for Kokoro TTS."""
    from fastapi import FastAPI, HTTPException, Response
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel, Field

    web = FastAPI(
        title="Kokoro TTS API",
        description="Text-to-Speech API powered by Kokoro-82M",
        version="1.0.0",
    )

    # Add CORS middleware
    web.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    class SynthesizeRequest(BaseModel):
        text: str = Field(..., description="Text to synthesize")
        voice: str = Field(default="af_heart", description="Voice ID")
        speed: float = Field(default=1.0, ge=0.5, le=2.0, description="Speech speed")
        output_format: str = Field(default="wav", pattern="^(wav|mp3)$")

    class VoiceInfo(BaseModel):
        id: str
        name: str
        gender: str
        language: str
        description: str

    @web.get("/health")
    async def health():
        """Health check endpoint."""
        return {"status": "healthy", "model": "kokoro-82m"}

    @web.get("/voices", response_model=list[VoiceInfo])
    async def list_voices():
        """List available voices."""
        return [
            VoiceInfo(
                id=voice_id,
                name=info["name"],
                gender=info["gender"],
                language=info["language"],
                description=info["description"],
            )
            for voice_id, info in KOKORO_VOICES.items()
        ]

    @web.post("/synthesize")
    async def synthesize(request: SynthesizeRequest):
        """Synthesize speech from text."""
        try:
            # Get the TTS class
            tts = KokoroTTS()

            # Generate audio
            audio_data = tts.synthesize.remote(
                text=request.text,
                voice=request.voice,
                speed=request.speed,
                output_format=request.output_format,
            )

            # Return audio response
            content_type = "audio/wav" if request.output_format == "wav" else "audio/mpeg"
            return Response(
                content=audio_data,
                media_type=content_type,
                headers={
                    "Content-Disposition": f'attachment; filename="speech.{request.output_format}"'
                },
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return web


# CLI for direct invocation
@app.local_entrypoint()
def main(text: str = "Hello, this is a test of the Kokoro text to speech system.", voice: str = "af_heart"):
    """Test the TTS model from command line."""
    tts = KokoroTTS()

    print(f"Synthesizing: {text}")
    print(f"Voice: {voice}")

    audio_data = tts.synthesize.remote(text=text, voice=voice)

    # Save to file
    output_path = "test_output.wav"
    with open(output_path, "wb") as f:
        f.write(audio_data)

    print(f"Audio saved to: {output_path}")
