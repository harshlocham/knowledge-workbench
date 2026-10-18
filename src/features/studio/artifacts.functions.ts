import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireOwnedNotebook } from "#/features/sources/notebook-access.server.ts";
import { requireOwnedArtifact } from "./artifact-access.server.ts";
import { recoverStalePendingArtifacts } from "./artifact-recovery.server.ts";
import {
	deleteArtifactById,
	insertArtifact,
	listArtifactsByNotebook,
	toArtifactDTO,
	updateArtifactFields,
} from "./artifacts.store.server.ts";
import {
	type ArtifactDTO,
	type ArtifactSummaryDTO,
	artifactTitleSchema,
	artifactTypeSchema,
} from "./artifacts.types.ts";

export type { ArtifactDTO, ArtifactSummaryDTO };

export const listArtifacts = createServerFn({ method: "GET" })
	.validator(z.object({ notebookId: z.string().uuid() }))
	.handler(async ({ data }): Promise<ArtifactSummaryDTO[]> => {
		await requireOwnedNotebook(data.notebookId);
		await recoverStalePendingArtifacts();

		return listArtifactsByNotebook(data.notebookId);
	});

export const getArtifact = createServerFn({ method: "GET" })
	.validator(z.object({ id: z.string().uuid() }))
	.handler(async ({ data }): Promise<ArtifactDTO> => {
		await recoverStalePendingArtifacts();
		const { artifact } = await requireOwnedArtifact(data.id);

		return toArtifactDTO(artifact);
	});

export const createArtifact = createServerFn({ method: "POST" })
	.validator(
		z.object({
			notebookId: z.string().uuid(),
			type: artifactTypeSchema,
			title: artifactTitleSchema.optional(),
		}),
	)
	.handler(async ({ data }): Promise<ArtifactDTO> => {
		const { userId } = await requireOwnedNotebook(data.notebookId);

		return insertArtifact({
			notebookId: data.notebookId,
			ownerId: userId,
			type: data.type,
			title: data.title,
		});
	});

/** Title-only. Status/content/citations cannot be forged from the client. */
export const updateArtifact = createServerFn({ method: "POST" })
	.validator(
		z.object({
			id: z.string().uuid(),
			title: artifactTitleSchema,
		}),
	)
	.handler(async ({ data }): Promise<ArtifactDTO> => {
		const { artifact } = await requireOwnedArtifact(data.id);

		return updateArtifactFields(artifact.id, { title: data.title });
	});

export const deleteArtifact = createServerFn({ method: "POST" })
	.validator(z.object({ id: z.string().uuid() }))
	.handler(async ({ data }) => {
		const { artifact } = await requireOwnedArtifact(data.id);

		return deleteArtifactById(artifact.id);
	});
