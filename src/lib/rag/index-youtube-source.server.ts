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

/**
 * YouTube-specific steps: fetch captions → timed chunks with videoId.
 * Then reuses the shared persist pipeline.
 */
export async function indexYoutubeSource(options: {
  sourceId: string;
  notebookId: string;
  ownerId: string;
  urlOrId: string;
  updateTitleFromVideo?: boolean;
  existingMetadata?: Record<string, unknown> | null;
}) {
  const { sourceId, notebookId, ownerId } = options;

  await setSourceStatus(sourceId, "indexing");
  await clearSourceIndex(sourceId);

  try {
    await setSourceIndexProgress(sourceId, {
      phase: "extracting",
      percent: 15,
      message: "Fetching captions…",
    });

    const extracted = await extractYoutubeTranscript(options.urlOrId);
    const { plainText, chunks } = chunkVttCues(extracted.cues, {
      videoId: extracted.videoId,
      url: extracted.watchUrl,
    });

    const durationSeconds = Math.max(
      ...extracted.cues.map((cue) => cue.tEnd),
      0,
    );

    await db
      .update(sources)
      .set({
        originalUrl: extracted.watchUrl,
        ...(options.updateTitleFromVideo
          ? { title: extracted.title.slice(0, 200) }
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
        cueCount: extracted.cues.length,
        durationSeconds,
        videoId: extracted.videoId,
        watchUrl: extracted.watchUrl,
        language: extracted.language,
        cues: extracted.cues,
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
