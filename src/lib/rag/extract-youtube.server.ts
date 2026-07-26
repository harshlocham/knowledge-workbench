import { fetchTranscript } from "youtube-transcript";

import type { VttCue } from "#/lib/rag/parse-vtt.server.ts";

export type ExtractedYoutubeTranscript = {
  videoId: string;
  watchUrl: string;
  title: string;
  cues: VttCue[];
  language?: string;
};

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/** Parse a YouTube URL or bare video id into an 11-character id. */
export function extractYoutubeVideoId(input: string): string {
  const trimmed = input.trim();
  if (VIDEO_ID_RE.test(trimmed)) {
    return trimmed;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("Enter a valid YouTube URL or video id");
  }

  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    if (id && VIDEO_ID_RE.test(id)) {
      return id;
    }
  }

  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com"
  ) {
    const v = url.searchParams.get("v");
    if (v && VIDEO_ID_RE.test(v)) {
      return v;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    // /embed/ID, /shorts/ID, /live/ID, /v/ID
    if (
      parts.length >= 2 &&
      ["embed", "shorts", "live", "v"].includes(parts[0]!) &&
      VIDEO_ID_RE.test(parts[1]!)
    ) {
      return parts[1]!;
    }
  }

  throw new Error("Could not parse a YouTube video id from that URL");
}

export function youtubeWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

async function fetchYoutubeTitle(videoId: string): Promise<string | null> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeWatchUrl(videoId))}&format=json`;
    const response = await fetch(oembedUrl, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { title?: string };
    return data.title?.trim() || null;
  } catch {
    return null;
  }
}

const TRANSCRIPT_FETCH_ATTEMPTS = 3;

const IP_BLOCK_HINT =
  "YouTube blocked caption fetch from this server IP (common on VPS/datacenter hosts). Upload a .vtt instead, or set YOUTUBE_PROXY_URL to a residential HTTP proxy and re-index.";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transcriptFetchErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Failed to fetch YouTube transcript";
}

/** Rate limits / captchas are often misreported as "disabled" by scrapers. */
function isTransientTranscriptError(message: string) {
  return /too many|captcha|receiving too many requests|blocked|ip.?block/i.test(
    message,
  );
}

function looksLikeMissingCaptions(message: string) {
  return /disabled|not available|unavailable|no transcripts are available/i.test(
    message,
  );
}

function mapTranscriptFetchError(message: string): Error {
  if (isTransientTranscriptError(message)) {
    // On VPS, "too many requests" / captcha almost always means IP reputation.
    return new Error(IP_BLOCK_HINT);
  }
  if (looksLikeMissingCaptions(message)) {
    // Same symptom on datacenter IPs even when the video has captions locally.
    return new Error(
      `No captions available for this video (disabled, private, missing, or blocked). ${IP_BLOCK_HINT}`,
    );
  }
  return new Error(message);
}

/**
 * Optional residential proxy for YouTube caption fetches.
 * Bun's fetch accepts `proxy`; Node undici may ignore it — set at the host
 * level via HTTPS_PROXY if needed.
 */
function youtubeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const proxy =
    process.env.YOUTUBE_PROXY_URL?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    undefined;

  if (!proxy) {
    return fetch(input, init);
  }

  return fetch(input, {
    ...init,
    // Bun extension — residential proxy for datacenter hosts
    proxy,
  } as RequestInit & { proxy: string });
}

async function fetchTranscriptWithRetry(videoId: string) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= TRANSCRIPT_FETCH_ATTEMPTS; attempt++) {
    try {
      return await fetchTranscript(videoId, { fetch: youtubeFetch });
    } catch (error) {
      lastError = error;
      const message = transcriptFetchErrorMessage(error);
      const retryable =
        isTransientTranscriptError(message) || looksLikeMissingCaptions(message);

      if (!retryable || attempt === TRANSCRIPT_FETCH_ATTEMPTS) {
        throw mapTranscriptFetchError(message);
      }

      // YouTube often flakes on the first scrape; back off before retrying.
      await sleep(400 * attempt);
    }
  }

  throw mapTranscriptFetchError(transcriptFetchErrorMessage(lastError));
}

/** Fetch captions and title for a YouTube video. */
export async function extractYoutubeTranscript(
  rawUrlOrId: string,
): Promise<ExtractedYoutubeTranscript> {
  const videoId = extractYoutubeVideoId(rawUrlOrId);
  const watchUrl = youtubeWatchUrl(videoId);

  const items = await fetchTranscriptWithRetry(videoId);

  if (!items.length) {
    throw new Error(
      `YouTube returned an empty transcript. ${IP_BLOCK_HINT}`,
    );
  }

  // youtube-transcript srv3 tracks use milliseconds; classic XML uses seconds.
  const maxOffset = Math.max(
    ...items.map((item) => Number(item.offset) || 0),
    0,
  );
  const offsetUnit = maxOffset >= 100_000 ? "ms" : "s";

  const cues: VttCue[] = items
    .map((item, cueIndex) => {
      const rawStart = Math.max(0, Number(item.offset) || 0);
      const rawDuration = Math.max(0, Number(item.duration) || 0);
      const tStart = offsetUnit === "ms" ? rawStart / 1000 : rawStart;
      const duration = offsetUnit === "ms" ? rawDuration / 1000 : rawDuration;
      return {
        cueIndex,
        tStart,
        tEnd: tStart + (duration > 0 ? duration : 2),
        text: item.text.replace(/\s+/g, " ").trim(),
      };
    })
    .filter((cue) => cue.text.length > 0);

  if (cues.length === 0) {
    throw new Error("YouTube transcript contained no usable text");
  }

  const title = (await fetchYoutubeTitle(videoId)) ?? `YouTube ${videoId}`;

  return {
    videoId,
    watchUrl,
    title,
    cues,
    language: items[0]?.lang,
  };
}
