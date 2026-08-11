import { z } from "zod";

import type {
	ArtifactContent,
	ArtifactSection,
	CompareCitedItem,
	CompareSourceInsight,
	CompareSourcesData,
	CompareTableEntry,
	CompareTableRow,
	LearningRoadmapData,
	RoadmapStep,
	StudyGuideCitedItem,
	StudyGuideConcept,
	StudyGuideData,
	StudyGuideReviewQuestion,
} from "#/db/schema/artifacts.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";

export type {
	ArtifactContent,
	ArtifactSection,
	CompareCitedItem,
	CompareSourceInsight,
	CompareSourcesData,
	CompareTableEntry,
	CompareTableRow,
	LearningRoadmapData,
	RoadmapStep,
	StudyGuideCitedItem,
	StudyGuideConcept,
	StudyGuideData,
	StudyGuideReviewQuestion,
};

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

/** A roadmap is a path, not a syllabus dump: few steps, each worth doing. */
export const ROADMAP_LIMITS = {
	maxSteps: 10,
	maxPrerequisitesPerStep: 3,
	maxEffortLength: 60,
} as const;

/** Keeps a guide studyable: depth per concept, not an exhaustive dump. */
export const STUDY_GUIDE_LIMITS = {
	maxPrerequisites: 6,
	maxConcepts: 10,
	maxKeyPointsPerConcept: 5,
	maxExamples: 6,
	maxPitfalls: 6,
	maxReviewQuestions: 8,
} as const;

/** Caps so a comparison stays readable rather than listing every paraphrase. */
export const COMPARE_SOURCES_LIMITS = {
	maxSharedUnderstanding: 8,
	maxAgreements: 8,
	maxDisagreements: 8,
	maxInsightsPerSource: 5,
	maxTableRows: 8,
	maxConclusion: 5,
} as const;

/** Default titles used when a caller does not supply one. */
export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
	research_brief: "Research Brief",
	study_guide: "Study Guide",
	compare_sources: "Compare Sources",
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

const citationNumbersSchema = z.array(z.number().int().positive());

export const studyGuideCitedItemSchema = z.object({
	title: z.string().trim().min(1),
	explanation: z.string().trim().min(1),
	citationNumbers: citationNumbersSchema,
});

export const studyGuideConceptSchema = z.object({
	name: z.string().trim().min(1),
	explanation: z.string().trim().min(1),
	keyPoints: z
		.array(z.string().trim().min(1))
		.max(STUDY_GUIDE_LIMITS.maxKeyPointsPerConcept),
	citationNumbers: citationNumbersSchema,
});

export const studyGuideReviewQuestionSchema = z.object({
	question: z.string().trim().min(1),
	answer: z.string().trim().min(1),
	citationNumbers: citationNumbersSchema,
});

export const studyGuideDataSchema = z.object({
	prerequisites: z
		.array(studyGuideCitedItemSchema)
		.max(STUDY_GUIDE_LIMITS.maxPrerequisites),
	concepts: z
		.array(studyGuideConceptSchema)
		.max(STUDY_GUIDE_LIMITS.maxConcepts),
	examples: z
		.array(studyGuideCitedItemSchema)
		.max(STUDY_GUIDE_LIMITS.maxExamples),
	pitfalls: z
		.array(studyGuideCitedItemSchema)
		.max(STUDY_GUIDE_LIMITS.maxPitfalls),
	reviewQuestions: z
		.array(studyGuideReviewQuestionSchema)
		.max(STUDY_GUIDE_LIMITS.maxReviewQuestions),
});

export const roadmapStepSchema = z.object({
	order: z.number().int().positive(),
	title: z.string().trim().min(1),
	description: z.string().trim().min(1),
	whyItMatters: z.string().trim().min(1),
	prerequisiteSteps: z
		.array(z.number().int().positive())
		.max(ROADMAP_LIMITS.maxPrerequisitesPerStep)
		.optional(),
	estimatedEffort: z
		.string()
		.trim()
		.min(1)
		.max(ROADMAP_LIMITS.maxEffortLength)
		.optional(),
	citationNumbers: citationNumbersSchema,
});

export const learningRoadmapDataSchema = z.object({
	steps: z.array(roadmapStepSchema).max(ROADMAP_LIMITS.maxSteps),
});

export const compareCitedItemSchema = z.object({
	text: z.string().trim().min(1),
	citationNumbers: citationNumbersSchema,
});

export const compareSourceInsightSchema = z.object({
	sourceId: z.string().uuid(),
	sourceTitle: z.string().trim().min(1),
	items: z
		.array(compareCitedItemSchema)
		.max(COMPARE_SOURCES_LIMITS.maxInsightsPerSource),
});

export const compareTableEntrySchema = z.object({
	sourceId: z.string().uuid(),
	sourceTitle: z.string().trim().min(1),
	position: z.string().trim().min(1),
	citationNumbers: citationNumbersSchema,
});

export const compareTableRowSchema = z.object({
	claim: z.string().trim().min(1),
	entries: z.array(compareTableEntrySchema).min(2),
});

export const compareSourcesDataSchema = z.object({
	overview: z.string().trim().min(1),
	sharedUnderstanding: z
		.array(compareCitedItemSchema)
		.max(COMPARE_SOURCES_LIMITS.maxSharedUnderstanding),
	agreements: z
		.array(compareCitedItemSchema)
		.max(COMPARE_SOURCES_LIMITS.maxAgreements),
	disagreements: z
		.array(compareCitedItemSchema)
		.max(COMPARE_SOURCES_LIMITS.maxDisagreements),
	sourceSpecificInsights: z.array(compareSourceInsightSchema),
	comparisonTable: z
		.array(compareTableRowSchema)
		.max(COMPARE_SOURCES_LIMITS.maxTableRows),
	conclusion: z
		.array(compareCitedItemSchema)
		.max(COMPARE_SOURCES_LIMITS.maxConclusion),
});

export const artifactContentSchema = z.object({
	summary: z.string().optional(),
	sections: z.array(artifactSectionSchema).max(ARTIFACT_LIMITS.maxSections),
	studyGuide: studyGuideDataSchema.optional(),
	learningRoadmap: learningRoadmapDataSchema.optional(),
	compareSources: compareSourcesDataSchema.optional(),
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
	/** True when a public share token is currently active. Token itself is never listed. */
	isShared: boolean;
	createdAt: string;
	updatedAt: string;
};

/** Row shape without content/citations, for list views. */
export type ArtifactSummaryDTO = Omit<ArtifactDTO, "content" | "citations"> & {
	citationCount: number;
	sectionCount: number;
};
