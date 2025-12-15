# Translator3 — Realtime Speech Translation (EN/JA/KO)

Realtime, browser-based meeting interpretation:

- **Browser microphone → realtime transcription** via **ElevenLabs Scribe v2 Realtime**
- **Realtime translation** (English/Japanese/Korean) via a GPT-style API
- Minimal, Notion-like UI with **system dark mode**
- Designed to stay responsive during **long meetings** (partial vs committed translation modes)

## Setup

Create `.env.local` (or set environment variables) using `env.example` as reference:

- `ELEVENLABS_API_KEY`
- `OPENAI_API_KEY` (optional if you enter it in the UI)
- `OPENAI_MODEL` (default: `gpt-4.1-mini`) — committed translation model
- `OPENAI_MODEL_PARTIAL` (default: `gpt-4.1-nano`) — partial (live) translation model

Install and run:

```bash
npm install
npm run dev
```

If port `3000` is busy, run on a different port:

```bash
npm run dev -- --port 3001
```

Open `http://localhost:3001`.

## Usage (UI)

1) Open the app in **Google Chrome** (Cursor/embedded webviews may not reliably grant microphone permissions).
2) Click **Start** and allow microphone access.
3) Use **Input / Output** language selectors in the top bar.
4) Open **Settings** to configure API keys:
   - Keys are stored in `localStorage` for convenience (dev-friendly).
   - Recommended for production: server-side managed secrets + authentication.

### What you should see

- Left panel: committed transcripts; bottom sticky footer: **LIVE** partial transcript.
- Right panel: committed translations; bottom sticky footer: **LIVE** partial translation.

## Notes

- **Speech-to-text (Scribe)**
  - Uses **server-side VAD** (`CommitStrategy.VAD`) and surfaces **partial transcripts** for low-latency UI.
  - VAD is tuned to produce slightly longer segments (fewer overly short commits).
- **Translation latency for long meetings**
  - Partial translation is **debounced** and uses minimal context.
  - Running summary is updated **intermittently** (not on every segment) to keep latency stable.
- **Key handling**
  - `/api/scribe-token` mints a single-use Scribe token using server `ELEVENLABS_API_KEY` or the request header `x-elevenlabs-api-key` (dev-only).
  - `/api/translate` uses server `OPENAI_API_KEY` or the request header `x-openai-api-key` (dev-only).

## CLI verification (Scribe)

To validate streaming without the browser UI, you can stream a **raw** PCM file:

- PCM s16le
- mono
- 16kHz

```bash
ELEVENLABS_API_KEY=... npm run verify:scribe -- ./sample-16khz-mono-s16le.pcm
```

## Troubleshooting

- **No microphone prompt in Chrome**
  - macOS: System Settings → Privacy & Security → Microphone → enable Google Chrome
  - Chrome: Site settings → Microphone → Allow
- **Transcription works but translation is empty**
  - Ensure `OPENAI_API_KEY` is set (env or Settings)
  - Check dev console / network for `/api/translate` errors

## References

- ElevenLabs announcement: `https://elevenlabs.io/blog/introducing-scribe-v2-realtime`
- ElevenLabs streaming cookbook: `https://elevenlabs.io/docs/developers/guides/cookbooks/speech-to-text/streaming`
