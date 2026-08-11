import { notFound } from "@tanstack/react-router";
import { desc, eq } from "drizzle-orm";

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
		isShared: Boolean(row.shareToken),
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

/**
 * Content may only reference citations that exist on the artifact — both the
 * rendered sections and the typed payloads that back them, so a generator bug
 * can never persist a citation number that resolves to nothing.
 */
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

	const assertResolves = (label: string, numbers: number[] | undefined) => {
		for (const number of numbers ?? []) {
			if (!available.has(number)) {
				throw new Error(
					`${label} cites [${number}], which has no matching citation`,
				);
			}
		}
	};

	for (const section of content.sections) {
		assertResolves(`Section "${section.heading}"`, section.citationNumbers);
	}

	const guide = content.studyGuide;
	if (guide) {
		for (const item of [
			...guide.prerequisites,
			...guide.examples,
			...guide.pitfalls,
		]) {
			assertResolves(`Study guide item "${item.title}"`, item.citationNumbers);
		}
		for (const concept of guide.concepts) {
			assertResolves(`Concept "${concept.name}"`, concept.citationNumbers);
		}
		for (const question of guide.reviewQuestions) {
			assertResolves(
				`Review question "${question.question}"`,
				question.citationNumbers,
			);
		}
	}

	for (const step of content.learningRoadmap?.steps ?? []) {
		assertResolves(`Roadmap step "${step.title}"`, step.citationNumbers);
	}

	const compare = content.compareSources;
	if (compare) {
		for (const item of [
			...compare.sharedUnderstanding,
			...compare.agreements,
			...compare.disagreements,
			...compare.conclusion,
		]) {
			assertResolves("Compare Sources item", item.citationNumbers);
		}
		for (const insight of compare.sourceSpecificInsights) {
			for (const item of insight.items) {
				assertResolves(
					`Compare Sources insight for "${insight.sourceTitle}"`,
					item.citationNumbers,
				);
			}
		}
		for (const row of compare.comparisonTable) {
			for (const entry of row.entries) {
				assertResolves(
					`Compare Sources table "${row.claim}"`,
					entry.citationNumbers,
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
	shareToken?: string | null;
	sharedAt?: Date | null;
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
	if (patch.shareToken !== undefined) {
		updates.shareToken = patch.shareToken;
	}
	if (patch.sharedAt !== undefined) {
		updates.sharedAt = patch.sharedAt;
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

/**
 * Public share lookup by bearer token. Returns null when the token is missing,
 * revoked, or the artifact is not ready — callers should treat all three as
 * not-found so revoked and invalid tokens look the same.
 */
export async function getArtifactByShareToken(
	shareToken: string,
): Promise<ArtifactRow | null> {
	const [row] = await db
		.select()
		.from(artifacts)
		.where(eq(artifacts.shareToken, shareToken))
		.limit(1);

	if (!row || row.status !== "ready" || !row.content) {
		return null;
	}

	return row;
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
