import { useBillingOptional } from "#/components/billing/BillingProvider.tsx";
import { Button } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

/** Compact Free / Pro indicator for the app header. */
export function PlanBadge({ className }: { className?: string }) {
	const billing = useBillingOptional();
	if (!billing || billing.loading) return null;

	const label = billing.isPro ? "Pro" : "Free";

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className={cn("h-7 px-2 text-xs font-medium", className)}
			onClick={() => billing.openUpgrade("general_upgrade")}
		>
			{label}
		</Button>
	);
}
