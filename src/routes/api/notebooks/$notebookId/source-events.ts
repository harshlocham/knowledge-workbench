import { createFileRoute } from "@tanstack/react-router";
import { asc, desc, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { messages } from "#/db/schema/messages.ts";
import { sources } from "#/db/schema/sources.ts";
import type { ChatMessageDTO } from "#/features/chat/chat.types.ts";
import type { SourceDTO } from "#/features/sources/sources.functions.ts";
import { requireOwnedNotebook } from "#/features/sources/notebook-access.server.ts";
import type { IndexProgress } from "#/lib/rag/index-source.server.ts";

/** How long to keep SSE open after indexing so a delayed batch overview can land. */
const OVERVIEW_GRACE_MS = 90_000;

function readMetaNumber(metadata: unknown, key: string): number | null {
	if (!metadata || typeof metadata !== "object") return null;
	const value = (metadata as Record<string, unknown>)[key];
	return typeof value === "number" ? value : null;
}

function readIndexProgress(metadata: unknown): IndexProgress | null {
	if (!metadata || typeof metadata !== "object") return null;
	const value = (metadata as Record<string, unknown>).indexProgress;
	if (!value || typeof value !== "object") return null;
	const progress = value as Partial<IndexProgress>;
	if (
		typeof progress.phase !== "string" ||
		typeof progress.percent !== "number" ||
		typeof progress.message !== "string"
	) {
		return null;
	}
	return {
		phase: progress.phase as IndexProgress["phase"],
		percent: progress.percent,
		message: progress.message,
	};
}

function toSourceDTO(row: typeof sources.$inferSelect): SourceDTO {
	return {
		id: row.id,
		notebookId: row.notebookId,
		type: row.type,
		title: row.title,
		status: row.status,
		errorMessage: row.errorMessage,
		originalUrl: row.originalUrl,
		charCount: readMetaNumber(row.metadata, "charCount"),
		chunkCount: readMetaNumber(row.metadata, "chunkCount"),
		pageCount: readMetaNumber(row.metadata, "pageCount"),
		indexProgress: readIndexProgress(row.metadata),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function toMessageDTO(row: typeof messages.$inferSelect): ChatMessageDTO {
	return {
		id: row.id,
		notebookId: row.notebookId,
		role: row.role,
		content: row.content,
		citations: row.citations ?? [],
		createdAt: row.createdAt.toISOString(),
	};
}

/** Playlist/batch overview is written after the last source flips to ready. */
function isAwaitingBatchOverview(row: typeof sources.$inferSelect): boolean {
	if (row.status !== "ready" && row.status !== "failed") return false;
	const meta =
		row.metadata && typeof row.metadata === "object"
			? (row.metadata as Record<string, unknown>)
			: {};
	if (meta.suppressSourceSummary === true) return false;
	if (typeof meta.importBatchId !== "string") return false;
	if (typeof meta.summaryMessageId === "string") return false;
	return true;
}

export const Route = createFileRoute(
	"/api/notebooks/$notebookId/source-events",
)({
	server: {
		handlers: {
			GET: async ({ params, request }) => {
				try {
					await requireOwnedNotebook(params.notebookId);
				} catch {
					return new Response("Unauthorized", { status: 401 });
				}

				const encoder = new TextEncoder();
				let closed = false;
				let timer: ReturnType<typeof setTimeout> | undefined;
				let settledAt: number | null = null;

				const stream = new ReadableStream({
					start(controller) {
						const send = (payload: unknown) => {
							if (closed) return;
							controller.enqueue(
								encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
							);
						};

						const tick = async () => {
							if (closed) return;

							try {
								const [sourceRows, messageRows] = await Promise.all([
									db
										.select()
										.from(sources)
										.where(eq(sources.notebookId, params.notebookId))
										.orderBy(desc(sources.createdAt)),
									db
										.select()
										.from(messages)
										.where(eq(messages.notebookId, params.notebookId))
										.orderBy(asc(messages.createdAt)),
								]);

								const items = sourceRows.map(toSourceDTO);
								const chat = messageRows.map(toMessageDTO);
								const pending = items.some(
									(item) =>
										item.status === "uploading" || item.status === "indexing",
								);
								const awaitingOverview = sourceRows.some(
									isAwaitingBatchOverview,
								);

								if (pending) {
									settledAt = null;
								} else if (settledAt == null) {
									settledAt = Date.now();
								}

								send({
									type: "sources",
									sources: items,
									pending,
									at: new Date().toISOString(),
								});
								send({
									type: "messages",
									messages: chat,
									at: new Date().toISOString(),
								});

								const graceExpired =
									settledAt != null &&
									Date.now() - settledAt >= OVERVIEW_GRACE_MS;

								if (!pending && (!awaitingOverview || graceExpired)) {
									send({ type: "done" });
									closed = true;
									controller.close();
									return;
								}
							} catch (error) {
								send({
									type: "error",
									message:
										error instanceof Error
											? error.message
											: "Failed to stream source updates",
								});
								closed = true;
								controller.close();
								return;
							}

							timer = setTimeout(() => {
								void tick();
							}, 1000);
						};

						void tick();

						request.signal.addEventListener("abort", () => {
							closed = true;
							if (timer) clearTimeout(timer);
							try {
								controller.close();
							} catch {
								// already closed
							}
						});
					},
					cancel() {
						closed = true;
						if (timer) clearTimeout(timer);
					},
				});

				return new Response(stream, {
					headers: {
						"Content-Type": "text/event-stream; charset=utf-8",
						"Cache-Control": "no-cache, no-transform",
						Connection: "keep-alive",
					},
				});
			},
		},
	},
});
