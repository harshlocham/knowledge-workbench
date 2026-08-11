import { z } from "zod";

import type {
	ArtifactContent,
	ArtifactSection,
} from "#/db/schema/artifacts.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";

export type { ArtifactContent, ArtifactSection };

export const ARTIFACT_TYPES = [
	"research_brief",
	"study_guide",
	"compare_sources",
	"learning_roadmap",
] as const;

export const ARTIFACT_STATUSES = ["pending", "ready", "failed"] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const ARTIFACT_LIMITS = {
	maxTitleLength: 200,
	maxSections: 40,
	maxBulletsPerSection: 40,
	maxCitations: 200,
	maxErrorLength: 1000,
} as const;

/** Default titles used when a caller does not supply one. */
export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
	research_brief: "Research Brief",
	study_guide: "Study Guide",
	compare_sources: "Source Comparison",
	learning_roadmap: "Learning Roadmap",
};

export const artifactTypeSchema = z.enum(ARTIFACT_TYPES);
export const artifactStatusSchema = z.enum(ARTIFACT_STATUSES);

/** Mirrors `ChunkLocator` in the chunks schema so citations stay interchangeable. */
export const chunkLocatorSchema = z.object({
	page: z.number().int().nonnegative().optional(),
	startOffset: z.number().int().nonnegative().optional(),
	endOffset: z.number().int().nonnegative().optional(),
	url: z.string().optional(),
	heading: z.string().optional(),
	videoId: z.string().optional(),
	tStart: z.number().nonnegative().optional(),
	tEnd: z.number().nonnegative().optional(),
	cueIndex: z.number().int().nonnegative().optional(),
	cueIndexes: z.array(z.number().int().nonnegative()).optional(),
});

/** Mirrors `MessageCitation` so artifacts reuse the chat citation semantics. */
export const artifactCitationSchema = z.object({
	chunkId: z.string().uuid(),
	sourceId: z.string().uuid(),
	sourceTitle: z.string().optional(),
	quote: z.string().optional(),
	locator: chunkLocatorSchema.optional(),
	citationNumber: z.number().int().positive().optional(),
});

export const artifactSectionSchema = z.object({
	heading: z.string().trim().min(1),
	body: z.string().optional(),
	bullets: z
		.array(z.string())
		.max(ARTIFACT_LIMITS.maxBulletsPerSection)
		.optional(),
	citationNumbers: z.array(z.number().int().positive()).optional(),
});

export const artifactContentSchema = z.object({
	summary: z.string().optional(),
	sections: z.array(artifactSectionSchema).max(ARTIFACT_LIMITS.maxSections),
});

export const artifactTitleSchema = z
	.string()
	.trim()
	.min(1)
	.max(ARTIFACT_LIMITS.maxTitleLength);

export type ArtifactDTO = {
	id: string;
	notebookId: string;
	ownerId: string;
	type: ArtifactType;
	title: string;
	status: ArtifactStatus;
	content: ArtifactContent | null;
	citations: MessageCitation[];
	errorMessage: string | null;
	createdAt: string;
	updatedAt: string;
};

/** Row shape without content/citations, for list views. */
export type ArtifactSummaryDTO = Omit<ArtifactDTO, "content" | "citations"> & {
	citationCount: number;
	sectionCount: number;
};
