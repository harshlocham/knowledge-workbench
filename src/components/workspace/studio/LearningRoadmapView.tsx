import { ArrowUpRight, Clock } from "lucide-react";

import { MarkdownWithCitations } from "#/components/workspace/MarkdownWithCitations.tsx";
import { ArtifactSectionsView } from "#/components/workspace/studio/ArtifactSectionsView.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type { ArtifactDTO } from "#/features/studio/artifacts.types.ts";

type CitationHandler = (citation: MessageCitation, ownerId: string) => void;

/**
 * Steps store clean prose plus their citation numbers separately, so markers
 * are re-attached here and rendered by the shared markdown renderer.
 */
function withMarkers(text: string, numbers: number[]) {
	return numbers.length > 0
		? `${text} ${numbers.map((n) => `[${n}]`).join(" ")}`
		: text;
}

function StepChip({
	icon: Icon,
	children,
}: {
	icon: typeof Clock;
	children: string;
}) {
	return (
		<span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
			<Icon className="size-3" aria-hidden />
			{children}
		</span>
	);
}

export function LearningRoadmapView({
	artifact,
	activeCitationKey,
	onCitationClick,
}: {
	artifact: ArtifactDTO;
	activeCitationKey: string | null;
	onCitationClick: CitationHandler;
}) {
	const roadmap = artifact.content?.learningRoadmap;

	// Falls back to the generic projection rather than showing an empty document.
	if (!roadmap) {
		return (
			<ArtifactSectionsView
				artifact={artifact}
				activeCitationKey={activeCitationKey}
				onCitationClick={onCitationClick}
			/>
		);
	}

	const sections = artifact.content?.sections ?? [];
	const overview =
		sections.find((section) => section.heading === "Overview")?.body ??
		artifact.content?.summary ??
		"";

	return (
		<div className="flex flex-col gap-6">
			{overview ? (
				<section>
					<h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Overview
					</h4>
					<div className="mt-2">
						<MarkdownWithCitations
							content={overview}
							citations={artifact.citations}
							ownerId={artifact.id}
							activeCitationKey={activeCitationKey}
							onCitationClick={onCitationClick}
							className="text-sm"
						/>
					</div>
				</section>
			) : null}

			<section>
				<h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Your path
				</h4>
				<ol className="mt-2 flex flex-col gap-3">
					{roadmap.steps.map((step) => (
						<li key={step.order} className="kw-card p-4">
							<div className="flex gap-3">
								<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary">
									{step.order}
								</span>
								<div className="min-w-0 flex-1">
									<h5 className="font-[Fraunces,serif] text-base font-semibold text-foreground">
										{step.title}
									</h5>

									{step.prerequisiteSteps?.length || step.estimatedEffort ? (
										<div className="mt-1.5 flex flex-wrap gap-1.5">
											{step.prerequisiteSteps?.length ? (
												<StepChip icon={ArrowUpRight}>
													{`After step ${step.prerequisiteSteps.join(", ")}`}
												</StepChip>
											) : null}
											{step.estimatedEffort ? (
												<StepChip icon={Clock}>{step.estimatedEffort}</StepChip>
											) : null}
										</div>
									) : null}

									<div className="mt-1.5">
										<MarkdownWithCitations
											content={withMarkers(
												step.description,
												step.citationNumbers,
											)}
											citations={artifact.citations}
											ownerId={artifact.id}
											activeCitationKey={activeCitationKey}
											onCitationClick={onCitationClick}
											className="text-sm"
										/>
									</div>

									<p className="mt-2 border-t border-border pt-2 text-sm text-foreground/90">
										<span className="font-medium text-muted-foreground">
											Why it matters:{" "}
										</span>
										{step.whyItMatters}
									</p>
								</div>
							</div>
						</li>
					))}
				</ol>
			</section>
		</div>
	);
}
