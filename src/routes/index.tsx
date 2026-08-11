import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { AppHeader } from "#/components/app-header.tsx";
import { BillingProvider } from "#/components/billing/BillingProvider.tsx";
import { LandingPage } from "#/components/landing/LandingPage.tsx";
import { getAuthSession } from "#/features/notebooks/notebooks.functions.ts";
import { track } from "#/lib/analytics.ts";

export const Route = createFileRoute("/")({
	loader: () => getAuthSession(),
	component: HomePage,
});

function HomePage() {
	useEffect(() => {
		track("landing_view");
	}, []);

	return (
		<BillingProvider>
			<div className="min-h-dvh bg-background">
				<AppHeader />
				<main>
					<LandingPage />
				</main>
			</div>
		</BillingProvider>
	);
}
