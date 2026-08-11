/**
 * Grant or revoke Pro for testing. Not a payment path.
 *
 * Usage:
 *   bun run grant:plan -- --userId user_xxx --plan pro
 *   bun run grant:plan -- --userId user_xxx --plan free
 */

import { config } from "dotenv";

config({ path: ".env.local" });
config();

import { isPlanId, type PlanId } from "#/lib/plans/limits.ts";
import { upsertUserPlan } from "#/lib/plans/plan.server.ts";

function readArg(name: string): string | undefined {
	const idx = process.argv.indexOf(`--${name}`);
	if (idx === -1) return undefined;
	return process.argv[idx + 1];
}

async function main() {
	const userId = readArg("userId");
	const planRaw = readArg("plan");

	if (!userId || !planRaw || !isPlanId(planRaw)) {
		console.error(
			"Usage: bun run grant:plan -- --userId <clerkUserId> --plan free|pro",
		);
		process.exit(1);
	}

	const plan = planRaw as PlanId;
	const result = await upsertUserPlan(userId, plan);
	console.log(`Granted plan "${result.plan}" to ${result.userId}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
