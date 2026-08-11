import { assertAndConsumeStudioGeneration } from "#/lib/plans/usage.server.ts";

/**
 * Shared Studio generation gate for all four artifact types.
 * Call after ownership + source pre-validation, before insertArtifact.
 */
export async function consumeStudioGenerationSlot(userId: string) {
	return assertAndConsumeStudioGeneration(userId);
}
