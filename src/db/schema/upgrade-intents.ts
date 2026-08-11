import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const UPGRADE_INTENT_SOURCES = [
	"studio_generation_limit",
	"export",
	"share",
	"landing",
	"general_upgrade",
] as const;

export type UpgradeIntentSource = (typeof UPGRADE_INTENT_SOURCES)[number];

/**
 * Willingness-to-pay signal: user asked to join the Pro waitlist.
 * Not a subscription — payment is not implemented.
 */
export const upgradeIntents = pgTable(
	"upgrade_intents",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		userId: text("user_id").notNull(),

		/** Plan the user was on when they expressed intent (almost always free). */
		plan: text("plan").notNull().default("free"),

		source: text("source").$type<UpgradeIntentSource>().notNull(),

		createdAt: timestamp("created_at", {
			withTimezone: true,
		})
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("upgrade_intents_user_created_at_idx").on(
			table.userId,
			table.createdAt,
		),
	],
);
