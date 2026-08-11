import {
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

/** Only `studio_generation` is used this sprint. */
export const USAGE_KINDS = ["studio_generation"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

/**
 * Monthly counters keyed by Clerk user. One row per (user, kind, period).
 * Period is UTC `YYYY-MM`. Quantity is incremented atomically under a limit.
 */
export const usageEvents = pgTable(
	"usage_events",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		userId: text("user_id").notNull(),

		kind: text("kind").$type<UsageKind>().notNull(),

		/** UTC calendar month, e.g. `2026-08`. */
		period: text("period").notNull(),

		quantity: integer("quantity").notNull().default(0),

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
		uniqueIndex("usage_events_user_kind_period_uidx").on(
			table.userId,
			table.kind,
			table.period,
		),
		index("usage_events_user_kind_period_idx").on(
			table.userId,
			table.kind,
			table.period,
		),
	],
);
