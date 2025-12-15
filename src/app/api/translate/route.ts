import { NextResponse } from "next/server";

type LanguageOption = "auto" | "en" | "ja" | "ko";

interface TranslateRequestBody {
  sourceLang: LanguageOption;
  targetLang: Exclude<LanguageOption, "auto">;
  text: string;
  mode?: "partial" | "committed";
  updateSummary?: boolean;
  // Long-meeting context strategy:
  // - summary: compact, updatable memory of the meeting so far
  // - recent: most recent committed segments (high fidelity)
  summary?: string;
  recent?: string[];
}

interface TranslateResponseBody {
  detectedLanguage: "en" | "ja" | "ko" | "other";
  shouldIgnore: boolean;
  translation: string;
  updatedSummary: string;
}

interface OpenAIChatCompletionsResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

const SYSTEM_INSTRUCTION = `
You are a real-time interpreter used inside business meetings and ChannelTalk (customer support chat + internal comms).

Goals:
- Translate faithfully, quickly, and clearly.
- Preserve proper nouns, product names, URLs, numbers, units, and formatting.
- Prefer concise, business-appropriate phrasing.
- If the target language is English, use professional tone; if Japanese, use polite business Japanese; if Korean, use natural business Korean.

Input language gating:
- If sourceLang is NOT "auto", only accept that language.
- If the text is primarily in a different language, set shouldIgnore=true and translation="".

Context:
- You receive a compact running summary plus a few recent committed segments.
- Use them to resolve ambiguous references and maintain consistency.
- Keep updatedSummary short (<= 800 characters), capturing key entities, decisions, and terminology.

Output MUST be a JSON object with fields:
detectedLanguage: "en" | "ja" | "ko" | "other"
shouldIgnore: boolean
translation: string
updatedSummary: string
`.trim();

function getOpenAIKey(req: Request): string | null {
  const headerKey = req.headers.get("x-openai-api-key")?.trim();
  return process.env.OPENAI_API_KEY || headerKey || null;
}

export async function POST(req: Request) {
  const apiKey = getOpenAIKey(req);
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY." },
      { status: 500 },
    );
  }

  let payload: TranslateRequestBody;
  try {
    payload = (await req.json()) as TranslateRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = (payload.text || "").trim();
  if (!text) {
    const empty: TranslateResponseBody = {
      detectedLanguage: "other",
      shouldIgnore: false,
      translation: "",
      updatedSummary: payload.summary || "",
    };
    return NextResponse.json(empty, { status: 200 });
  }

  const mode = payload.mode === "partial" ? "partial" : "committed";
  const updateSummary = Boolean(payload.updateSummary);

  const model =
    mode === "partial"
      ? process.env.OPENAI_MODEL_PARTIAL || "gpt-4.1-nano"
      : process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const userContent = JSON.stringify(
    {
      sourceLang: payload.sourceLang,
      targetLang: payload.targetLang,
      text,
      mode,
      updateSummary,
      // To keep latency stable:
      // - For partial mode, the client should keep context minimal.
      summary: payload.summary || "",
      recent: payload.recent || [],
    },
    null,
    2,
  );

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: mode === "partial" ? 0.1 : 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTION },
        {
          role: "user",
          content:
            (mode === "partial"
              ? "Translate quickly for the following JSON payload. Do NOT expand summary. If updateSummary=false, keep updatedSummary identical to the input summary.\n\n"
              : "Translate and update summary for the following JSON payload. If updateSummary=false, keep updatedSummary identical to the input summary.\n\n") +
            userContent,
        },
      ],
    }),
    cache: "no-store",
  });

  if (!resp.ok) {
    const details = await resp.text().catch(() => "");
    return NextResponse.json(
      {
        error: "Translation request failed.",
        status: resp.status,
        details: details || undefined,
      },
      { status: 502 },
    );
  }

  const data = (await resp.json()) as OpenAIChatCompletionsResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    return NextResponse.json(
      { error: "Model response missing content." },
      { status: 502 },
    );
  }

  let parsed: TranslateResponseBody;
  try {
    parsed = JSON.parse(content) as TranslateResponseBody;
  } catch {
    return NextResponse.json(
      { error: "Model response was not valid JSON.", raw: content },
      { status: 502 },
    );
  }

  // Normalize / guardrails
  const out: TranslateResponseBody = {
    detectedLanguage:
      parsed.detectedLanguage === "en" ||
      parsed.detectedLanguage === "ja" ||
      parsed.detectedLanguage === "ko"
        ? parsed.detectedLanguage
        : "other",
    shouldIgnore: Boolean(parsed.shouldIgnore),
    translation: typeof parsed.translation === "string" ? parsed.translation : "",
    updatedSummary:
      typeof parsed.updatedSummary === "string"
        ? parsed.updatedSummary.slice(0, 800)
        : (payload.summary || "").slice(0, 800),
  };

  return NextResponse.json(out, { status: 200 });
}


