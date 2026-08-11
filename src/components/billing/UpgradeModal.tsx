import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog.tsx";
import type { UpgradeIntentSource } from "#/db/schema/upgrade-intents.ts";
import { joinProWaitlist } from "#/features/billing/billing.functions.ts";
import { PRO_PRICE_LABEL } from "#/lib/plans/limits.ts";

const PRO_FEATURES = [
	"Research Brief",
	"Study Guide",
	"Learning Roadmap",
	"Compare Sources",
	"Export & Share",
	"Higher usage limits",
] as const;

export function UpgradeModal({
	open,
	onOpenChange,
	source,
	isPro = false,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	source: UpgradeIntentSource;
	isPro?: boolean;
}) {
	const joinFn = useServerFn(joinProWaitlist);
	const [joining, setJoining] = useState(false);
	const [joined, setJoined] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleJoin() {
		setJoining(true);
		setError(null);
		try {
			await joinFn({ data: { source } });
			setJoined(true);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Could not join the waitlist",
			);
		} finally {
			setJoining(false);
		}
	}

	function handleOpenChange(next: boolean) {
		if (!next) {
			setJoined(false);
			setError(null);
		}
		onOpenChange(next);
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Unlock Research Studio</DialogTitle>
					<DialogDescription>
						{isPro
							? "You already have Pro access on this account."
							: `Pro is ${PRO_PRICE_LABEL}. Join the early-access list — payment is not collected yet.`}
					</DialogDescription>
				</DialogHeader>

				<ul className="flex flex-col gap-2 text-sm text-foreground">
					{PRO_FEATURES.map((feature) => (
						<li key={feature} className="flex items-center gap-2">
							<Check className="size-4 shrink-0 text-primary" aria-hidden />
							{feature}
						</li>
					))}
				</ul>

				{joined ? (
					<p className="text-sm text-muted-foreground">
						You're on the early-access list.
					</p>
				) : null}
				{error ? <p className="text-sm text-destructive">{error}</p> : null}

				<DialogFooter>
					{isPro ? (
						<Button type="button" onClick={() => handleOpenChange(false)}>
							Close
						</Button>
					) : joined ? (
						<Button type="button" onClick={() => handleOpenChange(false)}>
							Done
						</Button>
					) : (
						<>
							<Button
								type="button"
								variant="outline"
								onClick={() => handleOpenChange(false)}
							>
								Maybe later
							</Button>
							<Button
								type="button"
								onClick={() => void handleJoin()}
								disabled={joining}
							>
								{joining ? "Joining…" : "Join Pro waitlist"}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
