import { MarkdownWithCitations } from "#/components/workspace/MarkdownWithCitations.tsx";
import { ArtifactSectionsView } from "#/components/workspace/studio/ArtifactSectionsView.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type {
	ArtifactDTO,
	CompareCitedItem,
} from "#/features/studio/artifacts.types.ts";

type CitationHandler = (citation: MessageCitation, ownerId: string) => void;

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

/**
 * Shows which sources support a claim, using citation metadata rather than
 * numbers alone — the whole point of a comparison is source identity.
 */
function SupportingSources({
	citationNumbers,
	citations,
}: {
	citationNumbers: number[];
	citations: MessageCitation[];
}) {
	const titles = [
		...new Map(
			citationNumbers.flatMap((number) => {
				const citation = citations.find(
					(item) => (item.citationNumber ?? 0) === number,
				);
				if (!citation) return [];
				return [
					[
						citation.sourceId,
						citation.sourceTitle?.trim() || "Untitled source",
					] as const,
				];
			}),
		).values(),
	];

	if (titles.length === 0) return null;

	return (
		<p className="mt-1.5 text-[11px] text-muted-foreground">
			{titles.join(" · ")}
		</p>
	);
}

function ClaimList({
	items,
	artifact,
	activeCitationKey,
	onCitationClick,
}: {
	items: CompareCitedItem[];
	artifact: ArtifactDTO;
	activeCitationKey: string | null;
	onCitationClick: CitationHandler;
}) {
	return (
		<ul className="mt-2 flex flex-col gap-2.5">
			{items.map((item) => (
				<li
					key={`${item.text.slice(0, 48)}-${item.citationNumbers.join(",")}`}
					className="rounded-lg border border-border bg-card px-3 py-2.5"
				>
					<CitedProse
						text={item.text}
						citationNumbers={item.citationNumbers}
						artifact={artifact}
						activeCitationKey={activeCitationKey}
						onCitationClick={onCitationClick}
					/>
					<SupportingSources
						citationNumbers={item.citationNumbers}
						citations={artifact.citations}
					/>
				</li>
			))}
		</ul>
	);
}

export function CompareSourcesView({
	artifact,
	activeCitationKey,
	onCitationClick,
}: {
	artifact: ArtifactDTO;
	activeCitationKey: string | null;
	onCitationClick: CitationHandler;
}) {
	const compare = artifact.content?.compareSources;

	if (!compare) {
		return (
			<ArtifactSectionsView
				artifact={artifact}
				activeCitationKey={activeCitationKey}
				onCitationClick={onCitationClick}
			/>
		);
	}

	const sourceColumns = [
		...new Map(
			compare.comparisonTable.flatMap((row) =>
				row.entries.map(
					(entry) => [entry.sourceId, entry.sourceTitle] as const,
				),
			),
		).entries(),
	];

	return (
		<div className="flex flex-col gap-6">
			<section>
				<SectionLabel>Overview</SectionLabel>
				<div className="mt-2">
					<CitedProse
						text={compare.overview}
						citationNumbers={
							artifact.content?.sections.find(
								(section) => section.heading === "Overview",
							)?.citationNumbers ?? []
						}
						artifact={artifact}
						activeCitationKey={activeCitationKey}
						onCitationClick={onCitationClick}
					/>
				</div>
			</section>

			{compare.sharedUnderstanding.length > 0 ? (
				<section>
					<SectionLabel>Shared Understanding</SectionLabel>
					<ClaimList
						items={compare.sharedUnderstanding}
						artifact={artifact}
						activeCitationKey={activeCitationKey}
						onCitationClick={onCitationClick}
					/>
				</section>
			) : null}

			{compare.agreements.length > 0 ? (
				<section>
					<SectionLabel>Areas of Agreement</SectionLabel>
					<ClaimList
						items={compare.agreements}
						artifact={artifact}
						activeCitationKey={activeCitationKey}
						onCitationClick={onCitationClick}
					/>
				</section>
			) : null}

			{compare.disagreements.length > 0 ? (
				<section>
					<SectionLabel>Areas of Disagreement</SectionLabel>
					<ClaimList
						items={compare.disagreements}
						artifact={artifact}
						activeCitationKey={activeCitationKey}
						onCitationClick={onCitationClick}
					/>
				</section>
			) : null}

			{compare.sourceSpecificInsights.some(
				(insight) => insight.items.length > 0,
			) ? (
				<section>
					<SectionLabel>Source-Specific Insights</SectionLabel>
					<div className="mt-2 flex flex-col gap-4">
						{compare.sourceSpecificInsights.map((insight) =>
							insight.items.length === 0 ? null : (
								<div key={insight.sourceId}>
									<p className="text-sm font-semibold text-foreground">
										{insight.sourceTitle}
									</p>
									<ul className="mt-1.5 flex flex-col gap-2">
										{insight.items.map((item) => (
											<li
												key={`${insight.sourceId}-${item.text.slice(0, 48)}`}
												className="rounded-lg border border-border bg-card px-3 py-2.5"
											>
												<CitedProse
													text={item.text}
													citationNumbers={item.citationNumbers}
													artifact={artifact}
													activeCitationKey={activeCitationKey}
													onCitationClick={onCitationClick}
												/>
											</li>
										))}
									</ul>
								</div>
							),
						)}
					</div>
				</section>
			) : null}

			{compare.comparisonTable.length > 0 && sourceColumns.length > 0 ? (
				<section>
					<SectionLabel>Evidence Comparison</SectionLabel>
					<div className="mt-2 overflow-x-auto rounded-lg border border-border">
						<table className="w-full min-w-[32rem] border-collapse text-left text-sm">
							<thead>
								<tr className="border-b border-border bg-muted/40">
									<th className="px-3 py-2 font-semibold text-foreground">
										Claim
									</th>
									{sourceColumns.map(([sourceId, title]) => (
										<th
											key={sourceId}
											className="px-3 py-2 font-semibold text-foreground"
										>
											{title}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{compare.comparisonTable.map((row) => {
									const bySource = new Map(
										row.entries.map((entry) => [entry.sourceId, entry]),
									);
									return (
										<tr
											key={row.claim}
											className="border-b border-border last:border-b-0 align-top"
										>
											<td className="px-3 py-2.5 font-medium text-foreground">
												{row.claim}
											</td>
											{sourceColumns.map(([sourceId]) => {
												const entry = bySource.get(sourceId);
												return (
													<td key={sourceId} className="px-3 py-2.5">
														{entry ? (
															<CitedProse
																text={entry.position}
																citationNumbers={entry.citationNumbers}
																artifact={artifact}
																activeCitationKey={activeCitationKey}
																onCitationClick={onCitationClick}
															/>
														) : (
															<span className="text-muted-foreground">—</span>
														)}
													</td>
												);
											})}
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</section>
			) : null}

			{compare.conclusion.length > 0 ? (
				<section>
					<SectionLabel>Conclusion</SectionLabel>
					<ClaimList
						items={compare.conclusion}
						artifact={artifact}
						activeCitationKey={activeCitationKey}
						onCitationClick={onCitationClick}
					/>
				</section>
			) : null}
		</div>
	);
}
