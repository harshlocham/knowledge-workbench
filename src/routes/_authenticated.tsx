import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { BillingProvider } from "#/components/billing/BillingProvider.tsx";
import { TooltipProvider } from "#/components/ui/tooltip.tsx";
import { getAuthSession } from "#/features/notebooks/notebooks.functions.ts";

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async () => {
		const { userId } = await getAuthSession();

		if (!userId) {
			throw redirect({ to: "/" });
		}

		return { userId };
	},
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	return (
		<TooltipProvider delayDuration={300}>
			<BillingProvider>
				<div className="flex min-h-dvh flex-col bg-background">
					<main className="flex min-h-0 flex-1 flex-col">
						<Outlet />
					</main>
				</div>
			</BillingProvider>
		</TooltipProvider>
	);
}
