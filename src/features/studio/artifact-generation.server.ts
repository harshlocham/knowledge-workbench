import {
	getArtifactRowById,
	updateArtifactById,
} from "./artifacts.store.server.ts";

/**
 * Records a generation failure on an artifact. Background generation must never
 * leave an artifact stuck in `pending`, and must never throw into the job
 * runner, so this swallows its own errors.
 */
export async function markArtifactFailed(artifactId: string, message: string) {
	try {
		const row = await getArtifactRowById(artifactId);
		if (!row) return;

		await updateArtifactById(
			artifactId,
			{ status: "failed", errorMessage: message },
			row,
		);
	} catch (error) {
		console.error("[artifact] failed to record failure", artifactId, error);
	}
}
