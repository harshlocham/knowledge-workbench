import { fetchTranscript } from "youtube-transcript";

import type { VttCue } from "#/lib/rag/parse-vtt.server.ts";
import { transcriptItemsToCues } from "#/lib/rag/youtube-transcript-shared.ts";
import {
  extractYoutubeVideoId,
  youtubeWatchUrl,
} from "#/lib/rag/youtube-url.ts";

export type ExtractedYoutubeTranscript = {
  videoId: string;
  watchUrl: string;
  title: string;
  cues: VttCue[];
  language?: string;
};

export { extractYoutubeVideoId, youtubeWatchUrl };

/** Bun's fetch accepts `proxy`; TypeScript's DOM fetch typings do not. */
type BunFetchInit = RequestInit & { proxy?: string };

export function getYoutubeProxyUrl(): string | undefined {
  const value = process.env.YOUTUBE_PROXY_URL?.trim();
  return value || undefined;
}

/**
 * Production VPS IPs are blocked by YouTube. Caption fetch must use a
 * residential proxy — only keep a proxy that prints VPS_OK from
 * `bun run verify:youtube-proxy` inside the app container.
 */
export function assertYoutubeProxyConfiguredForProduction() {
  if (process.env.NODE_ENV !== "production") {
    return;
  }
  if (!getYoutubeProxyUrl()) {
    throw new Error(
      "YOUTUBE_PROXY_URL is required in production. Use a residential HTTP(S) proxy, then run: bun run verify:youtube-proxy (must print VPS_OK).",
    );
  }
}

/** All YouTube caption/network calls must go through this so the proxy is never skipped. */
export function youtubeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const proxy = getYoutubeProxyUrl();
  const next: BunFetchInit = { ...init };
  if (proxy) {
    next.proxy = proxy;
  }
  return fetch(input, next);
}

async function fetchYoutubeTitle(videoId: string): Promise<string | null> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeWatchUrl(videoId))}&format=json`;
    const response = await youtubeFetch(oembedUrl, {
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transcriptFetchErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Failed to fetch YouTube transcript";
}

function isTransientTranscriptError(message: string) {
  return /too many|captcha|receiving too many requests|sign in to confirm|not a bot/i.test(
    message,
  );
}

function mapTranscriptFetchError(message: string): Error {
  if (isTransientTranscriptError(message)) {
    const viaProxy = getYoutubeProxyUrl()
      ? " Check YOUTUBE_PROXY_URL is a working residential proxy (`bun run verify:youtube-proxy` must print VPS_OK)."
      : " Set YOUTUBE_PROXY_URL to a residential proxy and verify with `bun run verify:youtube-proxy`.";
    return new Error(
      `YouTube blocked caption fetch from this egress IP.${viaProxy}`,
    );
  }
  if (/disabled|not available|unavailable/i.test(message)) {
    return new Error(
      "No captions available for this video (disabled, private, or missing transcript)",
    );
  }
  return new Error(message);
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
        isTransientTranscriptError(message) ||
        /disabled|not available|unavailable/i.test(message);

      if (!retryable || attempt === TRANSCRIPT_FETCH_ATTEMPTS) {
        throw mapTranscriptFetchError(message);
      }

      await sleep(400 * attempt);
    }
  }

  throw mapTranscriptFetchError(transcriptFetchErrorMessage(lastError));
}

/**
 * Server-side caption fetch.
 * Local: works without a proxy on residential IPs.
 * Production: requires YOUTUBE_PROXY_URL (residential) verified with VPS_OK.
 */
export async function extractYoutubeTranscript(
  rawUrlOrId: string,
): Promise<ExtractedYoutubeTranscript> {
  assertYoutubeProxyConfiguredForProduction();

  const videoId = extractYoutubeVideoId(rawUrlOrId);
  const watchUrl = youtubeWatchUrl(videoId);

  const items = await fetchTranscriptWithRetry(videoId);

  if (!items.length) {
    throw new Error("YouTube returned an empty transcript");
  }

  const cues = transcriptItemsToCues(items);
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
