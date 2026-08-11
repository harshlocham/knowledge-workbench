import {
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

import type { MessageCitation } from "./messages.ts";
import { notebooks } from "./notebooks.ts";

export const artifactTypeEnum = pgEnum("artifact_type", [
	"research_brief",
	"study_guide",
	"compare_sources",
	"learning_roadmap",
]);

export const artifactStatusEnum = pgEnum("artifact_status", [
	"pending",
	"ready",
	"failed",
]);

/**
 * One rendered block of an artifact. `citationNumbers` index into the
 * artifact's `citations` array (same numbering the chat answers use), so the
 * UI can reuse the existing citation → source viewer path.
 */
export type ArtifactSection = {
	heading: string;
	body?: string;
	bullets?: string[];
	citationNumbers?: number[];
};

/**
 * A prerequisite, worked example or pitfall. All three are a titled claim with
 * an explanation, so they share one shape.
 */
export type StudyGuideCitedItem = {
	title: string;
	explanation: string;
	citationNumbers: number[];
};

export type StudyGuideConcept = {
	name: string;
	explanation: string;
	keyPoints: string[];
	citationNumbers: number[];
};

/** `citationNumbers` may be empty: a question is derived, not asserted. */
export type StudyGuideReviewQuestion = {
	question: string;
	answer: string;
	citationNumbers: number[];
};

/**
 * Structured Study Guide payload. Kept alongside the generic `sections` (which
 * are a projection of this data) so a dedicated UI can render concepts and
 * hide review answers without re-parsing markdown.
 */
export type StudyGuideData = {
	prerequisites: StudyGuideCitedItem[];
	concepts: StudyGuideConcept[];
	examples: StudyGuideCitedItem[];
	pitfalls: StudyGuideCitedItem[];
	reviewQuestions: StudyGuideReviewQuestion[];
};

/**
 * One ordered step of a learning roadmap. `prerequisiteSteps` and
 * `estimatedEffort` are optional because the sources often establish neither —
 * omitting them is correct, guessing them is not.
 */
export type RoadmapStep = {
	order: number;
	title: string;
	description: string;
	whyItMatters: string;
	/** `order` values of earlier steps the evidence says must come first. */
	prerequisiteSteps?: number[];
	/** Free text such as "about 40 minutes of video". */
	estimatedEffort?: string;
	citationNumbers: number[];
};

/**
 * Structured Learning Roadmap payload, kept alongside the generic `sections`
 * projection so the UI can render step ordering, prerequisites and effort
 * without re-parsing markdown.
 */
export type LearningRoadmapData = {
	steps: RoadmapStep[];
};

/** A short claim with citations — used for agreements, disagreements, etc. */
export type CompareCitedItem = {
	text: string;
	citationNumbers: number[];
};

export type CompareSourceInsight = {
	sourceId: string;
	sourceTitle: string;
	items: CompareCitedItem[];
};

export type CompareTableEntry = {
	sourceId: string;
	sourceTitle: string;
	position: string;
	citationNumbers: number[];
};

export type CompareTableRow = {
	claim: string;
	entries: CompareTableEntry[];
};

/**
 * Structured Compare Sources payload. Kept alongside the generic `sections`
 * projection so the UI can render the comparison table and per-source insights
 * without re-parsing markdown.
 */
export type CompareSourcesData = {
	overview: string;
	sharedUnderstanding: CompareCitedItem[];
	agreements: CompareCitedItem[];
	disagreements: CompareCitedItem[];
	sourceSpecificInsights: CompareSourceInsight[];
	comparisonTable: CompareTableRow[];
	conclusion: CompareCitedItem[];
};

export type ArtifactContent = {
	summary?: string;
	sections: ArtifactSection[];
	/** Present on `study_guide` artifacts only. */
	studyGuide?: StudyGuideData;
	/** Present on `learning_roadmap` artifacts only. */
	learningRoadmap?: LearningRoadmapData;
	/** Present on `compare_sources` artifacts only. */
	compareSources?: CompareSourcesData;
};

export const artifacts = pgTable(
	"artifacts",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		notebookId: uuid("notebook_id")
			.notNull()
			.references(() => notebooks.id, { onDelete: "cascade" }),

		// Denormalized Clerk user id so ownership filters skip the notebooks join
		ownerId: text("owner_id").notNull(),

		type: artifactTypeEnum("type").notNull(),

		title: text("title").notNull(),

		status: artifactStatusEnum("status").notNull().default("pending"),

		content: jsonb("content").$type<ArtifactContent | null>(),

		// Same citation shape as chat messages — keeps jump-to-source identical
		citations: jsonb("citations")
			.$type<MessageCitation[]>()
			.notNull()
			.default([]),

		errorMessage: text("error_message"),

		/**
		 * Cryptographically random bearer token for a public read-only share link.
		 * Null means the artifact is not shared. Never use the artifact UUID as the
		 * public identifier.
		 */
		shareToken: text("share_token"),

		sharedAt: timestamp("shared_at", {
			withTimezone: true,
		}),

		createdAt: timestamp("created_at", {
			withTimezone: true,
		})
			.defaultNow()
			.notNull(),

		updatedAt: timestamp("updated_at", {
			withTimezone: true,
		})
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("artifacts_notebook_id_idx").on(table.notebookId),
		index("artifacts_notebook_created_at_idx").on(
			table.notebookId,
			table.createdAt,
		),
		index("artifacts_owner_id_idx").on(table.ownerId),
		uniqueIndex("artifacts_share_token_uidx").on(table.shareToken),
	],
);
