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

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
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

/** Fetch captions and title for a YouTube video. */
export async function extractYoutubeTranscript(
  rawUrlOrId: string,
): Promise<ExtractedYoutubeTranscript> {
  const videoId = extractYoutubeVideoId(rawUrlOrId);
  const watchUrl = youtubeWatchUrl(videoId);

  let items: Awaited<ReturnType<typeof fetchTranscript>>;
  try {
    items = await fetchTranscript(videoId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch YouTube transcript";
    if (/disabled|not available|unavailable|too many/i.test(message)) {
      throw new Error(
        "No captions available for this video (disabled, private, or missing transcript)",
      );
    }
    throw new Error(message);
  }

  if (!items.length) {
    throw new Error("YouTube returned an empty transcript");
  }

  const cues: VttCue[] = items.map((item, cueIndex) => {
    const tStart = Math.max(0, Number(item.offset) || 0);
    const duration = Math.max(0, Number(item.duration) || 0);
    return {
      cueIndex,
      tStart,
      tEnd: tStart + (duration > 0 ? duration : 2),
      text: item.text.replace(/\s+/g, " ").trim(),
    };
  }).filter((cue) => cue.text.length > 0);

  if (cues.length === 0) {
    throw new Error("YouTube transcript contained no usable text");
  }

  const title =
    (await fetchYoutubeTitle(videoId)) ?? `YouTube ${videoId}`;

  return {
    videoId,
    watchUrl,
    title,
    cues,
    language: items[0]?.lang,
  };
}
