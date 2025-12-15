import { NextResponse } from "next/server";

/**
 * Mints a single-use token for ElevenLabs Scribe v2 Realtime.
 *
 * IMPORTANT:
 * - Never expose your ElevenLabs API key to the browser.
 * - This endpoint is intended to be called by the web client to obtain a short-lived token.
 */
export async function GET(req: Request) {
  // Allow either a server-side secret (recommended) or a client-provided key (dev-only).
  // Client-provided keys will be stored in localStorage by the UI per product requirements.
  const headerKey = req.headers.get("x-elevenlabs-api-key")?.trim();
  const apiKey = process.env.ELEVENLABS_API_KEY || headerKey;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ELEVENLABS_API_KEY." },
      { status: 500 },
    );
  }

  const resp = await fetch(
    "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
      },
      // Ensure Next.js doesn't cache this.
      cache: "no-store",
    },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return NextResponse.json(
      {
        error: "Failed to mint ElevenLabs token.",
        status: resp.status,
        details: text || undefined,
      },
      { status: 502 },
    );
  }

  const data = (await resp.json()) as { token?: string };
  if (!data?.token) {
    return NextResponse.json(
      { error: "ElevenLabs response missing token." },
      { status: 502 },
    );
  }

  return NextResponse.json({ token: data.token }, { status: 200 });
}

export async function POST(req: Request) {
  const headerKey = req.headers.get("x-elevenlabs-api-key")?.trim();
  const apiKey = process.env.ELEVENLABS_API_KEY || headerKey;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ELEVENLABS_API_KEY." },
      { status: 500 },
    );
  }

  const resp = await fetch(
    "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
      },
      cache: "no-store",
    },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return NextResponse.json(
      {
        error: "Failed to mint ElevenLabs token.",
        status: resp.status,
        details: text || undefined,
      },
      { status: 502 },
    );
  }

  const data = (await resp.json()) as { token?: string };
  if (!data?.token) {
    return NextResponse.json(
      { error: "ElevenLabs response missing token." },
      { status: 502 },
    );
  }

  return NextResponse.json({ token: data.token }, { status: 200 });
}


