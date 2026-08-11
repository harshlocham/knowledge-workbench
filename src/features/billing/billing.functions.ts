import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { db } from "#/db/index.ts";
import {
	UPGRADE_INTENT_SOURCES,
	upgradeIntents,
} from "#/db/schema/upgrade-intents.ts";
import { requireUserId } from "#/lib/auth.server.ts";
import { getPlanLimits, type PlanId } from "#/lib/plans/limits.ts";
import { getUserPlan } from "#/lib/plans/plan.server.ts";
import {
	getStudioUsage,
	type StudioUsageSnapshot,
} from "#/lib/plans/usage.server.ts";

export type BillingSummary = {
	plan: PlanId;
	limits: ReturnType<typeof getPlanLimits>;
	studio: StudioUsageSnapshot;
};

export const getBillingSummary = createServerFn({ method: "GET" }).handler(
	async (): Promise<BillingSummary> => {
		const userId = await requireUserId();
		const plan = await getUserPlan(userId);
		const studio = await getStudioUsage(userId);
		return {
			plan,
			limits: getPlanLimits(plan),
			studio,
		};
	},
);

export const joinProWaitlist = createServerFn({ method: "POST" })
	.validator(
		z.object({
			source: z.enum(UPGRADE_INTENT_SOURCES),
		}),
	)
	.handler(async ({ data }) => {
		const userId = await requireUserId();
		const plan = await getUserPlan(userId);

		const [row] = await db
			.insert(upgradeIntents)
			.values({
				userId,
				plan,
				source: data.source,
			})
			.returning({
				id: upgradeIntents.id,
				createdAt: upgradeIntents.createdAt,
			});

		if (!row) {
			throw new Error("Failed to join waitlist");
		}

		return {
			ok: true as const,
			id: row.id,
			createdAt: row.createdAt.toISOString(),
		};
	});
