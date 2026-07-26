import type { ChunkLocator } from "#/db/schema/chunks.ts";

import { ensureKnowledgeChunksCollection } from "./collections.ts";
import { getQdrantClient, KNOWLEDGE_CHUNKS_COLLECTION } from "./client.ts";

export type ChunkPointPayload = {
  notebookId: string;
  sourceId: string;
  chunkId: string;
  ownerId: string;
  sourceType: string;
  chunkIndex: number;
  text: string;
  locator: ChunkLocator;
};

export async function upsertChunkPoints(
  points: Array<{
    id: string;
    vector: number[];
    payload: ChunkPointPayload;
  }>,
) {
  if (points.length === 0) {
    return;
  }

  await ensureKnowledgeChunksCollection();
  const qdrant = getQdrantClient();

  await qdrant.upsert(KNOWLEDGE_CHUNKS_COLLECTION, {
    wait: true,
    points: points.map((point) => ({
      id: point.id,
      vector: point.vector,
      payload: point.payload,
    })),
  });
}

export async function deletePointsBySourceId(sourceId: string) {
  await ensureKnowledgeChunksCollection();
  const qdrant = getQdrantClient();

  await qdrant.delete(KNOWLEDGE_CHUNKS_COLLECTION, {
    wait: true,
    filter: {
      must: [{ key: "sourceId", match: { value: sourceId } }],
    },
  });
}

export async function deletePointsByNotebookId(notebookId: string) {
  await ensureKnowledgeChunksCollection();
  const qdrant = getQdrantClient();

  await qdrant.delete(KNOWLEDGE_CHUNKS_COLLECTION, {
    wait: true,
    filter: {
      must: [{ key: "notebookId", match: { value: notebookId } }],
    },
  });
}

export async function searchNotebookChunks(options: {
  notebookId: string;
  ownerId: string;
  vector: number[];
  limit?: number;
}) {
  await ensureKnowledgeChunksCollection();
  const qdrant = getQdrantClient();

  const results = await qdrant.search(KNOWLEDGE_CHUNKS_COLLECTION, {
    vector: options.vector,
    limit: options.limit ?? 6,
    with_payload: true,
    filter: {
      must: [
        { key: "notebookId", match: { value: options.notebookId } },
        { key: "ownerId", match: { value: options.ownerId } },
      ],
    },
  });

  return results.map((point) => {
    const payload = (point.payload ?? {}) as Partial<ChunkPointPayload>;
    return {
      score: point.score,
      chunkId: String(payload.chunkId ?? ""),
      sourceId: String(payload.sourceId ?? ""),
      sourceType: String(payload.sourceType ?? "text"),
      chunkIndex: Number(payload.chunkIndex ?? 0),
      text: String(payload.text ?? ""),
      locator: (payload.locator ?? {}) as ChunkPointPayload["locator"],
    };
  });
}
