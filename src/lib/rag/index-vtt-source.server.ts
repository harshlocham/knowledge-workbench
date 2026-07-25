import { chunkVttCues } from "#/lib/rag/chunk-vtt.ts";
import { parseWebVtt } from "#/lib/rag/parse-vtt.server.ts";
import {
  clearSourceIndex,
  persistSourceChunks,
  setSourceStatus,
} from "#/lib/rag/index-source.server.ts";
import { readSourceFile } from "#/lib/storage/files.server.ts";

export type VttSourceMetadata = {
  content: string;
  charCount: number;
  cueCount: number;
  durationSeconds: number;
  originalFileName?: string;
  mimeType?: string;
  cues: Array<{
    cueIndex: number;
    tStart: number;
    tEnd: number;
    text: string;
  }>;
};

/**
 * VTT-specific steps: read file → parse cues → timed chunks.
 * Then reuses the shared persist pipeline.
 */
export async function indexVttSource(options: {
  sourceId: string;
  notebookId: string;
  ownerId: string;
  storageUri: string;
  existingMetadata?: Record<string, unknown> | null;
}) {
  const { sourceId, notebookId, ownerId, storageUri } = options;

  await setSourceStatus(sourceId, "indexing");
  await clearSourceIndex(sourceId);

  try {
    const fileBuffer = await readSourceFile(storageUri);
    const raw = fileBuffer.toString("utf8");
    const parsed = parseWebVtt(raw);
    const { plainText, chunks } = chunkVttCues(parsed.cues);

    await persistSourceChunks({
      sourceId,
      notebookId,
      ownerId,
      sourceType: "vtt",
      preparedChunks: chunks,
      readyMetadata: {
        ...(options.existingMetadata ?? {}),
        content: plainText,
        charCount: plainText.length,
        cueCount: parsed.cueCount,
        durationSeconds: parsed.durationSeconds,
        cues: parsed.cues,
      } satisfies VttSourceMetadata & Record<string, unknown>,
    });
  } catch (error) {
    await clearSourceIndex(sourceId);
    const message =
      error instanceof Error ? error.message : "Failed to index VTT source";
    await setSourceStatus(sourceId, "failed", message);
    throw error;
  }
}
