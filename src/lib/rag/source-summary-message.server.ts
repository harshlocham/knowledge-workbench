import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { chunks } from "#/db/schema/chunks.ts";
import { messages, type MessageCitation } from "#/db/schema/messages.ts";
import { notebooks } from "#/db/schema/notebooks.ts";
import { sources } from "#/db/schema/sources.ts";
import {
	notebookDescriptionFromSummary,
	shouldAutoUpdateNotebookDescription,
} from "#/lib/notebook-title.ts";
import {
	generateBatchSourcesAddedSummary,
	generateSourceAddedSummary,
} from "#/lib/rag/llm.ts";
import { formatVttTimestamp } from "#/lib/rag/parse-vtt.server.ts";

const SUMMARY_CHUNK_LIMIT = 18;
const BATCH_CHUNKS_PER_SOURCE = 8;
const EXCERPT_CHAR_LIMIT = 1400;

/**
 * After a source indexes successfully, post an assistant chat message summarizing it
 * (NotebookLM-style source overview after indexing).
 * Multi-source imports (playlist / batch) skip this and finalize once via
 * `tryFinalizeImportBatchSummary`.
 */
export async function postSourceAddedSummaryMessage(options: {
	sourceId: string;
	notebookId: string;
	sourceType: string;
	chunkRows: Array<{
		id: string;
		content: string;
		locator: MessageCitation["locator"];
	}>;
}) {
	const { sourceId, notebookId, sourceType, chunkRows } = options;

	const [source] = await db
		.select({
			title: sources.title,
			metadata: sources.metadata,
		})
		.from(sources)
		.where(eq(sources.id, sourceId))
		.limit(1);

	if (!source) {
		return null;
	}

	const meta =
		source.metadata && typeof source.metadata === "object"
			? (source.metadata as Record<string, unknown>)
			: {};

	// Later imports: no auto-overview (only the notebook's first import batch).
	if (meta.suppressSourceSummary === true) {
		return null;
	}

	// Multi-source first import: wait until every source in the batch is ready.
	if (typeof meta.importBatchId === "string") {
		return null;
	}

	// Avoid duplicate summaries if indexing retries for the same ready source.
	if (typeof meta.summaryMessageId === "string") {
		return null;
	}

	if (await notebookAlreadyHasIntroSummary(notebookId)) {
		return null;
	}

	const sample = pickSummaryChunks(chunkRows, SUMMARY_CHUNK_LIMIT);
	if (sample.length === 0) {
		return null;
	}

	const { summary, citedIndexes } = await generateSourceAddedSummary({
		sourceTitle: source.title,
		sourceType,
		excerpts: sample.map((chunk) => ({
			text: chunk.content.slice(0, EXCERPT_CHAR_LIMIT),
			label: excerptLabel(chunk.locator),
		})),
	});

	const citations: MessageCitation[] = citedIndexes
		.map((index) => {
			const chunk = sample[index - 1];
			if (!chunk) return null;
			return {
				chunkId: chunk.id,
				sourceId,
				sourceTitle: source.title,
				quote: chunk.content.slice(0, 280),
				locator: chunk.locator ?? {},
				citationNumber: index,
			} satisfies MessageCitation;
		})
		.filter((item): item is MessageCitation => item != null);

	// Always include at least the first chunk so the summary is openable.
	if (citations.length === 0 && sample[0]) {
		citations.push({
			chunkId: sample[0].id,
			sourceId,
			sourceTitle: source.title,
			quote: sample[0].content.slice(0, 280),
			locator: sample[0].locator ?? {},
			citationNumber: 1,
		});
	}

	const [message] = await db
		.insert(messages)
		.values({
			notebookId,
			role: "assistant",
			content: summary,
			citations,
		})
		.returning({ id: messages.id });

	if (!message) {
		return null;
	}

	await db
		.update(sources)
		.set({
			metadata: {
				...meta,
				summaryMessageId: message.id,
			},
			updatedAt: new Date(),
		})
		.where(eq(sources.id, sourceId));

	await maybeUpdateNotebookDescription({
		notebookId,
		sourceTitle: source.title,
		sourceType,
		summary,
	});

	return message.id;
}

/** True if this notebook already posted its first-import overview. */
async function notebookAlreadyHasIntroSummary(notebookId: string) {
	const [row] = await db
		.select({ id: sources.id })
		.from(sources)
		.where(
			and(
				eq(sources.notebookId, notebookId),
				sql`(${sources.metadata}->>'summaryMessageId') IS NOT NULL`,
			),
		)
		.limit(1);
	return Boolean(row);
}

/**
 * When every source in an import batch is ready (or failed), post ONE summary.
 * Only used for the notebook's first import batch.
 */
export async function tryFinalizeImportBatchSummary(options: {
	notebookId: string;
	importBatchId: string;
}) {
	const { notebookId, importBatchId } = options;

	if (await notebookAlreadyHasIntroSummary(notebookId)) {
		return null;
	}

	const batchRows = await db
		.select({
			id: sources.id,
			title: sources.title,
			type: sources.type,
			status: sources.status,
			metadata: sources.metadata,
			createdAt: sources.createdAt,
		})
		.from(sources)
		.where(
			and(
				eq(sources.notebookId, notebookId),
				sql`(${sources.metadata}->>'importBatchId') = ${importBatchId}`,
			),
		)
		.orderBy(asc(sources.createdAt));

	if (batchRows.length === 0) {
		return null;
	}

	// Non-intro batches should never finalize a chat overview.
	const leaderProbe =
		batchRows[0]?.metadata && typeof batchRows[0].metadata === "object"
			? (batchRows[0].metadata as Record<string, unknown>)
			: {};
	if (leaderProbe.suppressSourceSummary === true) {
		return null;
	}

	const expectedSize = Number(
		(batchRows[0]?.metadata as Record<string, unknown> | null)?.importBatchSize,
	);
	const size =
		Number.isFinite(expectedSize) && expectedSize > 0
			? expectedSize
			: batchRows.length;

	if (batchRows.length < size) {
		return null;
	}

	if (
		batchRows.some((row) => row.status !== "ready" && row.status !== "failed")
	) {
		return null;
	}

	if (
		batchRows.some((row) => {
			const meta =
				row.metadata && typeof row.metadata === "object"
					? (row.metadata as Record<string, unknown>)
					: {};
			return typeof meta.summaryMessageId === "string";
		})
	) {
		return null;
	}

	const leader = batchRows[0]!;
	const leaderMeta =
		leader.metadata && typeof leader.metadata === "object"
			? { ...(leader.metadata as Record<string, unknown>) }
			: {};

	// Claim so only one concurrent indexer posts the batch summary.
	const [claimed] = await db
		.update(sources)
		.set({
			metadata: {
				...leaderMeta,
				batchSummaryClaimed: true,
			},
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(sources.id, leader.id),
				sql`(${sources.metadata}->>'batchSummaryClaimed') IS DISTINCT FROM 'true'`,
			),
		)
		.returning({ id: sources.id });

	if (!claimed) {
		return null;
	}

	const readyRows = batchRows.filter((row) => row.status === "ready");
	if (readyRows.length === 0) {
		return null;
	}

	const batchTitle =
		(typeof leaderMeta.importBatchTitle === "string" &&
			leaderMeta.importBatchTitle.trim()) ||
		(typeof leaderMeta.playlistTitle === "string" &&
			leaderMeta.playlistTitle.trim()) ||
		`${readyRows.length} sources`;

	type FlatExcerpt = {
		globalIndex: number;
		chunkId: string;
		sourceId: string;
		sourceTitle: string;
		content: string;
		locator: MessageCitation["locator"];
	};

	const flat: FlatExcerpt[] = [];
	const perSource: Array<{
		title: string;
		sourceType: string;
		excerpts: Array<{ text: string; label?: string }>;
	}> = [];

	let globalIndex = 1;
	for (const row of readyRows) {
		const chunkRows = await db
			.select({
				id: chunks.id,
				content: chunks.content,
				locator: chunks.locator,
			})
			.from(chunks)
			.where(eq(chunks.sourceId, row.id))
			.orderBy(asc(chunks.chunkIndex));

		const sample = pickSummaryChunks(chunkRows, BATCH_CHUNKS_PER_SOURCE);
		const excerpts: Array<{ text: string; label?: string }> = [];
		for (const chunk of sample) {
			excerpts.push({
				text: chunk.content.slice(0, EXCERPT_CHAR_LIMIT),
				label: excerptLabel(chunk.locator),
			});
			flat.push({
				globalIndex,
				chunkId: chunk.id,
				sourceId: row.id,
				sourceTitle: row.title,
				content: chunk.content,
				locator: chunk.locator,
			});
			globalIndex += 1;
		}
		if (excerpts.length > 0) {
			perSource.push({
				title: row.title,
				sourceType: row.type,
				excerpts,
			});
		}
	}

	if (perSource.length === 0) {
		return null;
	}

	const { summary, citedIndexes } = await generateBatchSourcesAddedSummary({
		batchTitle,
		sources: perSource,
	});

	const citations: MessageCitation[] = citedIndexes
		.map((index) => {
			const excerpt = flat.find((item) => item.globalIndex === index);
			if (!excerpt) return null;
			return {
				chunkId: excerpt.chunkId,
				sourceId: excerpt.sourceId,
				sourceTitle: excerpt.sourceTitle,
				quote: excerpt.content.slice(0, 280),
				locator: excerpt.locator ?? {},
				citationNumber: index,
			} satisfies MessageCitation;
		})
		.filter((item): item is MessageCitation => item != null);

	if (citations.length === 0 && flat[0]) {
		citations.push({
			chunkId: flat[0].chunkId,
			sourceId: flat[0].sourceId,
			sourceTitle: flat[0].sourceTitle,
			quote: flat[0].content.slice(0, 280),
			locator: flat[0].locator ?? {},
			citationNumber: 1,
		});
	}

	const [message] = await db
		.insert(messages)
		.values({
			notebookId,
			role: "assistant",
			content: summary,
			citations,
		})
		.returning({ id: messages.id });

	if (!message) {
		return null;
	}

	for (const row of batchRows) {
		const meta =
			row.metadata && typeof row.metadata === "object"
				? { ...(row.metadata as Record<string, unknown>) }
				: {};
		await db
			.update(sources)
			.set({
				metadata: {
					...meta,
					batchSummaryClaimed: true,
					summaryMessageId: message.id,
				},
				updatedAt: new Date(),
			})
			.where(eq(sources.id, row.id));
	}

	await maybeUpdateNotebookDescription({
		notebookId,
		sourceTitle: batchTitle,
		sourceType: "batch",
		summary,
	});

	return message.id;
}

/** Set a topic blurb on the notebook card — never a copy of the title. */
async function maybeUpdateNotebookDescription(options: {
	notebookId: string;
	sourceTitle: string;
	sourceType: string;
	summary: string;
}) {
	const { notebookId, sourceTitle, sourceType, summary } = options;

	const [notebook] = await db
		.select({
			title: notebooks.title,
			description: notebooks.description,
		})
		.from(notebooks)
		.where(eq(notebooks.id, notebookId))
		.limit(1);

	if (!notebook) return;

	if (
		!shouldAutoUpdateNotebookDescription(notebook.description, notebook.title)
	) {
		return;
	}

	const next = notebookDescriptionFromSummary(summary, sourceTitle, sourceType);
	if (!next || next === notebook.title.trim()) return;
	if (next === (notebook.description ?? "").trim()) return;

	await db
		.update(notebooks)
		.set({
			description: next,
			updatedAt: new Date(),
		})
		.where(eq(notebooks.id, notebookId));
}

function excerptLabel(locator: MessageCitation["locator"]): string | undefined {
	if (!locator || typeof locator.tStart !== "number") {
		return undefined;
	}

	const start = formatShortClock(locator.tStart);
	if (typeof locator.tEnd === "number" && locator.tEnd > locator.tStart) {
		return `${start}–${formatShortClock(locator.tEnd)}`;
	}
	return start;
}

/** Compact clock for prompt labels (drop millis). */
function formatShortClock(totalSeconds: number): string {
	const full = formatVttTimestamp(totalSeconds);
	return full.replace(/\.\d+$/, "");
}

/**
 * Prefer opening + closing context, with evenly spaced samples through the middle.
 * Long YouTube videos need more than a thin title-driven skim.
 */
function pickSummaryChunks<T extends { content: string }>(
	rows: T[],
	max: number,
): T[] {
	if (rows.length <= max) return rows;

	const indexes = new Set<number>();
	indexes.add(0);
	if (rows.length > 1) indexes.add(1);
	if (rows.length > 2) indexes.add(rows.length - 1);

	const remaining = max - indexes.size;
	if (remaining > 0 && rows.length > 3) {
		for (let i = 0; i < remaining; i++) {
			const t = (i + 1) / (remaining + 1);
			const index = Math.round(2 + t * (rows.length - 4));
			indexes.add(Math.min(Math.max(index, 2), rows.length - 2));
		}
	}

	// If collisions left us short, fill evenly.
	if (indexes.size < max) {
		const step = (rows.length - 1) / (max - 1);
		for (let i = 0; i < max && indexes.size < max; i++) {
			indexes.add(Math.round(i * step));
		}
	}

	return [...indexes]
		.sort((a, b) => a - b)
		.slice(0, max)
		.map((index) => rows[index]!);
}

/** Best-effort wrapper — never fail indexing because of summary generation. */
export async function tryPostSourceAddedSummaryMessage(
	options: Parameters<typeof postSourceAddedSummaryMessage>[0],
) {
	try {
		return await postSourceAddedSummaryMessage(options);
	} catch (error) {
		console.error("[source-summary]", options.sourceId, error);
		return null;
	}
}

export async function tryFinalizeImportBatchSummarySafe(
	options: Parameters<typeof tryFinalizeImportBatchSummary>[0],
) {
	try {
		return await tryFinalizeImportBatchSummary(options);
	} catch (error) {
		console.error("[batch-summary]", options.importBatchId, error);
		return null;
	}
}
