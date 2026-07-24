import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const notebooks = pgTable("notebooks", {
  id: uuid("id").defaultRandom().primaryKey(),

  title: text("title").notNull(),

  description: text("description"),

  // Clerk User ID (e.g. "user_2abcXYZ...")
  ownerId: text("owner_id").notNull(),

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
});
