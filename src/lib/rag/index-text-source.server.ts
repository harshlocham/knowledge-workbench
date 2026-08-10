import { chunkPlainText } from "#/lib/rag/chunk.ts";
import {
	indexSourceChunks,
	setSourceStatus,
} from "#/lib/rag/index-source.server.ts";

export type TextSourceMetadata = {
	content: string;
	charCount: number;
};

function getTextContent(metadata: unknown): string | null {
	if (!metadata || typeof metadata !== "object") {
		return null;
	}

	const content = (metadata as { content?: unknown }).content;
	return typeof content === "string" ? content : null;
}

export { clearSourceIndex } from "#/lib/rag/index-source.server.ts";

export async function indexTextSource(options: {
	sourceId: string;
	notebookId: string;
	ownerId: string;
	content: string;
}) {
	const preparedChunks = chunkPlainText(options.content);

	await indexSourceChunks({
		sourceId: options.sourceId,
		notebookId: options.notebookId,
		ownerId: options.ownerId,
		sourceType: "text",
		preparedChunks,
		readyMetadata: {
			content: options.content,
			charCount: options.content.length,
		} satisfies TextSourceMetadata,
	});
}

export async function reindexTextSource(options: {
	sourceId: string;
	notebookId: string;
	ownerId: string;
	metadata: unknown;
}) {
	const content = getTextContent(options.metadata);
	if (!content?.trim()) {
		await setSourceStatus(
			options.sourceId,
			"failed",
			"Missing text content for re-index",
		);
		throw new Error("Missing text content for re-index");
	}

	await indexTextSource({
		sourceId: options.sourceId,
		notebookId: options.notebookId,
		ownerId: options.ownerId,
		content,
	});
}
