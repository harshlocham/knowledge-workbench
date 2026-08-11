import { and, eq, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { usageEvents } from "#/db/schema/usage-events.ts";
import { AppError } from "#/lib/errors.ts";
import {
	getPlanLimits,
	type PlanId,
	usagePeriodUtc,
} from "#/lib/plans/limits.ts";
import { getUserPlan } from "#/lib/plans/plan.server.ts";

export type StudioUsageSnapshot = {
	plan: PlanId;
	period: string;
	used: number;
	limit: number;
};

export async function getStudioUsage(
	userId: string,
	at: Date = new Date(),
): Promise<StudioUsageSnapshot> {
	const plan = await getUserPlan(userId);
	const limit = getPlanLimits(plan).monthlyStudioGenerations;
	const period = usagePeriodUtc(at);

	const [row] = await db
		.select({ quantity: usageEvents.quantity })
		.from(usageEvents)
		.where(
			and(
				eq(usageEvents.userId, userId),
				eq(usageEvents.kind, "studio_generation"),
				eq(usageEvents.period, period),
			),
		)
		.limit(1);

	return {
		plan,
		period,
		used: row?.quantity ?? 0,
		limit,
	};
}

/**
 * Atomically consumes one Studio generation for the current UTC month.
 *
 * Strategy: INSERT … ON CONFLICT DO UPDATE SET quantity = quantity + 1
 * WHERE quantity < limit, RETURNING. Zero rows means the limit was hit
 * (including under concurrent tabs). No refund if generation later fails.
 */
export async function assertAndConsumeStudioGeneration(
	userId: string,
	at: Date = new Date(),
): Promise<StudioUsageSnapshot> {
	const plan = await getUserPlan(userId);
	const limit = getPlanLimits(plan).monthlyStudioGenerations;
	const period = usagePeriodUtc(at);
	const now = at;

	const rows = await db
		.insert(usageEvents)
		.values({
			userId,
			kind: "studio_generation",
			period,
			quantity: 1,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [usageEvents.userId, usageEvents.kind, usageEvents.period],
			set: {
				quantity: sql`${usageEvents.quantity} + 1`,
				updatedAt: now,
			},
			setWhere: sql`${usageEvents.quantity} < ${limit}`,
		})
		.returning({ quantity: usageEvents.quantity });

	const [first] = rows;
	if (!first) {
		const label = plan === "free" ? "Free" : "Pro";
		throw new AppError(
			"STUDIO_GENERATION_LIMIT",
			`You've reached the ${label} plan limit of ${limit} Studio generations this month.`,
		);
	}

	return {
		plan,
		period,
		used: first.quantity,
		limit,
	};
}
