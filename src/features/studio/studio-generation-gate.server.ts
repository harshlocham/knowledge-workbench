import { assertAndConsumeStudioGeneration } from "#/lib/plans/usage.server.ts";

/**
 * Shared Studio generation gate for all four artifact types.
 *
 * Policy: count **accepted generation attempts**. Call after ownership + source
 * pre-validation, before `insertArtifact`. Unauthorized / insufficient-sources /
 * already-at-quota requests must throw before this runs and do not consume a
 * slot. Failures after accept are not refunded (retrieval/LLM cost already
 * incurred; prevents retry abuse).
 */
export async function consumeStudioGenerationSlot(userId: string) {
	return assertAndConsumeStudioGeneration(userId);
}
