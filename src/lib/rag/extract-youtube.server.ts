import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchTranscript } from "youtube-transcript";

import type { VttCue } from "#/lib/rag/parse-vtt.server.ts";
import {
  parseTranscriptXml,
  transcriptItemsToCues,
} from "#/lib/rag/youtube-transcript-shared.ts";
import {
  extractYoutubeVideoId,
  youtubeWatchUrl,
} from "#/lib/rag/youtube-url.ts";

export { extractYoutubeVideoId, youtubeWatchUrl };

const execFileAsync = promisify(execFile);

export type ExtractedYoutubeTranscript = {
  videoId: string;
  watchUrl: string;
  title: string;
  cues: VttCue[];
  language?: string;
};

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
  "YouTube blocked caption fetch from this server IP. Retry adding the source, or upload a .vtt file.";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transcriptFetchErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Failed to fetch YouTube transcript";
}

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
  if (isTransientTranscriptError(message) || looksLikeMissingCaptions(message)) {
    return new Error(
      `No captions available for this video (disabled, private, missing, or blocked). ${IP_BLOCK_HINT}`,
    );
  }
  return new Error(message);
}

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
        isTransientTranscriptError(message) ||
        looksLikeMissingCaptions(message);

      if (!retryable || attempt === TRANSCRIPT_FETCH_ATTEMPTS) {
        throw mapTranscriptFetchError(message);
      }

      await sleep(400 * attempt);
    }
  }

  throw mapTranscriptFetchError(transcriptFetchErrorMessage(lastError));
}

function parseVttClock(value: string): number {
  const cleaned = value.trim().replace(",", ".");
  const parts = cleaned.split(":");
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function cuesFromVtt(vtt: string): VttCue[] {
  const lines = vtt.replace(/\r/g, "").split("\n");
  const cues: VttCue[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (line === "WEBVTT" || line === "" || line.startsWith("NOTE")) {
      i += 1;
      continue;
    }
    let timingLine = line;
    if (!line.includes("-->") && i + 1 < lines.length) {
      timingLine = lines[i + 1]!.trim();
      i += 1;
    }
    if (!timingLine.includes("-->")) {
      i += 1;
      continue;
    }
    const [startRaw, endRaw] = timingLine.split("-->").map((s) => s.trim());
    const tStart = parseVttClock(startRaw!.split(" ")[0]!);
    const tEnd = parseVttClock(endRaw!.split(" ")[0]!);
    i += 1;
    const textLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "") {
      textLines.push(lines[i]!.trim().replace(/<[^>]+>/g, ""));
      i += 1;
    }
    const text = textLines.join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      cues.push({ cueIndex: cues.length, tStart, tEnd, text });
    }
    i += 1;
  }
  return cues;
}

/** yt-dlp often succeeds on hosts where timedtext scrapers are blocked. */
async function fetchTranscriptViaYtDlp(
  videoId: string,
): Promise<{ cues: VttCue[]; language?: string } | null> {
  const bin = process.env.YT_DLP_PATH?.trim() || "yt-dlp";
  const dir = await mkdtemp(join(tmpdir(), "kb-yt-"));

  try {
    await execFileAsync(
      bin,
      [
        "--write-auto-sub",
        "--write-sub",
        "--sub-langs",
        "en.*,en",
        "--skip-download",
        "--convert-subs",
        "vtt",
        "--extractor-args",
        "youtube:player_client=android",
        "-o",
        join(dir, "sub"),
        youtubeWatchUrl(videoId),
      ],
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
    );

    const files = await readdir(dir);
    const vttName = files.find((name) => name.endsWith(".vtt"));
    if (!vttName) {
      return null;
    }

    const vtt = await readFile(join(dir, vttName), "utf8");
    const cues = cuesFromVtt(vtt);
    if (cues.length === 0) {
      // Some tracks are XML-like despite .vtt extension
      const xmlCues = transcriptItemsToCues(parseTranscriptXml(vtt, "en"));
      if (xmlCues.length === 0) return null;
      return { cues: xmlCues, language: "en" };
    }

    const langMatch = vttName.match(/\.([a-z]{2}(-[A-Za-z]+)?)\.vtt$/i);
    return {
      cues,
      language: langMatch?.[1] || "en",
    };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Fetch captions and title for a YouTube video. */
export async function extractYoutubeTranscript(
  rawUrlOrId: string,
): Promise<ExtractedYoutubeTranscript> {
  const videoId = extractYoutubeVideoId(rawUrlOrId);
  const watchUrl = youtubeWatchUrl(videoId);

  let cues: VttCue[] = [];
  let language: string | undefined;

  try {
    const items = await fetchTranscriptWithRetry(videoId);
    cues = transcriptItemsToCues(items);
    language = items[0]?.lang;
  } catch (primaryError) {
    const viaYtDlp = await fetchTranscriptViaYtDlp(videoId);
    if (!viaYtDlp) {
      throw primaryError instanceof Error
        ? primaryError
        : new Error(String(primaryError));
    }
    cues = viaYtDlp.cues;
    language = viaYtDlp.language;
  }

  if (cues.length === 0) {
    throw new Error(`YouTube returned an empty transcript. ${IP_BLOCK_HINT}`);
  }

  const title = (await fetchYoutubeTitle(videoId)) ?? `YouTube ${videoId}`;

  return {
    videoId,
    watchUrl,
    title,
    cues,
    language,
  };
}
