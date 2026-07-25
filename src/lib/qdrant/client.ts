import { QdrantClient } from "@qdrant/js-client-rest";

let client: QdrantClient | null = null;

export function getQdrantClient() {
  const url = process.env.QDRANT_URL;
  if (!url) {
    throw new Error("QDRANT_URL is not configured");
  }

  if (!client) {
    client = new QdrantClient({
      url,
      apiKey: process.env.QDRANT_API_KEY || undefined,
    });
  }

  return client;
}

export const KNOWLEDGE_CHUNKS_COLLECTION =
  process.env.QDRANT_COLLECTION ?? "knowledge_chunks";
