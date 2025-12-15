# Translator3 — Realtime Speech Translation (EN/JA/KO)

This app provides:

- **Browser microphone → realtime transcription** via **ElevenLabs Scribe v2 Realtime**
- **Realtime translation** (English/Japanese/Korean) via a GPT-style API
- Minimal, Notion-like UI with **system dark mode**

## Setup

Create `.env.local` (or set environment variables) using `env.example` as reference:

- `ELEVENLABS_API_KEY`
- `OPENAI_API_KEY` (optional if you enter it in the UI)
- `OPENAI_MODEL` (default: `gpt-4.1-mini`)

Install and run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Notes

- **Keys in UI** are stored in `localStorage` (dev-friendly). For production, move keys to server-side managed secrets and add authentication.
- Scribe is configured to use **server-side VAD** (`CommitStrategy.VAD`) and to surface **partial transcripts** for low-latency UI.

## CLI verification (Scribe)

To validate streaming without the browser UI, you can stream a **raw** PCM file:

- PCM s16le
- mono
- 16kHz

```bash
ELEVENLABS_API_KEY=... npm run verify:scribe -- ./sample-16khz-mono-s16le.pcm
```

## References

- ElevenLabs announcement: `https://elevenlabs.io/blog/introducing-scribe-v2-realtime`
- ElevenLabs streaming cookbook: `https://elevenlabs.io/docs/developers/guides/cookbooks/speech-to-text/streaming`

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
