import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import type { ChunkLocator } from "./chunks.ts";
import { notebooks } from "./notebooks.ts";

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

export type MessageCitation = {
  chunkId: string;
  sourceId: string;
  quote?: string;
  locator?: ChunkLocator;
};

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),

    role: messageRoleEnum("role").notNull(),

    content: text("content").notNull(),

    // Assistant answers must carry citations; empty for user turns
    citations: jsonb("citations").$type<MessageCitation[]>().default([]),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("messages_notebook_id_idx").on(table.notebookId),
    index("messages_notebook_created_at_idx").on(
      table.notebookId,
      table.createdAt,
    ),
  ],
);
