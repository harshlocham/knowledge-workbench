import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

import { notebooks } from "./notebooks.ts";
import { sources } from "./sources.ts";

/**
 * Chunk text + locators (embeddings live in Qdrant).
 * Full-text: `search_vector` is a GENERATED tsvector from
 * `drizzle/0001_chunks_search_vector.sql` (not Drizzle-owned — avoid `db:push` dropping it).
 */

/** Locator used by the source viewer + citations (no embeddings — those live in Qdrant). */
export type ChunkLocator = {
	page?: number;
	startOffset?: number;
	endOffset?: number;
	url?: string;
	heading?: string;
	videoId?: string;
	/** Start time in seconds (VTT / media) */
	tStart?: number;
	/** End time in seconds (VTT / media) */
	tEnd?: number;
	/** First cue index in the chunk (convenience) */
	cueIndex?: number;
	/** All cue indexes covered by this chunk */
	cueIndexes?: number[];
};

export const chunks = pgTable(
	"chunks",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		sourceId: uuid("source_id")
			.notNull()
			.references(() => sources.id, { onDelete: "cascade" }),

		// Denormalized for notebook-scoped queries without joining sources
		notebookId: uuid("notebook_id")
			.notNull()
			.references(() => notebooks.id, { onDelete: "cascade" }),

		content: text("content").notNull(),

		chunkIndex: integer("chunk_index").notNull(),

		locator: jsonb("locator").$type<ChunkLocator>().notNull().default({}),

		// Same UUID as the Qdrant point id — keeps Postgres ↔ Qdrant in sync
		qdrantPointId: uuid("qdrant_point_id").notNull().defaultRandom(),

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
		index("chunks_source_id_idx").on(table.sourceId),
		index("chunks_notebook_id_idx").on(table.notebookId),
		uniqueIndex("chunks_qdrant_point_id_uidx").on(table.qdrantPointId),
		uniqueIndex("chunks_source_chunk_index_uidx").on(
			table.sourceId,
			table.chunkIndex,
		),
	],
);
