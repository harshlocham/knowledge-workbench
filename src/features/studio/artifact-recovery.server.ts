import { and, eq, lte } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { artifacts } from "#/db/schema/artifacts.ts";
import type { ArtifactStatus } from "./artifacts.types.ts";

/**
 * Pending artifacts older than this are treated as abandoned (process restart /
 * lost in-process job). Same-process `enqueueBackgroundJob` cannot recover them
 * alone — a durable queue is a post-sprint improvement if multi-instance deploys
 * need stronger guarantees.
 */
export const STALE_PENDING_TIMEOUT_MS = 15 * 60 * 1000;

export const STALE_PENDING_ERROR =
	"Generation timed out. Please try again." as const;

/**
 * Pure gate used by recovery and unit tests. Ready/failed rows never qualify.
 */
export function isStalePending(
	status: ArtifactStatus,
	createdAt: Date,
	now: Date = new Date(),
	timeoutMs: number = STALE_PENDING_TIMEOUT_MS,
): boolean {
	if (status !== "pending") return false;
	return now.getTime() - createdAt.getTime() >= timeoutMs;
}

/**
 * Marks abandoned `pending` artifacts as `failed`. Idempotent: already-settled
 * rows are never updated. Does not use Clerk — safe from background/read paths.
 */
export async function recoverStalePendingArtifacts(
	now: Date = new Date(),
): Promise<{ recoveredIds: string[] }> {
	const cutoff = new Date(now.getTime() - STALE_PENDING_TIMEOUT_MS);

	const rows = await db
		.update(artifacts)
		.set({
			status: "failed",
			errorMessage: STALE_PENDING_ERROR,
			updatedAt: now,
		})
		.where(
			and(eq(artifacts.status, "pending"), lte(artifacts.createdAt, cutoff)),
		)
		.returning({ id: artifacts.id });

	return { recoveredIds: rows.map((row) => row.id) };
}

/** Test helper: which synthetic rows would the recovery UPDATE select? */
export function selectStalePendingIds(
	rows: Array<{ id: string; status: ArtifactStatus; createdAt: Date }>,
	now: Date = new Date(),
	timeoutMs: number = STALE_PENDING_TIMEOUT_MS,
): string[] {
	return rows
		.filter((row) => isStalePending(row.status, row.createdAt, now, timeoutMs))
		.map((row) => row.id);
}
