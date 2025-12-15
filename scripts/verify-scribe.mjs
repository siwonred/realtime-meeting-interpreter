/**
 * CLI verification for ElevenLabs Scribe v2 Realtime.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... node scripts/verify-scribe.mjs ./sample.pcm
 *
 * Input file must be:
 * - raw PCM s16le
 * - mono
 * - 16kHz
 */

import fs from "node:fs";
import process from "node:process";

import {
  AudioFormat,
  CommitStrategy,
  RealtimeEvents,
  Scribe,
} from "@elevenlabs/client";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("Missing ELEVENLABS_API_KEY.");
  process.exit(1);
}

const pcmPath = process.argv[2];
if (!pcmPath) {
  console.error("Usage: node scripts/verify-scribe.mjs <path-to-16khz-mono-s16le.pcm>");
  process.exit(1);
}

if (!fs.existsSync(pcmPath)) {
  console.error(`File not found: ${pcmPath}`);
  process.exit(1);
}

const tokenResp = await fetch(
  "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
  {
    method: "POST",
    headers: { "xi-api-key": apiKey },
  },
);

if (!tokenResp.ok) {
  console.error("Failed to mint token:", tokenResp.status, await tokenResp.text());
  process.exit(1);
}

const { token } = await tokenResp.json();
if (!token) {
  console.error("Token response missing token.");
  process.exit(1);
}

const connection = Scribe.connect({
  token,
  modelId: "scribe_v2_realtime",
  commitStrategy: CommitStrategy.MANUAL,
  audioFormat: AudioFormat.PCM_16000,
  sampleRate: 16000,
});

connection.on(RealtimeEvents.OPEN, () => console.log("[OPEN]"));
connection.on(RealtimeEvents.SESSION_STARTED, (d) =>
  console.log("[SESSION_STARTED]", d.session_id),
);
connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (d) =>
  console.log("[PARTIAL]", d.text),
);
connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (d) =>
  console.log("[COMMITTED]", d.text),
);
connection.on(RealtimeEvents.ERROR, (e) => console.error("[ERROR]", e));
connection.on(RealtimeEvents.CLOSE, () => console.log("[CLOSE]"));

const buf = fs.readFileSync(pcmPath);
const bytesPerChunk = Math.round(16000 * 2 * 0.2); // 200ms

for (let offset = 0; offset < buf.length; offset += bytesPerChunk) {
  const chunk = buf.subarray(offset, offset + bytesPerChunk);
  connection.send({ audioBase64: chunk.toString("base64"), sampleRate: 16000 });
  // Keep a bit of pacing to avoid server-side throttling in CLI tests.
  await new Promise((r) => setTimeout(r, 60));
}

connection.commit();

// Wait a moment for the final committed transcript(s) then close.
await new Promise((r) => setTimeout(r, 1500));
connection.close();


