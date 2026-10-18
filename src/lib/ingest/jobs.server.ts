/**
 * Fire-and-forget background work after the HTTP response returns.
 * Same-process only (no Redis/Bull). Survives the request via a detached promise.
 *
 * Process restarts can abandon Studio jobs left in `pending` — see
 * `recoverStalePendingArtifacts` for the sprint-safe timeout recovery path.
 */
export function enqueueBackgroundJob(name: string, job: () => Promise<void>) {
	setTimeout(() => {
		void job().catch((error) => {
			console.error(`[bg:${name}]`, error);
		});
	}, 0);
}
