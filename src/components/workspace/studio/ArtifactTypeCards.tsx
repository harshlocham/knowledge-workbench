import {
	FileText,
	GitCompare,
	GraduationCap,
	LoaderCircle,
	type LucideIcon,
	Route,
	Sparkles,
} from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import type { ArtifactType } from "#/features/studio/artifacts.types.ts";

/** The artifact types the Studio can generate today. */
export type StudioArtifactType =
	| "research_brief"
	| "study_guide"
	| "learning_roadmap"
	| "compare_sources";

/** Pure UI gate — server still enforces ≥2 ready sources authoritatively. */
export function compareSourcesNeedsMoreSources(readyCount: number) {
	return readyCount < 2;
}

type CardCopy = {
	icon: LucideIcon;
	title: string;
	description: string;
};

/** `available` doubles as the discriminant that proves a card is generatable. */
type CardSpec = CardCopy &
	(
		| { type: StudioArtifactType; available: true }
		| { type: ArtifactType; available: false }
	);

const CARDS: CardSpec[] = [
	{
		type: "research_brief",
		icon: FileText,
		title: "Research Brief",
		description:
			"Understand the key findings, evidence, agreements and open questions.",
		available: true,
	},
	{
		type: "study_guide",
		icon: GraduationCap,
		title: "Study Guide",
		description: "Turn your sources into a structured learning guide.",
		available: true,
	},
	{
		type: "learning_roadmap",
		icon: Route,
		title: "Learning Roadmap",
		description:
			"Sequence your sources into an ordered path from fundamentals to advanced.",
		available: true,
	},
	{
		type: "compare_sources",
		icon: GitCompare,
		title: "Compare Sources",
		description:
			"See where your sources agree, differ and fill each other's gaps.",
		available: true,
	},
];

export function ArtifactTypeCards({
	readyCount,
	generatingType,
	pendingTypes,
	disabled,
	onGenerate,
}: {
	readyCount: number;
	generatingType: StudioArtifactType | null;
	/** Types with an artifact already generating in the background. */
	pendingTypes: Set<ArtifactType>;
	/** Global disable (e.g. zero ready sources, or a create request in flight). */
	disabled: boolean;
	onGenerate: (type: StudioArtifactType) => void;
}) {
	const compareNeedsMore = compareSourcesNeedsMoreSources(readyCount);

	return (
		<div className="grid gap-3 sm:grid-cols-2">
			{CARDS.map((card) => {
				const Icon = card.icon;
				const isBusy =
					card.available &&
					(generatingType === card.type || pendingTypes.has(card.type));
				const compareBlocked =
					card.available && card.type === "compare_sources" && compareNeedsMore;
				const cardDisabled = disabled || isBusy || compareBlocked;

				return (
					<article
						key={card.type}
						className={
							card.available
								? "kw-card flex flex-col p-4"
								: "flex flex-col rounded-lg border border-dashed border-border bg-card/50 p-4"
						}
					>
						<div className="flex items-center gap-2">
							<Icon
								className={
									card.available
										? "size-4 text-primary"
										: "size-4 text-muted-foreground"
								}
								aria-hidden
							/>
							<h3 className="font-[Fraunces,serif] text-base font-semibold text-foreground">
								{card.title}
							</h3>
							{card.available ? null : (
								<span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
									Coming soon
								</span>
							)}
						</div>

						<p className="mt-1.5 flex-1 text-xs text-muted-foreground">
							{card.description}
						</p>

						{card.available ? (
							<>
								{compareBlocked ? (
									<p className="mt-2 text-xs text-muted-foreground">
										Requires 2+ ready sources
									</p>
								) : null}
								<Button
									type="button"
									size="sm"
									className="mt-3 self-start"
									disabled={cardDisabled}
									onClick={() => onGenerate(card.type)}
								>
									{isBusy ? (
										<LoaderCircle className="animate-spin" />
									) : (
										<Sparkles />
									)}
									{isBusy ? "Generating…" : "Generate"}
								</Button>
							</>
						) : null}
					</article>
				);
			})}
		</div>
	);
}
