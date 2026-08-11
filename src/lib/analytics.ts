/**
 * Lightweight funnel events. No vendor yet — safe no-op with optional DEV log.
 * Do not pass PII (emails, tokens, source contents).
 */

export type AnalyticsEvent =
	| "landing_view"
	| "landing_cta_click"
	| "signup_started"
	| "notebook_created"
	| "source_added"
	| "first_source_ready"
	| "first_question"
	| "studio_opened"
	| "artifact_generated"
	| "upgrade_viewed"
	| "upgrade_intent"
	| "share_clicked"
	| "export_clicked";

export type AnalyticsProps = Record<
	string,
	string | number | boolean | undefined
>;

export function track(event: AnalyticsEvent, props?: AnalyticsProps) {
	if (import.meta.env.DEV) {
		console.debug(`[analytics] ${event}`, props ?? {});
	}
	// Vendor hook: replace this body when PostHog/Plausible/etc. is added.
}
