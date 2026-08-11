import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { notebooks } from "#/db/schema/notebooks.ts";
import { sources } from "#/db/schema/sources.ts";
import { getOptionalUserId, requireUserId } from "#/lib/auth.server.ts";
import { deletePointsByNotebookId } from "#/lib/qdrant/points.ts";
import { deleteSourceFile } from "#/lib/storage/files.server.ts";

export type NotebookDTO = {
	id: string;
	title: string;
	description: string | null;
	ownerId: string;
	createdAt: string;
	updatedAt: string;
};

function toNotebookDTO(row: typeof notebooks.$inferSelect): NotebookDTO {
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		ownerId: row.ownerId,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export const getAuthSession = createServerFn({ method: "GET" }).handler(
	async () => {
		const userId = await getOptionalUserId();
		return { userId };
	},
);

export const listNotebooks = createServerFn({ method: "GET" }).handler(
	async () => {
		const userId = await requireUserId();

		const rows = await db
			.select()
			.from(notebooks)
			.where(eq(notebooks.ownerId, userId))
			.orderBy(desc(notebooks.updatedAt));

		return rows.map(toNotebookDTO);
	},
);

export const getNotebook = createServerFn({ method: "GET" })
	.validator(z.object({ id: z.string().uuid() }))
	.handler(async ({ data }) => {
		const userId = await requireUserId();

		const [row] = await db
			.select()
			.from(notebooks)
			.where(and(eq(notebooks.id, data.id), eq(notebooks.ownerId, userId)))
			.limit(1);

		if (!row) {
			throw notFound();
		}

		return toNotebookDTO(row);
	});

export const createNotebook = createServerFn({ method: "POST" })
	.validator(
		z.object({
			title: z.string().trim().min(1).max(200),
			description: z.string().trim().max(2000).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const userId = await requireUserId();

		const [row] = await db
			.insert(notebooks)
			.values({
				title: data.title,
				description: data.description || null,
				ownerId: userId,
			})
			.returning();

		if (!row) {
			throw new Error("Failed to create notebook");
		}

		return toNotebookDTO(row);
	});

export const updateNotebook = createServerFn({ method: "POST" })
	.validator(
		z.object({
			id: z.string().uuid(),
			title: z.string().trim().min(1).max(200).optional(),
			description: z.string().trim().max(2000).nullable().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const userId = await requireUserId();

		const updates: Partial<typeof notebooks.$inferInsert> = {
			updatedAt: new Date(),
		};

		if (data.title !== undefined) {
			updates.title = data.title;
		}
		if (data.description !== undefined) {
			updates.description = data.description;
		}

		const [row] = await db
			.update(notebooks)
			.set(updates)
			.where(and(eq(notebooks.id, data.id), eq(notebooks.ownerId, userId)))
			.returning();

		if (!row) {
			throw notFound();
		}

		return toNotebookDTO(row);
	});

export const deleteNotebook = createServerFn({ method: "POST" })
	.validator(z.object({ id: z.string().uuid() }))
	.handler(async ({ data }) => {
		const userId = await requireUserId();

		const [owned] = await db
			.select({ id: notebooks.id })
			.from(notebooks)
			.where(and(eq(notebooks.id, data.id), eq(notebooks.ownerId, userId)))
			.limit(1);

		if (!owned) {
			throw notFound();
		}

		const notebookSources = await db
			.select({
				id: sources.id,
				storageUri: sources.storageUri,
			})
			.from(sources)
			.where(eq(sources.notebookId, owned.id));

		await Promise.all(
			notebookSources.map((source) => deleteSourceFile(source.storageUri)),
		);

		try {
			await deletePointsByNotebookId(owned.id);
		} catch (error) {
			console.error(
				`[deleteNotebook] failed to clear Qdrant points for ${owned.id}`,
				error,
			);
		}

		const [row] = await db
			.delete(notebooks)
			.where(and(eq(notebooks.id, owned.id), eq(notebooks.ownerId, userId)))
			.returning({ id: notebooks.id });

		if (!row) {
			throw notFound();
		}

		return { id: row.id };
	});
