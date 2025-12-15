"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioFormat,
  CommitStrategy,
  RealtimeEvents,
  Scribe,
  type RealtimeConnection,
} from "@elevenlabs/client";

export type LanguageOption = "auto" | "en" | "ja" | "ko";

export interface TranscriptLine {
  id: string;
  text: string;
  createdAt: number;
  kind: "partial" | "committed";
}

function toElevenLabsLanguageCode(lang: LanguageOption): string | undefined {
  if (lang === "auto") return undefined;
  // ElevenLabs expects ISO-639-1 or ISO-639-3.
  // We use ISO-639-1 for the three supported languages.
  return lang;
}

function downsampleFloat32ToInt16PCM(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
): Int16Array {
  if (outputSampleRate === inputSampleRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i] ?? 0));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Int16Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[idx + 1] ?? s0;
    const sample = s0 + (s1 - s0) * frac;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Avoid stack overflows by chunking.
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function loadInlineWorklet(audioContext: AudioContext): Promise<string> {
  const workletCode = `
class TapProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel && channel.length) {
      // Copy, because Web Audio reuses the underlying buffer.
      this.port.postMessage(new Float32Array(channel));
    }
    return true;
  }
}
registerProcessor("tap-processor", TapProcessor);
`;
  const blob = new Blob([workletCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  await audioContext.audioWorklet.addModule(url);
  return url;
}

export interface UseRealtimeScribeOptions {
  inputLanguage: LanguageOption;
  commitStrategy?: CommitStrategy;
  vadSilenceThresholdSecs?: number;
  vadThreshold?: number;
  minSpeechDurationMs?: number;
  minSilenceDurationMs?: number;
  includeTimestamps?: boolean;
  elevenLabsApiKey?: string; // dev-only (stored in localStorage by UI)
}

export function useRealtimeScribe(options: UseRealtimeScribeOptions) {
  const {
    inputLanguage,
    commitStrategy = CommitStrategy.VAD,
    vadSilenceThresholdSecs = 0.6,
    vadThreshold,
    minSpeechDurationMs,
    minSilenceDurationMs,
    includeTimestamps = false,
    elevenLabsApiKey,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [committed, setCommitted] = useState<TranscriptLine[]>([]);

  const connectionRef = useRef<RealtimeConnection | null>(null);
  const audioCleanupRef = useRef<null | (() => void)>(null);
  const workletUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const targetSampleRate = 16000;
  const chunkMs = 200; // 0.2s chunks keep latency low with minimal overhead

  const tokenHeaders = useMemo(() => {
    const headers: Record<string, string> = {};
    if (elevenLabsApiKey?.trim()) headers["x-elevenlabs-api-key"] = elevenLabsApiKey.trim();
    return headers;
  }, [elevenLabsApiKey]);

  const disconnect = useCallback(() => {
    setIsConnecting(false);
    setIsConnected(false);

    try {
      connectionRef.current?.close();
    } catch {
      // ignore
    } finally {
      connectionRef.current = null;
    }

    try {
      audioCleanupRef.current?.();
    } catch {
      // ignore
    } finally {
      audioCleanupRef.current = null;
    }

    try {
      mediaRecorderRef.current?.stop();
    } catch {
      // ignore
    } finally {
      mediaRecorderRef.current = null;
    }

    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx) {
      void ctx.close().catch(() => {});
    }

    if (workletUrlRef.current) {
      URL.revokeObjectURL(workletUrlRef.current);
      workletUrlRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    if (isConnected || isConnecting) return;
    setLastError(null);
    setPartialTranscript("");
    setIsConnecting(true);

    try {
      const tokenResp = await fetch("/api/scribe-token", {
        method: "POST",
        headers: tokenHeaders,
      });
      const tokenData = (await tokenResp.json()) as { token?: string; error?: string };
      if (!tokenResp.ok || !tokenData?.token) {
        throw new Error(tokenData?.error || "Failed to fetch scribe token.");
      }

      const languageCode = toElevenLabsLanguageCode(inputLanguage);

      const connection = Scribe.connect({
        token: tokenData.token,
        modelId: "scribe_v2_realtime",
        commitStrategy,
        vadSilenceThresholdSecs,
        ...(typeof vadThreshold === "number" ? { vadThreshold } : null),
        ...(typeof minSpeechDurationMs === "number" ? { minSpeechDurationMs } : null),
        ...(typeof minSilenceDurationMs === "number" ? { minSilenceDurationMs } : null),
        includeTimestamps,
        languageCode,
        audioFormat: AudioFormat.PCM_16000,
        sampleRate: targetSampleRate,
      });

      connectionRef.current = connection;

      connection.on(RealtimeEvents.OPEN, () => {
        setIsConnected(true);
        setIsConnecting(false);
      });

      connection.on(RealtimeEvents.CLOSE, () => {
        setIsConnected(false);
        setIsConnecting(false);
      });

      connection.on(RealtimeEvents.ERROR, (err) => {
        setLastError(err?.error || "Unknown realtime error.");
      });

      connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
        setPartialTranscript(data.text || "");
      });

      connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
        const text = (data.text || "").trim();
        if (!text) return;
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        setCommitted((prev) => [
          ...prev,
          { id, text, createdAt: Date.now(), kind: "committed" },
        ]);
        setPartialTranscript("");
      });

      // Microphone capture (Web Audio API) + optional MediaRecorder (for local debug/recording).
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      // Optional: keep a MediaRecorder running (useful for future "download recording" feature).
      try {
        const mr = new MediaRecorder(stream);
        mr.start(1000);
        mediaRecorderRef.current = mr;
      } catch {
        // Some browsers may not support MediaRecorder for the chosen mime type. Ignore.
      }

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const workletUrl = await loadInlineWorklet(audioContext);
      workletUrlRef.current = workletUrl;

      const source = audioContext.createMediaStreamSource(stream);
      const tap = new AudioWorkletNode(audioContext, "tap-processor");
      const mute = audioContext.createGain();
      mute.gain.value = 0;

      // Ensure the node stays "alive" by connecting it into the graph.
      source.connect(tap);
      tap.connect(mute);
      mute.connect(audioContext.destination);

      let pendingBytes: number[] = [];
      const bytesPerChunk = Math.round((targetSampleRate * (chunkMs / 1000)) * 2);
      const inputRate = audioContext.sampleRate;
      let firstChunk = true;

      tap.port.onmessage = (evt: MessageEvent<Float32Array>) => {
        const floatChunk = evt.data;
        const pcm16 = downsampleFloat32ToInt16PCM(floatChunk, inputRate, targetSampleRate);
        const u8 = new Uint8Array(pcm16.buffer);
        for (let i = 0; i < u8.length; i++) pendingBytes.push(u8[i]!);

        while (pendingBytes.length >= bytesPerChunk) {
          const chunk = pendingBytes.slice(0, bytesPerChunk);
          pendingBytes = pendingBytes.slice(bytesPerChunk);
          const base64 = bytesToBase64(new Uint8Array(chunk));

          try {
            connection.send({
              audioBase64: base64,
              sampleRate: targetSampleRate,
              ...(firstChunk && committed.length
                ? { previousText: committed.slice(-12).map((c) => c.text).join("\n") }
                : null),
            });
          } catch {
            // If connection isn't open yet, just drop audio until it is.
            // This keeps UX simple and avoids buffering minutes of audio.
          } finally {
            firstChunk = false;
          }
        }
      };

      audioCleanupRef.current = () => {
        try {
          tap.port.onmessage = null;
        } catch {}
        try {
          source.disconnect();
        } catch {}
        try {
          tap.disconnect();
        } catch {}
        try {
          mute.disconnect();
        } catch {}
        try {
          stream.getTracks().forEach((t) => t.stop());
        } catch {}
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start realtime transcription.";
      setLastError(msg);
      setIsConnected(false);
      setIsConnecting(false);
      disconnect();
    }
  }, [
    commitStrategy,
    committed,
    disconnect,
    includeTimestamps,
    inputLanguage,
    isConnected,
    isConnecting,
    tokenHeaders,
    minSilenceDurationMs,
    minSpeechDurationMs,
    vadThreshold,
    vadSilenceThresholdSecs,
  ]);

  // Ensure cleanup on unmount.
  useEffect(() => disconnect, [disconnect]);

  const reset = useCallback(() => {
    setPartialTranscript("");
    setCommitted([]);
    setLastError(null);
  }, []);

  return {
    isConnected,
    isConnecting,
    lastError,
    partialTranscript,
    committed,
    connect,
    disconnect,
    reset,
  };
}


