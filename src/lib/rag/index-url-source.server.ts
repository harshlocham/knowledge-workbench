import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { sources } from "#/db/schema/sources.ts";
import { chunkArticleText } from "#/lib/rag/chunk-article.ts";
import {
  extractUrlArticle,
  normalizeUrl,
} from "#/lib/rag/extract-url.server.ts";
import { friendlyIngestError } from "#/lib/ingest/limits.ts";
import {
  clearSourceIndex,
  persistSourceChunks,
  setSourceIndexProgress,
  setSourceStatus,
} from "#/lib/rag/index-source.server.ts";

export type UrlSourceMetadata = {
  content: string;
  charCount: number;
  canonicalUrl: string;
  excerpt?: string | null;
  siteName?: string | null;
  headings?: string[];
};

/**
 * URL-specific steps: fetch + Readability extract.
 * Then reuses the shared persist pipeline (chunk already prepared → embed → DB → Qdrant).
 */
export async function indexUrlSource(options: {
  sourceId: string;
  notebookId: string;
  ownerId: string;
  url: string;
  updateTitleFromPage?: boolean;
}) {
  const { sourceId, notebookId, ownerId } = options;
  const url = normalizeUrl(options.url);

  await setSourceStatus(sourceId, "indexing");
  await clearSourceIndex(sourceId);

  try {
    await setSourceIndexProgress(sourceId, {
      phase: "extracting",
      percent: 15,
      message: "Fetching page…",
    });

    const article = await extractUrlArticle(url);
    const preparedChunks = chunkArticleText(article.content, {
      url: article.canonicalUrl,
    });

    if (options.updateTitleFromPage && article.title) {
      await db
        .update(sources)
        .set({
          title: article.title.slice(0, 200),
          originalUrl: article.canonicalUrl,
          updatedAt: new Date(),
        })
        .where(eq(sources.id, sourceId));
    } else {
      await db
        .update(sources)
        .set({
          originalUrl: article.canonicalUrl,
          updatedAt: new Date(),
        })
        .where(eq(sources.id, sourceId));
    }

    await persistSourceChunks({
      sourceId,
      notebookId,
      ownerId,
      sourceType: "url",
      preparedChunks,
      readyMetadata: {
        content: article.content,
        charCount: article.content.length,
        canonicalUrl: article.canonicalUrl,
        excerpt: article.excerpt,
        siteName: article.siteName,
        headings: article.headings,
      } satisfies UrlSourceMetadata,
    });
  } catch (error) {
    await clearSourceIndex(sourceId);
    const message = friendlyIngestError(error, "Failed to index URL source");
    await setSourceStatus(sourceId, "failed", message);
    throw error;
  }
}
