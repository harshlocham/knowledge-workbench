import { AlertTriangle, ListChecks, TerminalSquare } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import { MarkdownWithCitations } from "#/components/workspace/MarkdownWithCitations.tsx";
import { ArtifactSectionsView } from "#/components/workspace/studio/ArtifactSectionsView.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type {
	ArtifactDTO,
	StudyGuideCitedItem,
	StudyGuideReviewQuestion,
} from "#/features/studio/artifacts.types.ts";

type CitationHandler = (citation: MessageCitation, ownerId: string) => void;

/**
 * The typed payload stores clean prose plus the citation numbers separately, so
 * markers are re-attached here and rendered by the shared markdown renderer.
 */
function withMarkers(text: string, numbers: number[]) {
	return numbers.length > 0
		? `${text} ${numbers.map((n) => `[${n}]`).join(" ")}`
		: text;
}

function SectionLabel({ children }: { children: string }) {
	return (
		<h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
			{children}
		</h4>
	);
}

function CitedProse({
	text,
	citationNumbers,
	artifact,
	activeCitationKey,
	onCitationClick,
}: {
	text: string;
	citationNumbers: number[];
	artifact: ArtifactDTO;
	activeCitationKey: string | null;
	onCitationClick: CitationHandler;
}) {
	return (
		<MarkdownWithCitations
			content={withMarkers(text, citationNumbers)}
			citations={artifact.citations}
			ownerId={artifact.id}
			activeCitationKey={activeCitationKey}
			onCitationClick={onCitationClick}
			className="text-sm"
		/>
	);
}

function CitedItemList({
	items,
	icon: Icon,
	iconClassName,
	artifact,
	activeCitationKey,
	onCitationClick,
}: {
	items: StudyGuideCitedItem[];
	icon?: typeof AlertTriangle;
	iconClassName?: string;
	artifact: ArtifactDTO;
	activeCitationKey: string | null;
	onCitationClick: CitationHandler;
}) {
	return (
		<ul className="mt-2 flex flex-col gap-2.5">
			{items.map((item) => (
				<li
					key={item.title}
					className="flex gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5"
				>
					{Icon ? (
						<Icon className={`mt-0.5 size-4 shrink-0 ${iconClassName ?? ""}`} />
					) : null}
					<div className="min-w-0">
						<p className="text-sm font-semibold text-foreground">
							{item.title}
						</p>
						<CitedProse
							text={item.explanation}
							citationNumbers={item.citationNumbers}
							artifact={artifact}
							activeCitationKey={activeCitationKey}
							onCitationClick={onCitationClick}
						/>
					</div>
				</li>
			))}
		</ul>
	);
}

/** An exercise, not a paragraph: the answer stays hidden until asked for. */
function ReviewQuestion({
	item,
	position,
	artifact,
	activeCitationKey,
	onCitationClick,
}: {
	item: StudyGuideReviewQuestion;
	position: number;
	artifact: ArtifactDTO;
	activeCitationKey: string | null;
	onCitationClick: CitationHandler;
}) {
	const [revealed, setRevealed] = useState(false);

	return (
		<li className="rounded-lg border border-border bg-card px-3 py-2.5">
			<div className="flex gap-2.5">
				<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
					{position}
				</span>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium text-foreground">{item.question}</p>
					{revealed ? (
						<div className="mt-1.5 border-l-2 border-primary/40 pl-3">
							<CitedProse
								text={item.answer}
								citationNumbers={item.citationNumbers}
								artifact={artifact}
								activeCitationKey={activeCitationKey}
								onCitationClick={onCitationClick}
							/>
						</div>
					) : (
						<Button
							type="button"
							variant="ghost"
							size="xs"
							className="mt-1 -ml-2 text-muted-foreground"
							onClick={() => setRevealed(true)}
						>
							Show answer
						</Button>
					)}
				</div>
			</div>
		</li>
	);
}

export function StudyGuideView({
	artifact,
	activeCitationKey,
	onCitationClick,
}: {
	artifact: ArtifactDTO;
	activeCitationKey: string | null;
	onCitationClick: CitationHandler;
}) {
	const guide = artifact.content?.studyGuide;

	// Falls back to the generic projection rather than showing an empty document.
	if (!guide) {
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

	const shared = { artifact, activeCitationKey, onCitationClick };

	return (
		<div className="flex flex-col gap-6">
			{overview ? (
				<section>
					<SectionLabel>Overview</SectionLabel>
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

			{guide.prerequisites.length > 0 ? (
				<section>
					<SectionLabel>Prerequisites</SectionLabel>
					<CitedItemList
						items={guide.prerequisites}
						icon={ListChecks}
						iconClassName="text-muted-foreground"
						{...shared}
					/>
				</section>
			) : null}

			{guide.concepts.length > 0 ? (
				<section>
					<SectionLabel>Core Concepts</SectionLabel>
					<div className="mt-2 flex flex-col gap-3">
						{guide.concepts.map((concept, index) => (
							<article key={concept.name} className="kw-card p-4">
								<div className="flex items-baseline gap-2">
									<span className="text-xs font-semibold text-primary">
										{String(index + 1).padStart(2, "0")}
									</span>
									<h5 className="font-[Fraunces,serif] text-base font-semibold text-foreground">
										{concept.name}
									</h5>
								</div>
								<div className="mt-1">
									<CitedProse
										text={concept.explanation}
										citationNumbers={concept.citationNumbers}
										{...shared}
									/>
								</div>
								{concept.keyPoints.length > 0 ? (
									<ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
										{concept.keyPoints.map((point) => (
											<li
												key={point}
												className="flex gap-2 text-sm text-foreground/90"
											>
												<span aria-hidden className="text-primary">
													·
												</span>
												<span>{point}</span>
											</li>
										))}
									</ul>
								) : null}
							</article>
						))}
					</div>
				</section>
			) : null}

			{guide.examples.length > 0 ? (
				<section>
					<SectionLabel>Worked Examples</SectionLabel>
					<CitedItemList
						items={guide.examples}
						icon={TerminalSquare}
						iconClassName="text-primary"
						{...shared}
					/>
				</section>
			) : null}

			{guide.pitfalls.length > 0 ? (
				<section>
					<SectionLabel>Common Pitfalls</SectionLabel>
					<CitedItemList
						items={guide.pitfalls}
						icon={AlertTriangle}
						iconClassName="text-destructive"
						{...shared}
					/>
				</section>
			) : null}

			{guide.reviewQuestions.length > 0 ? (
				<section>
					<SectionLabel>Review Questions</SectionLabel>
					<ul className="mt-2 flex flex-col gap-2">
						{guide.reviewQuestions.map((item, index) => (
							<ReviewQuestion
								key={item.question}
								item={item}
								position={index + 1}
								{...shared}
							/>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}
