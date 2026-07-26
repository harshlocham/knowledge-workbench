import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { sources } from "#/db/schema/sources.ts";
import { chunkVttCues } from "#/lib/rag/chunk-vtt.ts";
import { extractYoutubeTranscript } from "#/lib/rag/extract-youtube.server.ts";
import { friendlyIngestError } from "#/lib/ingest/limits.ts";
import {
  clearSourceIndex,
  persistSourceChunks,
  setSourceIndexProgress,
  setSourceStatus,
} from "#/lib/rag/index-source.server.ts";
import type { YoutubeCueInput } from "#/lib/rag/youtube-transcript-shared.ts";
import {
  extractYoutubeVideoId,
  youtubeWatchUrl,
} from "#/lib/rag/youtube-url.ts";

export type YoutubeSourceMetadata = {
  content: string;
  charCount: number;
  cueCount: number;
  durationSeconds: number;
  videoId: string;
  watchUrl: string;
  language?: string;
  cues: Array<{
    cueIndex: number;
    tStart: number;
    tEnd: number;
    text: string;
  }>;
};

function normalizeCues(cues: YoutubeCueInput[]) {
  return cues
    .map((cue, cueIndex) => ({
      cueIndex,
      tStart: Math.max(0, Number(cue.tStart) || 0),
      tEnd: Math.max(
        Math.max(0, Number(cue.tStart) || 0),
        Number(cue.tEnd) || 0,
      ),
      text: String(cue.text ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((cue) => cue.text.length > 0);
}

/**
 * YouTube-specific steps: captions → timed chunks with videoId.
 * Prefer browser-prefetched cues (VPS IPs are often blocked by YouTube).
 */
export async function indexYoutubeSource(options: {
  sourceId: string;
  notebookId: string;
  ownerId: string;
  urlOrId: string;
  updateTitleFromVideo?: boolean;
  existingMetadata?: Record<string, unknown> | null;
  /** Captions fetched in the browser (avoids VPS IP blocks). */
  prefetched?: {
    title?: string;
    language?: string;
    cues: YoutubeCueInput[];
  };
}) {
  const { sourceId, notebookId, ownerId } = options;

  await setSourceStatus(sourceId, "indexing");
  await clearSourceIndex(sourceId);

  try {
    const hasPrefetch = Boolean(options.prefetched?.cues.length);
    const existingCues = options.existingMetadata?.cues;
    const hasStoredCues =
      Array.isArray(existingCues) && existingCues.length > 0;

    await setSourceIndexProgress(sourceId, {
      phase: "extracting",
      percent: 15,
      message: hasPrefetch
        ? "Processing captions…"
        : hasStoredCues
          ? "Reusing saved captions…"
          : "Fetching captions…",
    });

    let videoId: string;
    let watchUrl: string;
    let title: string;
    let language: string | undefined;
    let cues: ReturnType<typeof normalizeCues>;

    if (hasPrefetch) {
      videoId = extractYoutubeVideoId(options.urlOrId);
      watchUrl = youtubeWatchUrl(videoId);
      cues = normalizeCues(options.prefetched!.cues);
      title = options.prefetched!.title?.trim() || `YouTube ${videoId}`;
      language = options.prefetched!.language;
    } else if (hasStoredCues) {
      videoId =
        typeof options.existingMetadata?.videoId === "string"
          ? options.existingMetadata.videoId
          : extractYoutubeVideoId(options.urlOrId);
      watchUrl =
        typeof options.existingMetadata?.watchUrl === "string"
          ? options.existingMetadata.watchUrl
          : youtubeWatchUrl(videoId);
      cues = normalizeCues(existingCues as YoutubeCueInput[]);
      title = `YouTube ${videoId}`;
      language =
        typeof options.existingMetadata?.language === "string"
          ? options.existingMetadata.language
          : undefined;
    } else {
      const extracted = await extractYoutubeTranscript(options.urlOrId);
      videoId = extracted.videoId;
      watchUrl = extracted.watchUrl;
      cues = extracted.cues;
      title = extracted.title;
      language = extracted.language;
    }

    if (cues.length === 0) {
      throw new Error("YouTube transcript contained no usable text");
    }

    const { plainText, chunks } = chunkVttCues(cues, {
      videoId,
      url: watchUrl,
    });

    const durationSeconds = Math.max(...cues.map((cue) => cue.tEnd), 0);

    await db
      .update(sources)
      .set({
        originalUrl: watchUrl,
        ...(options.updateTitleFromVideo
          ? { title: title.slice(0, 200) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(sources.id, sourceId));

    await persistSourceChunks({
      sourceId,
      notebookId,
      ownerId,
      sourceType: "youtube",
      preparedChunks: chunks,
      readyMetadata: {
        ...(options.existingMetadata ?? {}),
        content: plainText,
        charCount: plainText.length,
        cueCount: cues.length,
        durationSeconds,
        videoId,
        watchUrl,
        language,
        cues,
      } satisfies YoutubeSourceMetadata & Record<string, unknown>,
    });
  } catch (error) {
    await clearSourceIndex(sourceId);
    const message = friendlyIngestError(
      error,
      "Failed to index YouTube source",
    );
    await setSourceStatus(sourceId, "failed", message);
    throw error;
  }
}
