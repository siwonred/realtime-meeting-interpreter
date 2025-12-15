"use client";

import { CommitStrategy } from "@elevenlabs/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtimeScribe, type LanguageOption } from "@/lib/realtime/useRealtimeScribe";
import { useLocalStorageState } from "@/lib/useLocalStorageState";

const LANG_LABEL: Record<LanguageOption, string> = {
  auto: "Auto",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
};

export default function Home() {
  const inputLang = useLocalStorageState<LanguageOption>("t3.inputLang", "auto");
  const elevenKey = useLocalStorageState<string>("t3.elevenlabsKey", "");
  const openaiKey = useLocalStorageState<string>("t3.openaiKey", "");
  const targetLang = useLocalStorageState<LanguageOption>("t3.targetLang", "en");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [partialTranslation, setPartialTranslation] = useState("");
  const [translated, setTranslated] = useState<
    { id: string; sourceId: string; text: string; createdAt: number }[]
  >([]);
  const [summary, setSummary] = useState("");
  const translatedIdsRef = useRef<Set<string>>(new Set());
  const partialTimerRef = useRef<number | null>(null);
  const partialAbortRef = useRef<AbortController | null>(null);
  const lastPartialSentRef = useRef<string>("");
  const originalScrollRef = useRef<HTMLDivElement | null>(null);
  const translationScrollRef = useRef<HTMLDivElement | null>(null);

  const scribe = useRealtimeScribe({
    inputLanguage: inputLang.value,
    commitStrategy: CommitStrategy.VAD,
    // Tune VAD to create slightly longer segments (fewer overly short commits).
    vadSilenceThresholdSecs: 1.0,
    minSilenceDurationMs: 700,
    minSpeechDurationMs: 250,
    elevenLabsApiKey: elevenKey.value || undefined,
  });

  type TranslateApiOk = {
    detectedLanguage: "en" | "ja" | "ko" | "other";
    shouldIgnore: boolean;
    translation: string;
    updatedSummary: string;
  };
  type TranslateApiErr = { error?: string };

  const translateViaApi = useCallback(
    async (args: {
      text: string;
      sourceLang: LanguageOption;
      targetLang: "en" | "ja" | "ko";
      mode: "partial" | "committed";
      updateSummary: boolean;
      recent: string[];
      summary: string;
      signal?: AbortSignal;
    }): Promise<TranslateApiOk> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (openaiKey.value?.trim()) headers["x-openai-api-key"] = openaiKey.value.trim();

      const resp = await fetch("/api/translate", {
        method: "POST",
        headers,
        body: JSON.stringify(args),
        signal: args.signal,
      });

      const data = (await resp.json()) as TranslateApiOk | TranslateApiErr;
      if (!resp.ok) {
        const msg =
          typeof (data as TranslateApiErr)?.error === "string"
            ? (data as TranslateApiErr).error
            : "Translation request failed.";
        throw new Error(msg);
      }
      return data as TranslateApiOk;
    },
    [openaiKey.value],
  );

  const status = useMemo(() => {
    if (scribe.isConnecting) return "Connecting…";
    if (scribe.isConnected) return "Live";
    return "Idle";
  }, [scribe.isConnected, scribe.isConnecting]);

  // Translate committed segments (high-fidelity)
  useEffect(() => {
    const last = scribe.committed[scribe.committed.length - 1];
    if (!last) return;
    if (translatedIdsRef.current.has(last.id)) return;

    translatedIdsRef.current.add(last.id);

    const outLang = (targetLang.value === "auto" ? "en" : targetLang.value) as
      | "en"
      | "ja"
      | "ko";

    // If user sets output language same as input (and input isn't auto), just mirror text.
    if (inputLang.value !== "auto" && inputLang.value === outLang) {
      queueMicrotask(() => {
        setTranslated((prev) => [
          ...prev,
          {
            id: `${last.id}-t`,
            sourceId: last.id,
            text: last.text,
            createdAt: Date.now(),
          },
        ]);
      });
      return;
    }

    // Only update running summary occasionally to keep latency stable during long meetings.
    const shouldUpdateSummary = summary.length === 0 || scribe.committed.length % 4 === 0;
    const recent = scribe.committed.slice(-8).map((t) => t.text);
    void (async () => {
      try {
        const res = await translateViaApi({
          text: last.text,
          sourceLang: inputLang.value,
          targetLang: outLang,
          mode: "committed",
          updateSummary: shouldUpdateSummary,
          recent,
          summary,
        });

        if (shouldUpdateSummary && res.updatedSummary && typeof res.updatedSummary === "string") {
          setSummary(res.updatedSummary);
        }

        if (res.shouldIgnore) return;
        const translatedText = (res.translation || "").trim();
        if (!translatedText) return;
        setTranslated((prev) => [
          ...prev,
          {
            id: `${last.id}-t`,
            sourceId: last.id,
            text: translatedText,
            createdAt: Date.now(),
          },
        ]);
      } catch {
        // Keep UX stable; surface errors via the existing error banner.
      }
    })();
  }, [
    inputLang.value,
    scribe.committed,
    summary,
    targetLang.value,
    translateViaApi,
  ]);

  // Translate partial transcript (fast preview). Debounced + aborted on new input.
  useEffect(() => {
    if (!scribe.isConnected) {
      queueMicrotask(() => setPartialTranslation(""));
      return;
    }
    const text = (scribe.partialTranscript || "").trim();
    if (!text) {
      queueMicrotask(() => setPartialTranslation(""));
      return;
    }

    if (partialTimerRef.current) window.clearTimeout(partialTimerRef.current);
    partialAbortRef.current?.abort();

    partialTimerRef.current = window.setTimeout(() => {
      // Skip if the change is tiny; avoids hammering the translation API.
      const prev = lastPartialSentRef.current;
      if (prev && text.startsWith(prev) && text.length - prev.length < 6) return;
      lastPartialSentRef.current = text;

      const controller = new AbortController();
      partialAbortRef.current = controller;

      const outLang = (targetLang.value === "auto" ? "en" : targetLang.value) as
        | "en"
        | "ja"
        | "ko";

      if (inputLang.value !== "auto" && inputLang.value === outLang) {
        queueMicrotask(() => setPartialTranslation(text));
        return;
      }

      // Keep partial translation context minimal for low latency.
      const recent = scribe.committed.slice(-3).map((t) => t.text);
      void (async () => {
        try {
          const res = await translateViaApi({
            text,
            sourceLang: inputLang.value,
            targetLang: outLang,
            mode: "partial",
            updateSummary: false,
            recent,
            summary: "",
            signal: controller.signal,
          });
          if (res.shouldIgnore) {
            queueMicrotask(() => setPartialTranslation(""));
            return;
          }
          queueMicrotask(() => setPartialTranslation((res.translation || "").trim()));
        } catch {
          // ignore (likely aborted)
        }
      })();
    }, 900);

    return () => {
      if (partialTimerRef.current) window.clearTimeout(partialTimerRef.current);
      partialAbortRef.current?.abort();
    };
  }, [
    inputLang.value,
    scribe.committed,
    scribe.isConnected,
    scribe.partialTranscript,
    summary,
    targetLang.value,
    translateViaApi,
  ]);

  // Keep panels scrolled to the bottom as new segments arrive.
  useEffect(() => {
    const el = originalScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [scribe.committed.length]);

  useEffect(() => {
    const el = translationScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [translated.length]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <header className="sticky top-0 z-10 border-b border-zinc-200/70 bg-zinc-50/80 backdrop-blur dark:border-white/10 dark:bg-black/60">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold tracking-tight">Translator3</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{status}</div>
          </div>

          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-white/10 dark:bg-zinc-950"
              value={inputLang.value}
              onChange={(e) => inputLang.setValue(e.target.value as LanguageOption)}
              aria-label="Input language"
              disabled={scribe.isConnected || scribe.isConnecting}
              title="Input language (used as a hint for transcription)"
            >
              {Object.entries(LANG_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  Input: {v}
                </option>
              ))}
            </select>

            <select
              className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-white/10 dark:bg-zinc-950"
              value={targetLang.value}
              onChange={(e) => targetLang.setValue(e.target.value as LanguageOption)}
              aria-label="Target language"
              title="Target language (translation)"
            >
              {(["en", "ja", "ko"] as const).map((k) => (
                <option key={k} value={k}>
                  Output: {LANG_LABEL[k]}
                </option>
              ))}
            </select>

            {!scribe.isConnected ? (
              <button
                className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                onClick={scribe.connect}
                disabled={scribe.isConnecting}
              >
                Start
              </button>
            ) : (
              <button
                className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:hover:bg-white/10"
                onClick={scribe.disconnect}
              >
                Stop
              </button>
            )}

            <button
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:hover:bg-white/10"
              onClick={() => setIsSettingsOpen((v) => !v)}
              aria-expanded={isSettingsOpen}
              aria-controls="settings-panel"
            >
              Settings
            </button>
          </div>
        </div>

        {isSettingsOpen && (
          <div
            id="settings-panel"
            className="border-t border-zinc-200 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-zinc-950/70"
          >
            <div className="mx-auto w-full max-w-6xl px-4 py-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-950">
                  <div className="mb-2 text-sm font-medium">API keys (stored in localStorage)</div>
                  <div className="space-y-2">
                    <input
                      className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-white/10 dark:bg-black"
                      placeholder="ElevenLabs API key (optional if server has ELEVENLABS_API_KEY)"
                      value={elevenKey.value}
                      onChange={(e) => elevenKey.setValue(e.target.value)}
                      type="password"
                    />
                    <input
                      className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-white/10 dark:bg-black"
                      placeholder="OpenAI API key (optional if server has OPENAI_API_KEY)"
                      value={openaiKey.value}
                      onChange={(e) => openaiKey.setValue(e.target.value)}
                      type="password"
                    />
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      For production, move keys to server-side secrets and add authentication.
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-950">
                  <div className="mb-2 text-sm font-medium">Context</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    The translator uses recent segments + a compact running summary to keep quality stable during long meetings.
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:hover:bg-white/10"
                      onClick={() => setSummary("")}
                      title="Clear running summary"
                    >
                      Clear summary
                    </button>
                    <button
                      className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:hover:bg-white/10"
                      onClick={() => {
                        translatedIdsRef.current = new Set();
                        setTranslated([]);
                        setPartialTranslation("");
                        scribe.reset();
                      }}
                      title="Clear transcripts + translations"
                    >
                      Clear all
                    </button>
                  </div>
                </div>
              </div>

              {scribe.lastError && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                  {scribe.lastError}
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-zinc-200 bg-white dark:border-white/10 dark:bg-zinc-950">
            <div className="border-b border-zinc-200 px-4 py-3 text-sm font-medium dark:border-white/10">
              Original (live transcription)
            </div>
            <div className="flex h-[calc(100dvh-220px)] min-h-[420px] flex-col">
              <div ref={originalScrollRef} className="min-h-0 flex-1 overflow-auto p-4">
                {scribe.committed.length === 0 ? (
                  <div className="text-sm text-zinc-400">
                    Committed segments will accumulate here (server-side VAD).
                  </div>
                ) : (
                  <div className="space-y-2">
                    {scribe.committed.slice(-200).map((t) => (
                      <div key={t.id} className="text-sm leading-5">
                        {t.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-zinc-200 bg-white/80 p-3 backdrop-blur dark:border-white/10 dark:bg-zinc-950/70">
                {scribe.partialTranscript ? (
                  <div className="text-sm text-zinc-700 dark:text-zinc-200">
                    <span className="mr-2 inline-block rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                      LIVE
                    </span>
                    {scribe.partialTranscript}
                  </div>
                ) : (
                  <div className="text-sm text-zinc-400">Live partial transcript will appear here.</div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white dark:border-white/10 dark:bg-zinc-950">
            <div className="border-b border-zinc-200 px-4 py-3 text-sm font-medium dark:border-white/10">
              Translation
            </div>
            <div className="flex h-[calc(100dvh-220px)] min-h-[420px] flex-col">
              <div ref={translationScrollRef} className="min-h-0 flex-1 overflow-auto p-4">
                {translated.length === 0 ? (
                  <div className="text-sm text-zinc-400">
                    Translated committed segments will accumulate here.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {translated.slice(-200).map((t) => (
                      <div key={t.id} className="text-sm leading-5">
                        {t.text}
                      </div>
                    ))}
                  </div>
                )}

                {summary ? (
                  <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-white/10 dark:bg-black dark:text-zinc-300">
                    <div className="mb-1 font-medium">Running summary</div>
                    <div className="whitespace-pre-wrap leading-5">{summary}</div>
                  </div>
                ) : null}
              </div>

              <div className="border-t border-zinc-200 bg-white/80 p-3 backdrop-blur dark:border-white/10 dark:bg-zinc-950/70">
                {partialTranslation ? (
                  <div className="text-sm text-zinc-700 dark:text-zinc-200">
                    <span className="mr-2 inline-block rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                      LIVE
                    </span>
                    {partialTranslation}
                  </div>
                ) : (
                  <div className="text-sm text-zinc-400">Live translated preview will appear here.</div>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
