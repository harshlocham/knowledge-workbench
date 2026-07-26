import { fetchTranscript } from "youtube-transcript";

import type { VttCue } from "#/lib/rag/parse-vtt.server.ts";
import {
  captionFetchUrls,
  captionTracksFromPlayerResponse,
  parseTranscriptXml,
  parseYtInitialPlayerResponse,
  sortCaptionTracks,
  titleFromPlayerResponse,
  transcriptItemsToCues,
  type YoutubeTranscriptItem,
} from "#/lib/rag/youtube-transcript-shared.ts";
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

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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
  return /too many|captcha|receiving too many requests|sign in to confirm|not a bot|empty transcript/i.test(
    message,
  );
}

function mapTranscriptFetchError(message: string): Error {
  if (isTransientTranscriptError(message) && !/empty transcript/i.test(message)) {
    const viaProxy = getYoutubeProxyUrl()
      ? " Check YOUTUBE_PROXY_URL is a working residential proxy (`bun run verify:youtube-proxy` must print VPS_OK)."
      : " Set YOUTUBE_PROXY_URL to a residential proxy and verify with `bun run verify:youtube-proxy`.";
    return new Error(
      `YouTube blocked caption fetch from this egress IP.${viaProxy}`,
    );
  }
  if (/disabled|not available|unavailable|empty transcript/i.test(message)) {
    return new Error(
      "No captions available for this video (disabled, private, or missing transcript). Re-index later, or upload a .vtt if you have one.",
    );
  }
  return new Error(message);
}

/**
 * Watch-page fallback: youtube-transcript's InnerTube path can return [] and
 * skip HTML scraping (empty array is truthy). Try tracks ourselves via proxy.
 */
async function fetchTranscriptViaWatchPage(
  videoId: string,
): Promise<{ items: YoutubeTranscriptItem[]; title: string | null }> {
  const response = await youtubeFetch(youtubeWatchUrl(videoId), {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const html = await response.text();

  if (/class="g-recaptcha"|sign in to confirm you.re not a bot/i.test(html)) {
    throw new Error(
      "YouTube is receiving too many requests from this IP and now requires solving a captcha to continue",
    );
  }

  const player = parseYtInitialPlayerResponse(html);
  if (!player) {
    return { items: [], title: null };
  }

  const title = titleFromPlayerResponse(player);
  const tracks = sortCaptionTracks(captionTracksFromPlayerResponse(player));
  if (tracks.length === 0) {
    return { items: [], title };
  }

  for (const track of tracks) {
    for (const url of captionFetchUrls(track.baseUrl)) {
      try {
        const captionUrl = new URL(url);
        if (!captionUrl.hostname.endsWith("youtube.com")) {
          continue;
        }
        const captionResponse = await youtubeFetch(captionUrl.toString(), {
          headers: { "User-Agent": USER_AGENT },
        });
        if (!captionResponse.ok) continue;
        const xml = await captionResponse.text();
        const items = parseTranscriptXml(xml, track.languageCode).filter(
          (item) => item.text.trim().length > 0,
        );
        if (items.length > 0) {
          return { items, title };
        }
      } catch {
        // try next track/url
      }
    }
  }

  return { items: [], title };
}

async function fetchTranscriptItems(
  videoId: string,
): Promise<{ items: YoutubeTranscriptItem[]; pageTitle: string | null }> {
  // Library first (InnerTube). Empty [] must not stop the HTML fallback.
  try {
    const items = await fetchTranscript(videoId, { fetch: youtubeFetch });
    if (items.length > 0) {
      return { items, pageTitle: null };
    }
  } catch (error) {
    const message = transcriptFetchErrorMessage(error);
    // Hard failures that HTML won't fix — rethrow after mapping later.
    if (
      /too many|captcha|receiving too many requests|sign in to confirm|not a bot/i.test(
        message,
      )
    ) {
      throw error;
    }
    // disabled / unavailable — still try watch page once (sometimes more accurate)
  }

  return fetchTranscriptViaWatchPage(videoId);
}

async function fetchTranscriptWithRetry(videoId: string) {
  let lastError: unknown;
  let pageTitle: string | null = null;

  for (let attempt = 1; attempt <= TRANSCRIPT_FETCH_ATTEMPTS; attempt++) {
    try {
      const result = await fetchTranscriptItems(videoId);
      pageTitle = result.pageTitle ?? pageTitle;
      if (result.items.length > 0) {
        return { items: result.items, pageTitle };
      }
      lastError = new Error("YouTube returned an empty transcript");
    } catch (error) {
      lastError = error;
      const message = transcriptFetchErrorMessage(error);
      const retryable =
        isTransientTranscriptError(message) ||
        /disabled|not available|unavailable/i.test(message);

      if (!retryable || attempt === TRANSCRIPT_FETCH_ATTEMPTS) {
        throw mapTranscriptFetchError(message);
      }

      await sleep(500 * attempt + Math.floor(Math.random() * 300));
      continue;
    }

    if (attempt === TRANSCRIPT_FETCH_ATTEMPTS) {
      break;
    }
    // Empty often means soft rate-limit during playlist bursts.
    await sleep(700 * attempt + Math.floor(Math.random() * 400));
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

  const { items, pageTitle } = await fetchTranscriptWithRetry(videoId);

  if (!items.length) {
    throw mapTranscriptFetchError("YouTube returned an empty transcript");
  }

  const cues = transcriptItemsToCues(items);
  if (cues.length === 0) {
    throw new Error("YouTube transcript contained no usable text");
  }

  const title =
    pageTitle ||
    (await fetchYoutubeTitle(videoId)) ||
    `YouTube ${videoId}`;

  return {
    videoId,
    watchUrl,
    title,
    cues,
    language: items[0]?.lang,
  };
}
