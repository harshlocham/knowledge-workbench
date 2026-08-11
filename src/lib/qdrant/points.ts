import { inArray } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { chunks, type ChunkLocator } from "#/db/schema/chunks.ts";

import { ensureKnowledgeChunksCollection } from "./collections.ts";
import { getQdrantClient, KNOWLEDGE_CHUNKS_COLLECTION } from "./client.ts";

/** Stored in Qdrant — keep small. Full text lives in Postgres `chunks`. */
export type ChunkPointPayload = {
	notebookId: string;
	sourceId: string;
	chunkId: string;
	ownerId: string;
	sourceType: string;
	chunkIndex: number;
	locator: ChunkLocator;
};

/** ~10 pts ≈ 150KB JSON — small enough for progress ticks on slow Cloud uplinks. */
const UPSERT_BATCH_SIZE = 10;

/** Shrink JSON body (~2×) without meaningful retrieval loss for OpenAI embeddings. */
function compactVector(vector: number[]): number[] {
	return vector.map((value) => Math.round(value * 1e6) / 1e6);
}

export async function upsertChunkPoints(
	points: Array<{
		id: string;
		vector: number[];
		payload: ChunkPointPayload & { text?: string };
	}>,
	options?: {
		onBatchProgress?: (uploaded: number, total: number) => void | Promise<void>;
	},
) {
	if (points.length === 0) {
		return;
	}

	const qdrant = getQdrantClient();

	// Text stays in Postgres; round floats so Cloud JSON uploads are smaller.
	const slimPoints = points.map((point) => {
		const { text: _text, ...payload } = point.payload;
		return {
			id: point.id,
			vector: compactVector(point.vector),
			payload,
		};
	});

	await ensureKnowledgeChunksCollection();

	// wait:false — Cloud segment commit is fast; wall time is the HTTP upload.
	for (
		let offset = 0;
		offset < slimPoints.length;
		offset += UPSERT_BATCH_SIZE
	) {
		const batch = slimPoints.slice(offset, offset + UPSERT_BATCH_SIZE);
		await qdrant.upsert(KNOWLEDGE_CHUNKS_COLLECTION, {
			wait: false,
			points: batch,
		});
		const uploaded = Math.min(offset + batch.length, slimPoints.length);
		await options?.onBatchProgress?.(uploaded, slimPoints.length);
	}
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

	const ranked = results.map((point) => {
		const payload = (point.payload ?? {}) as Partial<ChunkPointPayload>;
		return {
			score: point.score,
			chunkId: String(payload.chunkId ?? ""),
			sourceId: String(payload.sourceId ?? ""),
			sourceType: String(payload.sourceType ?? "text"),
			chunkIndex: Number(payload.chunkIndex ?? 0),
			locator: (payload.locator ?? {}) as ChunkPointPayload["locator"],
		};
	});

	const chunkIds = ranked.map((hit) => hit.chunkId).filter(Boolean);
	if (chunkIds.length === 0) {
		return [];
	}

	const rows = await db
		.select({
			id: chunks.id,
			content: chunks.content,
			locator: chunks.locator,
			sourceId: chunks.sourceId,
			chunkIndex: chunks.chunkIndex,
		})
		.from(chunks)
		.where(inArray(chunks.id, chunkIds));

	const byId = new Map(rows.map((row) => [row.id, row]));

	return ranked
		.map((hit) => {
			const row = byId.get(hit.chunkId);
			if (!row) return null;
			return {
				score: hit.score,
				chunkId: hit.chunkId,
				sourceId: row.sourceId || hit.sourceId,
				sourceType: hit.sourceType,
				chunkIndex: row.chunkIndex ?? hit.chunkIndex,
				text: row.content,
				locator: (row.locator ?? hit.locator ?? {}) as ChunkLocator,
			};
		})
		.filter((hit): hit is NonNullable<typeof hit> => hit != null);
}
