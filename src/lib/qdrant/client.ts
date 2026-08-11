import { QdrantClient } from "@qdrant/js-client-rest";

let client: QdrantClient | null = null;

/**
 * qdrant-js defaults `port` to 6333 when the URL has no explicit port.
 * That breaks Qdrant Cloud HTTPS (should use 443), causing upserts to hang.
 * See: URL host-only → SDK builds `https://host:6333/...`
 */
export function resolveQdrantClientOptions() {
	const url = process.env.QDRANT_URL;
	if (!url) {
		throw new Error("QDRANT_URL is not configured");
	}

	const apiKey = process.env.QDRANT_API_KEY || undefined;
	const parsed = new URL(url);
	const hasExplicitPort = parsed.port.length > 0;

	if (hasExplicitPort) {
		return { url, apiKey, checkCompatibility: false as const };
	}

	// HTTPS Cloud / reverse-proxy: omit :6333 so requests go to 443.
	if (parsed.protocol === "https:") {
		return {
			url,
			apiKey,
			port: 443,
			checkCompatibility: false as const,
		};
	}

	// Local HTTP without a port still expects 6333.
	return { url, apiKey, checkCompatibility: false as const };
}

export function getQdrantClient() {
	if (!client) {
		client = new QdrantClient(resolveQdrantClientOptions());
	}

	return client;
}

/** Test helper — drop the cached client after config changes. */
export function resetQdrantClient() {
	client = null;
}

export const KNOWLEDGE_CHUNKS_COLLECTION =
	process.env.QDRANT_COLLECTION ?? "knowledge_chunks";
