import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireOwnedNotebook } from "#/features/sources/notebook-access.server.ts";
import { requireOwnedArtifact } from "./artifact-access.server.ts";
import {
	deleteArtifactById,
	insertArtifact,
	listArtifactsByNotebook,
	toArtifactDTO,
	updateArtifactById,
} from "./artifacts.store.server.ts";
import {
	ARTIFACT_LIMITS,
	artifactCitationSchema,
	artifactContentSchema,
	artifactStatusSchema,
	artifactTitleSchema,
	artifactTypeSchema,
	type ArtifactDTO,
	type ArtifactSummaryDTO,
} from "./artifacts.types.ts";

export type { ArtifactDTO, ArtifactSummaryDTO };

export const listArtifacts = createServerFn({ method: "GET" })
	.validator(z.object({ notebookId: z.string().uuid() }))
	.handler(async ({ data }): Promise<ArtifactSummaryDTO[]> => {
		await requireOwnedNotebook(data.notebookId);

		return listArtifactsByNotebook(data.notebookId);
	});

export const getArtifact = createServerFn({ method: "GET" })
	.validator(z.object({ id: z.string().uuid() }))
	.handler(async ({ data }): Promise<ArtifactDTO> => {
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

export const updateArtifact = createServerFn({ method: "POST" })
	.validator(
		z
			.object({
				id: z.string().uuid(),
				title: artifactTitleSchema.optional(),
				status: artifactStatusSchema.optional(),
				content: artifactContentSchema.nullable().optional(),
				citations: z.array(artifactCitationSchema).optional(),
				errorMessage: z
					.string()
					.trim()
					.max(ARTIFACT_LIMITS.maxErrorLength)
					.nullable()
					.optional(),
			})
			.refine(
				(value) =>
					value.title !== undefined ||
					value.status !== undefined ||
					value.content !== undefined ||
					value.citations !== undefined ||
					value.errorMessage !== undefined,
				{ message: "No artifact fields to update" },
			),
	)
	.handler(async ({ data }): Promise<ArtifactDTO> => {
		const { artifact } = await requireOwnedArtifact(data.id);

		const { id, ...patch } = data;

		return updateArtifactById(id, patch, artifact);
	});

export const deleteArtifact = createServerFn({ method: "POST" })
	.validator(z.object({ id: z.string().uuid() }))
	.handler(async ({ data }) => {
		const { artifact } = await requireOwnedArtifact(data.id);

		return deleteArtifactById(artifact.id);
	});
