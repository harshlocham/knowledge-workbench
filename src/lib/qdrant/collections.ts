import { EMBEDDING_DIMENSIONS } from "#/lib/rag/embed.ts";

import { getQdrantClient, KNOWLEDGE_CHUNKS_COLLECTION } from "./client.ts";

let ensured = false;

export async function ensureKnowledgeChunksCollection() {
	if (ensured) {
		return;
	}

	const qdrant = getQdrantClient();
	const collections = await qdrant.getCollections();
	const exists = collections.collections.some(
		(collection) => collection.name === KNOWLEDGE_CHUNKS_COLLECTION,
	);

	if (!exists) {
		await qdrant.createCollection(KNOWLEDGE_CHUNKS_COLLECTION, {
			vectors: {
				size: EMBEDDING_DIMENSIONS,
				distance: "Cosine",
			},
		});

		await qdrant.createPayloadIndex(KNOWLEDGE_CHUNKS_COLLECTION, {
			field_name: "notebookId",
			field_schema: "keyword",
		});

		await qdrant.createPayloadIndex(KNOWLEDGE_CHUNKS_COLLECTION, {
			field_name: "sourceId",
			field_schema: "keyword",
		});

		await qdrant.createPayloadIndex(KNOWLEDGE_CHUNKS_COLLECTION, {
			field_name: "ownerId",
			field_schema: "keyword",
		});
	}

	ensured = true;
}
