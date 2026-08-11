import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireOwnedNotebook } from "#/features/sources/notebook-access.server.ts";
import { enqueueBackgroundJob } from "#/lib/ingest/jobs.server.ts";
import { recoverStalePendingArtifacts } from "./artifact-recovery.server.ts";
import { listReadyNotebookSources } from "./artifact-sources.server.ts";
import { insertArtifact } from "./artifacts.store.server.ts";
import type { ArtifactDTO } from "./artifacts.types.ts";
import { runResearchBriefGeneration } from "./research-brief.server.ts";
import { consumeStudioGenerationSlot } from "./studio-generation-gate.server.ts";

/**
 * Creates a `pending` Research Brief and generates it in the background, so a
 * slow multi-probe retrieval + LLM pass never blocks the request. Clients read
 * the resulting `ready` / `failed` state back through `getArtifact`.
 */
export const generateResearchBriefArtifact = createServerFn({ method: "POST" })
	.validator(
		z.object({
			notebookId: z.string().uuid(),
			focus: z.string().trim().max(500).optional(),
		}),
	)
	.handler(async ({ data }): Promise<ArtifactDTO> => {
		await recoverStalePendingArtifacts();
		const { userId, notebook } = await requireOwnedNotebook(data.notebookId);

		const readySources = await listReadyNotebookSources(data.notebookId);
		if (readySources.length === 0) {
			throw new Error(
				"Add at least one indexed source before creating a research brief.",
			);
		}

		await consumeStudioGenerationSlot(userId);

		const artifact = await insertArtifact({
			notebookId: data.notebookId,
			ownerId: userId,
			type: "research_brief",
		});

		enqueueBackgroundJob(`research-brief:${artifact.id}`, async () => {
			await runResearchBriefGeneration({
				artifactId: artifact.id,
				notebookId: data.notebookId,
				ownerId: userId,
				notebookTitle: notebook.title,
				focus: data.focus,
			});
		});

		return artifact;
	});
