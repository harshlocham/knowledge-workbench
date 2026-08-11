import { and, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { sources } from "#/db/schema/sources.ts";

/** Only indexed sources can be cited, so artifacts are built from these alone. */
export async function listReadyNotebookSources(notebookId: string) {
	return db
		.select({ id: sources.id, title: sources.title })
		.from(sources)
		.where(
			and(eq(sources.notebookId, notebookId), eq(sources.status, "ready")),
		);
}
