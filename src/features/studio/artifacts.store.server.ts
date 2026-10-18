import { notFound } from "@tanstack/react-router";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { artifacts } from "#/db/schema/artifacts.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";
import {
	ARTIFACT_LIMITS,
	ARTIFACT_TYPE_LABELS,
	type ArtifactContent,
	type ArtifactDTO,
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

/** Non-status fields callers may patch without changing generation state. */
export type ArtifactFieldPatch = {
	title?: string;
	shareToken?: string | null;
	sharedAt?: Date | null;
};

/**
 * Pure readiness gate for generators and unit tests. A ready artifact must
 * carry content; citations must resolve against that content.
 */
export function assertReadyTransition(input: {
	content: ArtifactContent | null | undefined;
	citations: MessageCitation[];
}) {
	if (!input.content) {
		throw new Error("A ready artifact must have content");
	}
	const citations = normalizeCitations(input.citations);
	assertCitationsResolve(input.content, citations);
	return { content: input.content, citations };
}

/** Pure failure gate — empty messages are not persistable failures. */
export function assertFailedTransition(errorMessage: string) {
	const trimmed = errorMessage.trim();
	if (!trimmed) {
		throw new Error("A failed artifact must have an error message");
	}
	if (trimmed.length > ARTIFACT_LIMITS.maxErrorLength) {
		throw new Error(
			`Error message exceeds ${ARTIFACT_LIMITS.maxErrorLength} characters`,
		);
	}
	return trimmed;
}

/**
 * Transitions pending/failed → ready with validated content. Already-ready rows
 * are left unchanged (conditional UPDATE). Late jobs after a false timeout may
 * still succeed from `failed`.
 */
export async function markArtifactReady(
	artifactId: string,
	input: {
		title: string;
		content: ArtifactContent;
		citations: MessageCitation[];
	},
): Promise<ArtifactDTO | null> {
	const { content, citations } = assertReadyTransition(input);

	const [row] = await db
		.update(artifacts)
		.set({
			status: "ready",
			title: input.title,
			content,
			citations,
			errorMessage: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(artifacts.id, artifactId),
				inArray(artifacts.status, ["pending", "failed"]),
			),
		)
		.returning();

	return row ? toArtifactDTO(row) : null;
}

/**
 * Transitions pending → failed only. Never overwrites ready (or already-failed).
 */
export async function markArtifactFailedInStore(
	artifactId: string,
	errorMessage: string,
): Promise<ArtifactDTO | null> {
	const message = assertFailedTransition(errorMessage);

	const [row] = await db
		.update(artifacts)
		.set({
			status: "failed",
			errorMessage: message,
			updatedAt: new Date(),
		})
		.where(and(eq(artifacts.id, artifactId), eq(artifacts.status, "pending")))
		.returning();

	return row ? toArtifactDTO(row) : null;
}

/**
 * Title / share-link fields only — cannot forge ready content or status.
 */
export async function updateArtifactFields(
	artifactId: string,
	patch: ArtifactFieldPatch,
): Promise<ArtifactDTO> {
	if (
		patch.title === undefined &&
		patch.shareToken === undefined &&
		patch.sharedAt === undefined
	) {
		throw new Error("No artifact fields to update");
	}

	const updates: Partial<typeof artifacts.$inferInsert> = {
		updatedAt: new Date(),
	};

	if (patch.title !== undefined) {
		updates.title = patch.title;
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
