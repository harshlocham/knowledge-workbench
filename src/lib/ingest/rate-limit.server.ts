import { count, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { sources } from "#/db/schema/sources.ts";
import { AppError } from "#/lib/errors.ts";
import { INGEST_LIMITS } from "#/lib/ingest/limits.ts";
import { assertSourceCountAllowed, type PlanId } from "#/lib/plans/limits.ts";
import { getUserPlanLimits } from "#/lib/plans/plan.server.ts";

const createBuckets = new Map<string, number[]>();

/** In-memory sliding window (per server process). Fine for single-node / dev. */
export function assertCreateRateLimit(userId: string) {
	const now = Date.now();
	const windowMs = INGEST_LIMITS.createWindowMs;
	const prior = (createBuckets.get(userId) ?? []).filter(
		(ts) => now - ts < windowMs,
	);

	if (prior.length >= INGEST_LIMITS.maxCreatesPerWindow) {
		throw new Error(
			`Too many sources added. Limit is ${INGEST_LIMITS.maxCreatesPerWindow} per 10 minutes — try again shortly.`,
		);
	}

	prior.push(now);
	createBuckets.set(userId, prior);
}

/**
 * Counts every source row (ready, indexing, uploading, failed) so pending
 * uploads cannot bypass the plan cap.
 */
export async function assertNotebookSourceCapacity(
	notebookId: string,
	additional = 1,
	options?: { maxSourcesPerNotebook: number; plan: PlanId },
) {
	let max: number;
	let plan: PlanId;

	if (options) {
		max = options.maxSourcesPerNotebook;
		plan = options.plan;
	} else {
		// Fallback: resolve from notebook owner via a join is heavier; callers
		// should pass plan limits. Keep Pro ceiling as last-resort safety.
		max = INGEST_LIMITS.maxSourcesPerNotebook;
		plan = "pro";
	}

	const [row] = await db
		.select({ value: count() })
		.from(sources)
		.where(eq(sources.notebookId, notebookId));

	const total = row?.value ?? 0;

	try {
		assertSourceCountAllowed(total, additional, max, plan);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new AppError("SOURCE_LIMIT", message);
	}
}

export async function assertNotebookSourceCapacityForUser(
	userId: string,
	notebookId: string,
	additional = 1,
) {
	const { plan, limits } = await getUserPlanLimits(userId);
	await assertNotebookSourceCapacity(notebookId, additional, {
		maxSourcesPerNotebook: limits.maxSourcesPerNotebook,
		plan,
	});
}
