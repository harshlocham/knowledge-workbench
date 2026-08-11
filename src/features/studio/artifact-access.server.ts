import { and, eq } from "drizzle-orm";
import { notFound } from "@tanstack/react-router";

import { db } from "#/db/index.ts";
import { artifacts } from "#/db/schema/artifacts.ts";
import { notebooks } from "#/db/schema/notebooks.ts";
import { requireUserId } from "#/lib/auth.server.ts";

/**
 * Ownership is resolved through `notebooks.ownerId` (the authoritative column)
 * rather than the denormalized `artifacts.owner_id`.
 */
export async function requireOwnedArtifact(artifactId: string) {
	const userId = await requireUserId();

	const [row] = await db
		.select({
			artifact: artifacts,
		})
		.from(artifacts)
		.innerJoin(notebooks, eq(artifacts.notebookId, notebooks.id))
		.where(and(eq(artifacts.id, artifactId), eq(notebooks.ownerId, userId)))
		.limit(1);

	if (!row) {
		throw notFound();
	}

	return { userId, artifact: row.artifact };
}
