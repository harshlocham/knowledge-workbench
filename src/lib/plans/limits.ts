export const PLAN_IDS = ["free", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type PlanLimits = {
	maxNotebooks: number;
	maxSourcesPerNotebook: number;
	monthlyStudioGenerations: number;
};

/**
 * Single source of truth for Free / Pro caps. Never claim unlimited.
 * All enforcement must read from here — do not scatter magic numbers.
 */
export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
	free: {
		maxNotebooks: 2,
		maxSourcesPerNotebook: 10,
		monthlyStudioGenerations: 5,
	},
	pro: {
		maxNotebooks: 20,
		maxSourcesPerNotebook: 50,
		monthlyStudioGenerations: 50,
	},
};

export const PRO_PRICE_LABEL = "$25/month";

export function getPlanLimits(plan: PlanId): PlanLimits {
	return PLAN_LIMITS[plan];
}

/** UTC calendar month key used for Studio generation accounting. */
export function usagePeriodUtc(date: Date = new Date()): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	return `${year}-${month}`;
}

export function isPlanId(value: unknown): value is PlanId {
	return value === "free" || value === "pro";
}

/** Pure gate used by notebook create and unit tests. */
export function assertNotebookCountAllowed(
	currentCount: number,
	limit: number,
	plan: PlanId,
) {
	if (currentCount >= limit) {
		const label = plan === "free" ? "Free" : "Pro";
		throw new Error(
			`You've reached the ${label} plan limit of ${limit} notebooks.`,
		);
	}
}

/** Pure gate used by source create and unit tests. */
export function assertSourceCountAllowed(
	currentCount: number,
	additional: number,
	limit: number,
	plan: PlanId,
) {
	if (currentCount + additional > limit) {
		const label = plan === "free" ? "Free" : "Pro";
		if (plan === "free") {
			throw new Error(`${label} allows up to ${limit} sources per notebook.`);
		}
		const remaining = Math.max(0, limit - currentCount);
		throw new Error(
			remaining === 0
				? `This notebook already has ${limit} sources. Delete some before adding more.`
				: `Only ${remaining} source slot${remaining === 1 ? "" : "s"} left in this notebook, but this request needs ${additional}.`,
		);
	}
}

/**
 * Pure predicate for the atomic usage upsert. Simulates: increment only when
 * quantity < limit. Used by unit tests for concurrent consume semantics.
 */
export function tryConsumeUsage(
	currentQuantity: number,
	limit: number,
): { ok: true; next: number } | { ok: false; next: number } {
	if (currentQuantity >= limit) {
		return { ok: false, next: currentQuantity };
	}
	return { ok: true, next: currentQuantity + 1 };
}

/** Pure Pro gate used by share/export checks and unit tests. */
export function assertPlanIsPro(plan: PlanId, featureLabel = "This feature") {
	if (plan !== "pro") {
		throw new Error(
			`${featureLabel} is available on Pro. Join the waitlist to unlock Research Studio export and sharing.`,
		);
	}
}
