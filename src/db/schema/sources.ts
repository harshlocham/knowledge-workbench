import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { notebooks } from "./notebooks.ts";

export const sourceTypeEnum = pgEnum("source_type", [
  "pdf",
  "text",
  "url",
  "youtube",
  "vtt",
]);

export const sourceStatusEnum = pgEnum("source_status", [
  "uploading",
  "indexing",
  "ready",
  "failed",
]);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),

    type: sourceTypeEnum("type").notNull(),

    title: text("title").notNull(),

    status: sourceStatusEnum("status").notNull().default("uploading"),

    // Local path, object storage key, or remote URL depending on type
    storageUri: text("storage_uri"),

    // Original user-provided URL (website / YouTube)
    originalUrl: text("original_url"),

    // Type-specific fields: mimeType, pageCount, videoId, playlistId, error, etc.
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),

    errorMessage: text("error_message"),

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
    index("sources_notebook_id_idx").on(table.notebookId),
    index("sources_notebook_status_idx").on(table.notebookId, table.status),
  ],
);
