/** Shared ingest limits — keep validators and UI copy in sync. */

export const INGEST_LIMITS = {
	maxSourcesPerNotebook: 50,
	maxCreatesPerWindow: 20,
	createWindowMs: 10 * 60 * 1000,
	maxTextChars: 200_000,
	maxPdfBytes: 30 * 1024 * 1024,
	maxVttBytes: 10 * 1024 * 1024,
	maxUrlLength: 2000,
	maxTitleLength: 200,
	maxFileNameLength: 260,
} as const;

export function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function friendlyIngestError(error: unknown, fallback: string) {
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "";

	if (!message) return fallback;

	const lower = message.toLowerCase();

	if (lower.includes("too many")) {
		return message;
	}
	if (
		lower.includes("smaller") ||
		lower.includes("mb") ||
		lower.includes("too large")
	) {
		return message;
	}
	if (lower.includes("youtube") && lower.includes("rate-limited")) {
		return message;
	}
	if (lower.includes("blocked caption") || lower.includes("youtube_proxy")) {
		return message;
	}
	if (lower.includes("rate limit") || lower.includes("429")) {
		return "OpenAI rate limit hit while indexing. Wait a moment and re-index.";
	}
	if (lower.includes("insufficient_quota") || lower.includes("quota")) {
		return "OpenAI quota exceeded. Check your API billing, then re-index.";
	}
	if (lower.includes("openai") && lower.includes("api key")) {
		return "OpenAI API key is missing or invalid. Check OPENAI_API_KEY.";
	}
	if (lower.includes("qdrant")) {
		return "Vector store unavailable. Check QDRANT_URL / API key, then re-index.";
	}
	if (lower.includes("captions") || lower.includes("transcript")) {
		return message;
	}
	if (lower.includes("enoent") || lower.includes("not available")) {
		return "Source file is missing from storage. Re-upload the file.";
	}

	return message.length > 220 ? `${message.slice(0, 220)}…` : message;
}
