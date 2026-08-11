import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { userPlans } from "#/db/schema/user-plans.ts";
import { AppError } from "#/lib/errors.ts";
import {
	assertPlanIsPro,
	getPlanLimits,
	isPlanId,
	type PlanId,
	type PlanLimits,
} from "#/lib/plans/limits.ts";

/** Missing row = Free. Never invent Pro. */
export async function getUserPlan(userId: string): Promise<PlanId> {
	const [row] = await db
		.select({ plan: userPlans.plan })
		.from(userPlans)
		.where(eq(userPlans.userId, userId))
		.limit(1);

	if (!row || !isPlanId(row.plan)) {
		return "free";
	}
	return row.plan;
}

export async function getUserPlanLimits(userId: string): Promise<{
	plan: PlanId;
	limits: PlanLimits;
}> {
	const plan = await getUserPlan(userId);
	return { plan, limits: getPlanLimits(plan) };
}

export async function upsertUserPlan(userId: string, plan: PlanId) {
	const now = new Date();
	await db
		.insert(userPlans)
		.values({
			userId,
			plan,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: userPlans.userId,
			set: {
				plan,
				updatedAt: now,
			},
		});

	return { userId, plan };
}

/** Free users cannot use Pro-only surfaces (export/share this sprint). */
export async function assertProFeature(
	userId: string,
	featureLabel = "This feature",
) {
	const plan = await getUserPlan(userId);
	if (plan !== "pro") {
		try {
			assertPlanIsPro(plan, featureLabel);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new AppError("PRO_FEATURE", message);
		}
	}
	return plan;
}
