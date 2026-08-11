import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const userPlanEnum = pgEnum("user_plan", ["free", "pro"]);

/**
 * Optional override of a Clerk user's plan. Missing row means Free.
 * Pro is granted only via an explicit admin/dev script — not self-serve.
 */
export const userPlans = pgTable("user_plans", {
	userId: text("user_id").primaryKey(),

	plan: userPlanEnum("plan").notNull().default("free"),

	updatedAt: timestamp("updated_at", {
		withTimezone: true,
	})
		.defaultNow()
		.notNull(),
});
