import { desc, eq } from "drizzle-orm";
import { notFound } from "@tanstack/react-router";

import { db } from "#/db/index.ts";
import { artifacts } from "#/db/schema/artifacts.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";
import {
	ARTIFACT_LIMITS,
	ARTIFACT_TYPE_LABELS,
	type ArtifactContent,
	type ArtifactDTO,
	type ArtifactStatus,
	type ArtifactSummaryDTO,
	type ArtifactType,
} from "./artifacts.types.ts";

type ArtifactRow = typeof artifacts.$inferSelect;

export function toArtifactDTO(row: ArtifactRow): ArtifactDTO {
	return {
		id: row.id,
		notebookId: row.notebookId,
		ownerId: row.ownerId,
		type: row.type,
		title: row.title,
		status: row.status,
		content: row.content ?? null,
		citations: row.citations ?? [],
		errorMessage: row.errorMessage,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export function toArtifactSummaryDTO(row: ArtifactRow): ArtifactSummaryDTO {
	const dto = toArtifactDTO(row);
	const { content, citations, ...rest } = dto;

	return {
		...rest,
		citationCount: citations.length,
		sectionCount: content?.sections.length ?? 0,
	};
}

/** Citation numbers are 1-based and must be stable for section references. */
function normalizeCitations(citations: MessageCitation[]): MessageCitation[] {
	if (citations.length > ARTIFACT_LIMITS.maxCitations) {
		throw new Error(
			`An artifact can hold at most ${ARTIFACT_LIMITS.maxCitations} citations`,
		);
	}

	return citations.map((citation, i) => ({
		...citation,
		citationNumber: citation.citationNumber ?? i + 1,
	}));
}

/** Sections may only reference citations that exist on the artifact. */
function assertCitationsResolve(
	content: ArtifactContent | null,
	citations: MessageCitation[],
) {
	if (!content) {
		return;
	}

	const available = new Set(
		citations.map((citation, i) => citation.citationNumber ?? i + 1),
	);

	for (const section of content.sections) {
		for (const number of section.citationNumbers ?? []) {
			if (!available.has(number)) {
				throw new Error(
					`Section "${section.heading}" cites [${number}], which has no matching citation`,
				);
			}
		}
	}
}

export async function insertArtifact(input: {
	notebookId: string;
	ownerId: string;
	type: ArtifactType;
	title?: string;
}): Promise<ArtifactDTO> {
	const [row] = await db
		.insert(artifacts)
		.values({
			notebookId: input.notebookId,
			ownerId: input.ownerId,
			type: input.type,
			title: input.title?.trim() || ARTIFACT_TYPE_LABELS[input.type],
			status: "pending",
			citations: [],
		})
		.returning();

	if (!row) {
		throw new Error("Failed to create artifact");
	}

	return toArtifactDTO(row);
}

/**
 * Unauthorized row read for background generation, which runs outside the
 * request and therefore has no Clerk session. Request paths must keep using
 * `requireOwnedArtifact`.
 */
export async function getArtifactRowById(
	artifactId: string,
): Promise<ArtifactRow | null> {
	const [row] = await db
		.select()
		.from(artifacts)
		.where(eq(artifacts.id, artifactId))
		.limit(1);

	return row ?? null;
}

export async function listArtifactsByNotebook(
	notebookId: string,
): Promise<ArtifactSummaryDTO[]> {
	const rows = await db
		.select()
		.from(artifacts)
		.where(eq(artifacts.notebookId, notebookId))
		.orderBy(desc(artifacts.createdAt));

	return rows.map(toArtifactSummaryDTO);
}

export type ArtifactPatch = {
	title?: string;
	status?: ArtifactStatus;
	content?: ArtifactContent | null;
	citations?: MessageCitation[];
	errorMessage?: string | null;
};

/**
 * Applies a partial update. A `ready` artifact must carry content, and a
 * `failed` artifact must carry an error message, so generation failures can
 * never be silently rendered as an empty success.
 */
export async function updateArtifactById(
	artifactId: string,
	patch: ArtifactPatch,
	current: ArtifactRow,
): Promise<ArtifactDTO> {
	const updates: Partial<typeof artifacts.$inferInsert> = {
		updatedAt: new Date(),
	};

	const nextCitations =
		patch.citations !== undefined
			? normalizeCitations(patch.citations)
			: (current.citations ?? []);

	const nextContent =
		patch.content !== undefined ? patch.content : (current.content ?? null);

	const nextStatus = patch.status ?? current.status;

	if (nextStatus === "ready" && !nextContent) {
		throw new Error("A ready artifact must have content");
	}

	const nextError =
		patch.errorMessage !== undefined
			? patch.errorMessage
			: current.errorMessage;

	if (nextStatus === "failed" && !nextError) {
		throw new Error("A failed artifact must have an error message");
	}

	assertCitationsResolve(nextContent, nextCitations);

	if (patch.title !== undefined) {
		updates.title = patch.title;
	}
	if (patch.status !== undefined) {
		updates.status = patch.status;
	}
	if (patch.content !== undefined) {
		updates.content = patch.content;
	}
	if (patch.citations !== undefined) {
		updates.citations = nextCitations;
	}
	if (patch.errorMessage !== undefined) {
		updates.errorMessage = patch.errorMessage;
	}

	const [row] = await db
		.update(artifacts)
		.set(updates)
		.where(eq(artifacts.id, artifactId))
		.returning();

	if (!row) {
		throw notFound();
	}

	return toArtifactDTO(row);
}

export async function deleteArtifactById(artifactId: string) {
	const [row] = await db
		.delete(artifacts)
		.where(eq(artifacts.id, artifactId))
		.returning({ id: artifacts.id });

	if (!row) {
		throw notFound();
	}

	return { id: row.id };
}
