import { chunkPages } from "#/lib/rag/chunk-pages.ts";
import { extractPdfPages } from "#/lib/rag/extract-pdf.server.ts";
import { friendlyIngestError } from "#/lib/ingest/limits.ts";
import {
  clearSourceIndex,
  persistSourceChunks,
  setSourceIndexProgress,
  setSourceStatus,
} from "#/lib/rag/index-source.server.ts";
import { readSourceFile } from "#/lib/storage/files.server.ts";

export type PdfSourceMetadata = {
  pageCount: number;
  charCount: number;
  originalFileName?: string;
  mimeType?: string;
};

/**
 * PDF-specific steps: read file → extract pages → per-page chunk.
 * Then reuses the shared persist pipeline (embed / Postgres / Qdrant).
 */
export async function indexPdfSource(options: {
  sourceId: string;
  notebookId: string;
  ownerId: string;
  storageUri: string;
  existingMetadata?: Record<string, unknown> | null;
}) {
  const { sourceId, notebookId, ownerId, storageUri } = options;

  await setSourceStatus(sourceId, "indexing");
  // Clear first so re-index never leaves stale vectors if extraction fails
  await clearSourceIndex(sourceId);

  try {
    await setSourceIndexProgress(sourceId, {
      phase: "extracting",
      percent: 15,
      message: "Extracting PDF text…",
    });

    const fileBuffer = await readSourceFile(storageUri);
    const { pages, pageCount } = await extractPdfPages(
      new Uint8Array(fileBuffer),
    );

    if (pages.length === 0) {
      throw new Error("No extractable text found in PDF");
    }

    await setSourceIndexProgress(sourceId, {
      phase: "extracting",
      percent: 28,
      message: `Chunking ${pageCount} pages…`,
    });

    const preparedChunks = chunkPages(pages);
    const charCount = pages.reduce((sum, page) => sum + page.text.length, 0);

    await persistSourceChunks({
      sourceId,
      notebookId,
      ownerId,
      sourceType: "pdf",
      preparedChunks,
      readyMetadata: {
        ...(options.existingMetadata ?? {}),
        pageCount,
        charCount,
      } satisfies PdfSourceMetadata & Record<string, unknown>,
    });
  } catch (error) {
    await clearSourceIndex(sourceId);
    const message = friendlyIngestError(error, "Failed to index PDF source");
    await setSourceStatus(sourceId, "failed", message);
    throw error;
  }
}
