import { useServerFn } from "@tanstack/react-start";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";

import { UpgradeModal } from "#/components/billing/UpgradeModal.tsx";
import type { UpgradeIntentSource } from "#/db/schema/upgrade-intents.ts";
import {
	type BillingSummary,
	getBillingSummary,
} from "#/features/billing/billing.functions.ts";
import { track } from "#/lib/analytics.ts";

type BillingContextValue = {
	summary: BillingSummary | null;
	loading: boolean;
	refresh: () => Promise<void>;
	openUpgrade: (source: UpgradeIntentSource) => void;
	isPro: boolean;
};

const BillingContext = createContext<BillingContextValue | null>(null);

export function BillingProvider({ children }: { children: ReactNode }) {
	const getSummaryFn = useServerFn(getBillingSummary);
	const [summary, setSummary] = useState<BillingSummary | null>(null);
	const [loading, setLoading] = useState(true);
	const [upgradeOpen, setUpgradeOpen] = useState(false);
	const [upgradeSource, setUpgradeSource] =
		useState<UpgradeIntentSource>("general_upgrade");

	const refresh = useCallback(async () => {
		try {
			const next = await getSummaryFn();
			setSummary(next);
		} catch {
			setSummary(null);
		} finally {
			setLoading(false);
		}
	}, [getSummaryFn]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const openUpgrade = useCallback((source: UpgradeIntentSource) => {
		track("upgrade_viewed", { source });
		setUpgradeSource(source);
		setUpgradeOpen(true);
	}, []);

	const isPro = summary?.plan === "pro";

	return (
		<BillingContext.Provider
			value={{ summary, loading, refresh, openUpgrade, isPro }}
		>
			{children}
			<UpgradeModal
				open={upgradeOpen}
				onOpenChange={setUpgradeOpen}
				source={upgradeSource}
				isPro={isPro}
			/>
		</BillingContext.Provider>
	);
}

export function useBilling() {
	const ctx = useContext(BillingContext);
	if (!ctx) {
		throw new Error("useBilling must be used within BillingProvider");
	}
	return ctx;
}

/** Safe for surfaces that may render outside the provider (e.g. public share). */
export function useBillingOptional() {
	return useContext(BillingContext);
}
