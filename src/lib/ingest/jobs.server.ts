/**
 * Fire-and-forget background work after the HTTP response returns.
 * Same-process only (no Redis/Bull). Survives the request via a detached promise.
 */
export function enqueueBackgroundJob(name: string, job: () => Promise<void>) {
	setTimeout(() => {
		void job().catch((error) => {
			console.error(`[bg:${name}]`, error);
		});
	}, 0);
}
