import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireOwnedNotebook } from "#/features/sources/notebook-access.server.ts";
import { enqueueBackgroundJob } from "#/lib/ingest/jobs.server.ts";
import { listReadyNotebookSources } from "./artifact-sources.server.ts";
import { insertArtifact } from "./artifacts.store.server.ts";
import type { ArtifactDTO } from "./artifacts.types.ts";
import { runCompareSourcesGeneration } from "./compare-sources.server.ts";

/**
 * Creates a `pending` Compare Sources artifact and generates it in the
 * background. Requires at least two ready sources — a single-source comparison
 * is meaningless and is rejected before any work is queued.
 */
export const generateCompareSourcesArtifact = createServerFn({ method: "POST" })
	.validator(
		z.object({
			notebookId: z.string().uuid(),
			focus: z.string().trim().max(500).optional(),
		}),
	)
	.handler(async ({ data }): Promise<ArtifactDTO> => {
		const { userId, notebook } = await requireOwnedNotebook(data.notebookId);

		const readySources = await listReadyNotebookSources(data.notebookId);
		if (readySources.length < 2) {
			throw new Error("Compare Sources requires at least two ready sources.");
		}

		const artifact = await insertArtifact({
			notebookId: data.notebookId,
			ownerId: userId,
			type: "compare_sources",
		});

		enqueueBackgroundJob(`compare-sources:${artifact.id}`, async () => {
			await runCompareSourcesGeneration({
				artifactId: artifact.id,
				notebookId: data.notebookId,
				ownerId: userId,
				notebookTitle: notebook.title,
				focus: data.focus,
			});
		});

		return artifact;
	});
