import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { sources } from "#/db/schema/sources.ts";
import {
	requireOwnedNotebook,
	requireOwnedSource,
} from "#/features/sources/notebook-access.server.ts";
import { enqueueBackgroundJob } from "#/lib/ingest/jobs.server.ts";
import {
	formatBytes,
	friendlyIngestError,
	INGEST_LIMITS,
} from "#/lib/ingest/limits.ts";
import {
	assertCreateRateLimit,
	assertNotebookSourceCapacityForUser,
} from "#/lib/ingest/rate-limit.server.ts";
import { normalizeUrl } from "#/lib/rag/extract-url.server.ts";
import {
	assertYoutubeProxyConfiguredForProduction,
	extractYoutubeVideoId,
	youtubeWatchUrl,
} from "#/lib/rag/extract-youtube.server.ts";
import { extractYoutubePlaylist } from "#/lib/rag/extract-youtube-playlist.server.ts";
import { indexPdfSource } from "#/lib/rag/index-pdf-source.server.ts";
import {
	clearSourceIndex,
	type IndexProgress,
	setSourceStatus,
} from "#/lib/rag/index-source.server.ts";
import {
	indexTextSource,
	reindexTextSource,
	type TextSourceMetadata,
} from "#/lib/rag/index-text-source.server.ts";
import { indexUrlSource } from "#/lib/rag/index-url-source.server.ts";
import { indexVttSource } from "#/lib/rag/index-vtt-source.server.ts";
import { indexYoutubeSource } from "#/lib/rag/index-youtube-source.server.ts";
import { isYoutubePlaylistUrl } from "#/lib/rag/youtube-url.ts";
import {
	deleteSourceFile,
	pdfStorageKey,
	readSourceFile,
	saveSourceFile,
	vttStorageKey,
} from "#/lib/storage/files.server.ts";

export type SourceDTO = {
	id: string;
	notebookId: string;
	type: "pdf" | "text" | "url" | "youtube" | "vtt";
	title: string;
	status: "uploading" | "indexing" | "ready" | "failed";
	errorMessage: string | null;
	originalUrl: string | null;
	charCount: number | null;
	chunkCount: number | null;
	pageCount: number | null;
	indexProgress: IndexProgress | null;
	createdAt: string;
	updatedAt: string;
};

function readMetaNumber(metadata: unknown, key: string): number | null {
	if (!metadata || typeof metadata !== "object") {
		return null;
	}
	const value = (metadata as Record<string, unknown>)[key];
	return typeof value === "number" ? value : null;
}

function readIndexProgress(metadata: unknown): IndexProgress | null {
	if (!metadata || typeof metadata !== "object") {
		return null;
	}
	const value = (metadata as Record<string, unknown>).indexProgress;
	if (!value || typeof value !== "object") {
		return null;
	}
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

function decodeBase64(base64: string) {
	return Uint8Array.from(Buffer.from(base64, "base64"));
}

async function refreshSource(sourceId: string) {
	const [fresh] = await db
		.select()
		.from(sources)
		.where(eq(sources.id, sourceId))
		.limit(1);

	if (!fresh) {
		throw notFound();
	}

	return toSourceDTO(fresh);
}

async function beginCreate(notebookId: string) {
	const { userId } = await requireOwnedNotebook(notebookId);
	assertCreateRateLimit(userId);
	await assertNotebookSourceCapacityForUser(userId, notebookId);

	const [row] = await db
		.select({ value: count() })
		.from(sources)
		.where(eq(sources.notebookId, notebookId));

	/** Only the notebook's first import (1 source or a playlist) gets an auto-overview. */
	const isIntroImport = (row?.value ?? 0) === 0;

	return { userId, isIntroImport };
}

function summaryMeta(isIntroImport: boolean) {
	return isIntroImport ? {} : { suppressSourceSummary: true as const };
}

export const listSources = createServerFn({ method: "GET" })
	.validator(z.object({ notebookId: z.string().uuid() }))
	.handler(async ({ data }) => {
		await requireOwnedNotebook(data.notebookId);

		const rows = await db
			.select()
			.from(sources)
			.where(eq(sources.notebookId, data.notebookId))
			.orderBy(desc(sources.createdAt));

		return rows.map(toSourceDTO);
	});

export const createTextSource = createServerFn({ method: "POST" })
	.validator(
		z.object({
			notebookId: z.string().uuid(),
			title: z.string().trim().min(1).max(INGEST_LIMITS.maxTitleLength),
			content: z
				.string()
				.trim()
				.min(1)
				.max(
					INGEST_LIMITS.maxTextChars,
					`Text must be ${INGEST_LIMITS.maxTextChars.toLocaleString()} characters or fewer`,
				),
		}),
	)
	.handler(async ({ data }) => {
		const { userId, isIntroImport } = await beginCreate(data.notebookId);

		const metadata: TextSourceMetadata = {
			content: data.content,
			charCount: data.content.length,
		};

		const [row] = await db
			.insert(sources)
			.values({
				notebookId: data.notebookId,
				type: "text",
				title: data.title,
				status: "indexing",
				metadata: {
					...metadata,
					...summaryMeta(isIntroImport),
					indexProgress: {
						phase: "queued",
						percent: 5,
						message: "Queued for indexing…",
					},
				},
			})
			.returning();

		if (!row) {
			throw new Error("Failed to create source");
		}

		enqueueBackgroundJob(`index-text:${row.id}`, async () => {
			await indexTextSource({
				sourceId: row.id,
				notebookId: data.notebookId,
				ownerId: userId,
				content: data.content,
			});
		});

		return refreshSource(row.id);
	});

export const createPdfSource = createServerFn({ method: "POST" })
	.validator(
		z.object({
			notebookId: z.string().uuid(),
			title: z.string().trim().min(1).max(INGEST_LIMITS.maxTitleLength),
			fileName: z.string().trim().min(1).max(INGEST_LIMITS.maxFileNameLength),
			fileBase64: z.string().min(1),
		}),
	)
	.handler(async ({ data }) => {
		const { userId, isIntroImport } = await beginCreate(data.notebookId);

		const bytes = decodeBase64(data.fileBase64);
		if (bytes.byteLength === 0) {
			throw new Error("PDF file is empty");
		}

		if (bytes.byteLength > INGEST_LIMITS.maxPdfBytes) {
			throw new Error(
				`PDF must be ${formatBytes(INGEST_LIMITS.maxPdfBytes)} or smaller`,
			);
		}

		const [row] = await db
			.insert(sources)
			.values({
				notebookId: data.notebookId,
				type: "pdf",
				title: data.title,
				status: "uploading",
				metadata: {
					originalFileName: data.fileName,
					mimeType: "application/pdf",
					...summaryMeta(isIntroImport),
				},
			})
			.returning();

		if (!row) {
			throw new Error("Failed to create PDF source");
		}

		const storageKey = pdfStorageKey(data.notebookId, row.id);

		try {
			await saveSourceFile({
				storageKey,
				data: bytes,
				contentType: "application/pdf",
			});

			await db
				.update(sources)
				.set({
					storageUri: storageKey,
					status: "indexing",
					metadata: {
						originalFileName: data.fileName,
						mimeType: "application/pdf",
						...summaryMeta(isIntroImport),
						indexProgress: {
							phase: "queued",
							percent: 5,
							message: "Queued for indexing…",
						},
					},
					updatedAt: new Date(),
				})
				.where(eq(sources.id, row.id));
		} catch (error) {
			const message = friendlyIngestError(error, "Failed to store PDF");
			await setSourceStatus(row.id, "failed", message);
			return refreshSource(row.id);
		}

		enqueueBackgroundJob(`index-pdf:${row.id}`, async () => {
			await indexPdfSource({
				sourceId: row.id,
				notebookId: data.notebookId,
				ownerId: userId,
				storageUri: storageKey,
				existingMetadata: {
					originalFileName: data.fileName,
					mimeType: "application/pdf",
					...summaryMeta(isIntroImport),
				},
			});
		});

		return refreshSource(row.id);
	});

export const createUrlSource = createServerFn({ method: "POST" })
	.validator(
		z.object({
			notebookId: z.string().uuid(),
			url: z.string().trim().min(1).max(INGEST_LIMITS.maxUrlLength),
			title: z.string().trim().max(INGEST_LIMITS.maxTitleLength).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const { userId, isIntroImport } = await beginCreate(data.notebookId);

		let url: string;
		try {
			url = normalizeUrl(data.url);
		} catch {
			throw new Error("Enter a valid website URL (https://…)");
		}

		const title =
			data.title?.trim() ||
			(() => {
				try {
					return new URL(url).hostname;
				} catch {
					return "Website";
				}
			})();

		const [row] = await db
			.insert(sources)
			.values({
				notebookId: data.notebookId,
				type: "url",
				title,
				status: "indexing",
				originalUrl: url,
				metadata: {
					...summaryMeta(isIntroImport),
					indexProgress: {
						phase: "queued",
						percent: 5,
						message: "Queued for indexing…",
					},
				},
			})
			.returning();

		if (!row) {
			throw new Error("Failed to create URL source");
		}

		enqueueBackgroundJob(`index-url:${row.id}`, async () => {
			await indexUrlSource({
				sourceId: row.id,
				notebookId: data.notebookId,
				ownerId: userId,
				url,
				updateTitleFromPage: !data.title?.trim(),
			});
		});

		return refreshSource(row.id);
	});

export const createVttSource = createServerFn({ method: "POST" })
	.validator(
		z.object({
			notebookId: z.string().uuid(),
			title: z.string().trim().min(1).max(INGEST_LIMITS.maxTitleLength),
			fileName: z.string().trim().min(1).max(INGEST_LIMITS.maxFileNameLength),
			fileBase64: z.string().min(1),
		}),
	)
	.handler(async ({ data }) => {
		const { userId, isIntroImport } = await beginCreate(data.notebookId);

		const bytes = decodeBase64(data.fileBase64);
		if (bytes.byteLength === 0) {
			throw new Error("VTT file is empty");
		}

		if (bytes.byteLength > INGEST_LIMITS.maxVttBytes) {
			throw new Error(
				`VTT must be ${formatBytes(INGEST_LIMITS.maxVttBytes)} or smaller`,
			);
		}

		const [row] = await db
			.insert(sources)
			.values({
				notebookId: data.notebookId,
				type: "vtt",
				title: data.title,
				status: "uploading",
				metadata: {
					originalFileName: data.fileName,
					mimeType: "text/vtt",
					...summaryMeta(isIntroImport),
				},
			})
			.returning();

		if (!row) {
			throw new Error("Failed to create VTT source");
		}

		const storageKey = vttStorageKey(data.notebookId, row.id);

		try {
			await saveSourceFile({
				storageKey,
				data: bytes,
				contentType: "text/vtt",
			});

			await db
				.update(sources)
				.set({
					storageUri: storageKey,
					status: "indexing",
					metadata: {
						originalFileName: data.fileName,
						mimeType: "text/vtt",
						...summaryMeta(isIntroImport),
						indexProgress: {
							phase: "queued",
							percent: 5,
							message: "Queued for indexing…",
						},
					},
					updatedAt: new Date(),
				})
				.where(eq(sources.id, row.id));
		} catch (error) {
			const message = friendlyIngestError(error, "Failed to store VTT");
			await setSourceStatus(row.id, "failed", message);
			return refreshSource(row.id);
		}

		enqueueBackgroundJob(`index-vtt:${row.id}`, async () => {
			await indexVttSource({
				sourceId: row.id,
				notebookId: data.notebookId,
				ownerId: userId,
				storageUri: storageKey,
				existingMetadata: {
					originalFileName: data.fileName,
					mimeType: "text/vtt",
					...summaryMeta(isIntroImport),
				},
			});
		});

		return refreshSource(row.id);
	});

export const createYoutubeSource = createServerFn({ method: "POST" })
	.validator(
		z.object({
			notebookId: z.string().uuid(),
			url: z.string().trim().min(1).max(INGEST_LIMITS.maxUrlLength),
			title: z.string().trim().max(INGEST_LIMITS.maxTitleLength).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const { userId, isIntroImport } = await beginCreate(data.notebookId);
		assertYoutubeProxyConfiguredForProduction();
		const introMeta = summaryMeta(isIntroImport);

		// Playlist → one YouTube source per video (same indexer + proxy).
		// Capacity for N videos: beginCreate only checked +1; expand check below.
		if (isYoutubePlaylistUrl(data.url)) {
			const playlist = await extractYoutubePlaylist(data.url);
			// beginCreate already reserved 1 slot mentally; re-check for full playlist.
			await assertNotebookSourceCapacityForUser(
				userId,
				data.notebookId,
				playlist.videos.length,
			);

			const importBatchId = crypto.randomUUID();
			const created: SourceDTO[] = [];
			for (const [index, video] of playlist.videos.entries()) {
				const watchUrl = youtubeWatchUrl(video.videoId);
				const title =
					data.title?.trim() && playlist.videos.length === 1
						? data.title.trim()
						: video.title?.trim() ||
							`${playlist.title} · ${index + 1}/${playlist.videos.length}`;

				const batchMeta = {
					videoId: video.videoId,
					playlistId: playlist.playlistId,
					playlistUrl: playlist.playlistUrl,
					playlistTitle: playlist.title,
					playlistIndex: index + 1,
					importBatchId,
					importBatchSize: playlist.videos.length,
					importBatchTitle: playlist.title,
					...introMeta,
				};

				const [row] = await db
					.insert(sources)
					.values({
						notebookId: data.notebookId,
						type: "youtube",
						title: title.slice(0, INGEST_LIMITS.maxTitleLength),
						status: "indexing",
						originalUrl: watchUrl,
						metadata: {
							...batchMeta,
							indexProgress: {
								phase: "queued",
								percent: 5,
								message: "Queued for indexing…",
							},
						},
					})
					.returning();

				if (!row) {
					throw new Error("Failed to create YouTube source from playlist");
				}

				// Stagger playlist caption fetches — burst calls often return empty XML.
				const startDelayMs = index * 1_500;
				enqueueBackgroundJob(`index-youtube:${row.id}`, async () => {
					if (startDelayMs > 0) {
						await new Promise((resolve) => setTimeout(resolve, startDelayMs));
					}
					await indexYoutubeSource({
						sourceId: row.id,
						notebookId: data.notebookId,
						ownerId: userId,
						urlOrId: video.videoId,
						updateTitleFromVideo: !video.title?.trim(),
						existingMetadata: batchMeta,
					});
				});

				created.push(await refreshSource(row.id));
			}

			return { sources: created, playlistTitle: playlist.title };
		}

		let videoId: string;
		try {
			videoId = extractYoutubeVideoId(data.url);
		} catch (error) {
			throw new Error(
				error instanceof Error ? error.message : "Invalid YouTube URL",
			);
		}

		const watchUrl = youtubeWatchUrl(videoId);
		const title = data.title?.trim() || `YouTube ${videoId}`;

		const [row] = await db
			.insert(sources)
			.values({
				notebookId: data.notebookId,
				type: "youtube",
				title,
				status: "indexing",
				originalUrl: watchUrl,
				metadata: {
					videoId,
					...introMeta,
					indexProgress: {
						phase: "queued",
						percent: 5,
						message: "Queued for indexing…",
					},
				},
			})
			.returning();

		if (!row) {
			throw new Error("Failed to create YouTube source");
		}

		enqueueBackgroundJob(`index-youtube:${row.id}`, async () => {
			await indexYoutubeSource({
				sourceId: row.id,
				notebookId: data.notebookId,
				ownerId: userId,
				urlOrId: videoId,
				updateTitleFromVideo: !data.title?.trim(),
				existingMetadata: { videoId, ...introMeta },
			});
		});

		return {
			sources: [await refreshSource(row.id)],
			playlistTitle: null as string | null,
		};
	});

export const reindexSource = createServerFn({ method: "POST" })
	.validator(z.object({ sourceId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const { userId, source } = await requireOwnedSource(data.sourceId);
		assertCreateRateLimit(userId);

		await setSourceStatus(source.id, "indexing");

		enqueueBackgroundJob(`reindex:${source.id}`, async () => {
			try {
				if (source.type === "text") {
					await reindexTextSource({
						sourceId: source.id,
						notebookId: source.notebookId,
						ownerId: userId,
						metadata: source.metadata,
					});
				} else if (source.type === "pdf") {
					if (!source.storageUri) {
						throw new Error("PDF file is missing from storage");
					}

					await indexPdfSource({
						sourceId: source.id,
						notebookId: source.notebookId,
						ownerId: userId,
						storageUri: source.storageUri,
						existingMetadata:
							source.metadata && typeof source.metadata === "object"
								? (source.metadata as Record<string, unknown>)
								: {},
					});
				} else if (source.type === "url") {
					if (!source.originalUrl) {
						throw new Error("URL source is missing originalUrl");
					}

					await indexUrlSource({
						sourceId: source.id,
						notebookId: source.notebookId,
						ownerId: userId,
						url: source.originalUrl,
						updateTitleFromPage: false,
					});
				} else if (source.type === "vtt") {
					if (!source.storageUri) {
						throw new Error("VTT file is missing from storage");
					}

					await indexVttSource({
						sourceId: source.id,
						notebookId: source.notebookId,
						ownerId: userId,
						storageUri: source.storageUri,
						existingMetadata:
							source.metadata && typeof source.metadata === "object"
								? (source.metadata as Record<string, unknown>)
								: {},
					});
				} else if (source.type === "youtube") {
					const meta = source.metadata as { videoId?: string } | null;
					const urlOrId = source.originalUrl || meta?.videoId;
					if (!urlOrId) {
						throw new Error("YouTube source is missing video URL");
					}

					await indexYoutubeSource({
						sourceId: source.id,
						notebookId: source.notebookId,
						ownerId: userId,
						urlOrId,
						updateTitleFromVideo: false,
						existingMetadata:
							source.metadata && typeof source.metadata === "object"
								? (source.metadata as Record<string, unknown>)
								: {},
					});
				} else {
					throw new Error(
						`Re-index is not implemented for source type: ${source.type}`,
					);
				}
			} catch (error) {
				const message = friendlyIngestError(error, "Failed to re-index source");
				await setSourceStatus(source.id, "failed", message);
			}
		});

		return refreshSource(source.id);
	});

export const deleteSource = createServerFn({ method: "POST" })
	.validator(z.object({ sourceId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const { source } = await requireOwnedSource(data.sourceId);

		await clearSourceIndex(source.id);
		await deleteSourceFile(source.storageUri);

		const [deleted] = await db
			.delete(sources)
			.where(and(eq(sources.id, source.id)))
			.returning({ id: sources.id });

		if (!deleted) {
			throw notFound();
		}

		return { id: deleted.id };
	});

/** Serve an owned source binary (PDF/VTT) to the source viewer. */
export const getSourceFile = createServerFn({ method: "GET" })
	.validator(z.object({ sourceId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const { source } = await requireOwnedSource(data.sourceId);

		if (!source.storageUri) {
			throw new Error("Source file is not available");
		}

		const buffer = await readSourceFile(source.storageUri);
		const mimeType =
			source.type === "pdf"
				? "application/pdf"
				: source.type === "vtt"
					? "text/vtt"
					: "application/octet-stream";

		const meta = source.metadata as { originalFileName?: string } | null;

		return {
			mimeType,
			fileName: meta?.originalFileName ?? `${source.id}.${source.type}`,
			base64: Buffer.from(buffer).toString("base64"),
		};
	});
