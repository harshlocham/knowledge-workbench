import { markArtifactFailedInStore } from "./artifacts.store.server.ts";

/**
 * Records a generation failure on an artifact. Background generation must never
 * leave an artifact stuck in `pending`, and must never throw into the job
 * runner, so this swallows its own errors.
 *
 * Only `pending` rows are updated — ready artifacts are never overwritten.
 */
export async function markArtifactFailed(artifactId: string, message: string) {
	try {
		await markArtifactFailedInStore(artifactId, message);
	} catch (error) {
		console.error("[artifact] failed to record failure", artifactId, error);
	}
}
