import { and, eq } from "drizzle-orm";
import { notFound } from "@tanstack/react-router";

import { db } from "#/db/index.ts";
import { notebooks } from "#/db/schema/notebooks.ts";
import { sources } from "#/db/schema/sources.ts";
import { requireUserId } from "#/lib/auth.server.ts";

export async function requireOwnedNotebook(notebookId: string) {
  const userId = await requireUserId();

  const [notebook] = await db
    .select()
    .from(notebooks)
    .where(and(eq(notebooks.id, notebookId), eq(notebooks.ownerId, userId)))
    .limit(1);

  if (!notebook) {
    throw notFound();
  }

  return { userId, notebook };
}

export async function requireOwnedSource(sourceId: string) {
  const userId = await requireUserId();

  const [row] = await db
    .select({
      source: sources,
      ownerId: notebooks.ownerId,
    })
    .from(sources)
    .innerJoin(notebooks, eq(sources.notebookId, notebooks.id))
    .where(and(eq(sources.id, sourceId), eq(notebooks.ownerId, userId)))
    .limit(1);

  if (!row) {
    throw notFound();
  }

  return { userId, source: row.source };
}
