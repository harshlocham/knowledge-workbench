import { Show, SignInButton, useAuth } from "@clerk/tanstack-react-start";
import {
	BookOpen,
	FileText,
	GitCompare,
	GraduationCap,
	Route,
} from "lucide-react";

import { useBillingOptional } from "#/components/billing/BillingProvider.tsx";
import { LandingCta } from "#/components/landing/LandingCta.tsx";
import { LandingProductMock } from "#/components/landing/LandingProductMock.tsx";
import { Button } from "#/components/ui/button.tsx";
import { track } from "#/lib/analytics.ts";
import { PLAN_LIMITS, PRO_PRICE_LABEL } from "#/lib/plans/limits.ts";

const STUDIO_CARDS = [
	{
		icon: FileText,
		title: "Research Brief",
		description:
			"Turn a collection of technical sources into a cited research summary.",
	},
	{
		icon: GraduationCap,
		title: "Study Guide",
		description:
			"Extract concepts, prerequisites, examples, pitfalls, and review questions.",
	},
	{
		icon: Route,
		title: "Learning Roadmap",
		description:
			"Turn scattered material into a structured path from foundations to advanced topics.",
	},
	{
		icon: GitCompare,
		title: "Compare Sources",
		description:
			"See where sources agree, disagree, and contribute something unique.",
	},
] as const;

const HOW_STEPS = [
	{
		n: "01",
		title: "Add your sources",
		body: "Drop in docs, PDFs, articles, transcripts, and YouTube videos.",
	},
	{
		n: "02",
		title: "Ask grounded questions",
		body: "Get answers based on your notebook instead of generic model knowledge.",
	},
	{
		n: "03",
		title: "Generate Research Studio artifacts",
		body: "Create a roadmap, study guide, research brief, or source comparison.",
	},
	{
		n: "04",
		title: "Follow the evidence",
		body: "Click a citation to jump back to the exact source passage.",
	},
] as const;

const FAQ = [
	{
		q: "What sources can I use?",
		a: "PDFs, plain text, website URLs, YouTube videos, and VTT transcripts — collected in a notebook.",
	},
	{
		q: "How do citations work?",
		a: "Grounded answers and Studio artifacts keep citation numbers attached. Click one to open the source at the page, timestamp, or section when available.",
	},
	{
		q: "Is this ChatGPT?",
		a: "No. You work inside a notebook of your sources. Answers are grounded in that material and keep evidence attached — not a generic chat window.",
	},
	{
		q: "Does it work with YouTube?",
		a: "Yes. Import a video (or playlist), index the transcript, ask questions, and jump to timestamps from citations.",
	},
	{
		q: "Can I share research?",
		a: "Pro early access includes read-only artifact share links. Sharing is opt-in; notebooks stay private by default.",
	},
	{
		q: "How much does Pro cost?",
		a: `${PRO_PRICE_LABEL}. Payment is not collected yet — join the Pro early-access waitlist.`,
	},
	{
		q: "Is my data private?",
		a: "Notebooks are owned by your account. Public artifact links only appear when you create a share link. We do not claim SOC 2 or zero-retention encryption here.",
	},
] as const;

function SectionHeading({
	eyebrow,
	title,
	description,
}: {
	eyebrow?: string;
	title: string;
	description?: string;
}) {
	return (
		<div className="mx-auto max-w-2xl text-center">
			{eyebrow ? (
				<p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
					{eyebrow}
				</p>
			) : null}
			<h2 className="mt-2 font-[Fraunces,serif] text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
				{title}
			</h2>
			{description ? (
				<p className="mt-3 text-base text-muted-foreground sm:text-lg">
					{description}
				</p>
			) : null}
		</div>
	);
}

function PricingCtas() {
	const billing = useBillingOptional();
	const { isSignedIn } = useAuth();

	function joinEarlyAccess() {
		track("landing_cta_click", { source: "pricing", label: "early_access" });
		if (isSignedIn && billing && !billing.isPro) {
			track("upgrade_viewed", { source: "landing" });
			billing.openUpgrade("landing");
			return;
		}
	}

	return (
		<div className="mt-6 flex flex-wrap items-center justify-center gap-3">
			<Show when="signed-in">
				{billing?.isPro ? (
					<LandingCta label="Open notebooks" source="pricing" />
				) : (
					<Button type="button" onClick={joinEarlyAccess}>
						Join Pro early access
					</Button>
				)}
			</Show>
			<Show when="signed-out">
				<SignInButton
					mode="modal"
					forceRedirectUrl="/notebooks"
					fallbackRedirectUrl="/notebooks"
				>
					<Button
						type="button"
						onClick={() => {
							track("signup_started", { source: "pricing" });
							track("landing_cta_click", {
								source: "pricing",
								label: "early_access",
							});
						}}
					>
						Join Pro early access
					</Button>
				</SignInButton>
			</Show>
			<LandingCta
				label="Start free"
				variant="outline"
				source="pricing_secondary"
			/>
		</div>
	);
}

/** Full marketing page body (header provided by the route). */
export function LandingPage() {
	const free = PLAN_LIMITS.free;
	const pro = PLAN_LIMITS.pro;

	return (
		<div className="relative overflow-hidden">
			{/* Atmosphere */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] bg-[radial-gradient(ellipse_at_top,color-mix(in_oklab,var(--lagoon)_18%,transparent),transparent_55%)]"
			/>

			{/* Hero */}
			<section className="relative mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:py-20">
				<div>
					<p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
						Knowledge Workbench
					</p>
					<h1 className="mt-3 font-[Fraunces,serif] text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-[3.25rem] lg:leading-[1.1]">
						Turn technical docs and courses into a learning system.
					</h1>
					<p className="mt-5 max-w-xl text-lg text-muted-foreground">
						Research, learn, and compare technical material in one grounded
						workspace — with citations that take you directly back to the
						source.
					</p>
					<div className="mt-8 flex flex-wrap items-center gap-3">
						<LandingCta size="lg" source="hero" />
						<Button
							type="button"
							variant="outline"
							size="lg"
							onClick={() => {
								track("landing_cta_click", {
									source: "hero",
									label: "see_how",
								});
								document
									.getElementById("how-it-works")
									?.scrollIntoView({ behavior: "smooth", block: "start" });
							}}
						>
							See how it works
						</Button>
					</div>
					<p className="mt-4 max-w-lg text-sm text-muted-foreground">
						Bring your PDFs, documentation, articles, and YouTube courses into
						one notebook. Ask grounded questions, generate roadmaps and study
						guides, and keep every claim near its evidence.
					</p>
				</div>
				<LandingProductMock />
			</section>

			{/* Problem */}
			<section className="border-t border-border bg-muted/30 py-16 sm:py-20">
				<div className="mx-auto max-w-6xl px-4 sm:px-6">
					<SectionHeading title="Technical learning is fragmented." />
					<ul className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-2">
						{[
							"Documentation in one tab",
							"YouTube course in another",
							"PDFs somewhere else",
							"Notes scattered across apps",
							"Chat answers without reliable source context",
						].map((item) => (
							<li
								key={item}
								className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground"
							>
								{item}
							</li>
						))}
					</ul>
					<p className="mx-auto mt-8 max-w-2xl text-center text-base text-muted-foreground">
						Knowledge Workbench connects the material and keeps the evidence
						attached.
					</p>
				</div>
			</section>

			{/* How it works */}
			<section id="how-it-works" className="scroll-mt-20 py-16 sm:py-20">
				<div className="mx-auto max-w-6xl px-4 sm:px-6">
					<SectionHeading
						eyebrow="How it works"
						title="From sources to something you can learn from"
					/>
					<ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
						{HOW_STEPS.map((step) => (
							<li key={step.n} className="kw-card p-5">
								<p className="font-mono text-xs font-semibold text-primary">
									{step.n}
								</p>
								<h3 className="mt-2 font-[Fraunces,serif] text-lg font-semibold text-foreground">
									{step.title}
								</h3>
								<p className="mt-2 text-sm text-muted-foreground">
									{step.body}
								</p>
							</li>
						))}
					</ol>
				</div>
			</section>

			{/* Research Studio */}
			<section className="border-t border-border bg-muted/30 py-16 sm:py-20">
				<div className="mx-auto max-w-6xl px-4 sm:px-6">
					<SectionHeading
						eyebrow="Research Studio"
						title="Research Studio turns sources into useful outputs."
						description="The commercial heart of the product — generate once, keep the citations."
					/>
					<div className="mt-12 grid gap-4 sm:grid-cols-2">
						{STUDIO_CARDS.map((card) => {
							const Icon = card.icon;
							return (
								<article key={card.title} className="kw-card p-6">
									<div className="flex size-10 items-center justify-center rounded-full bg-muted text-primary">
										<Icon className="size-5" aria-hidden />
									</div>
									<h3 className="mt-4 font-[Fraunces,serif] text-xl font-semibold text-foreground">
										{card.title}
									</h3>
									<p className="mt-2 text-sm text-muted-foreground">
										{card.description}
									</p>
								</article>
							);
						})}
					</div>
				</div>
			</section>

			{/* Citations */}
			<section className="py-16 sm:py-20">
				<div className="mx-auto max-w-6xl px-4 sm:px-6">
					<div className="grid items-center gap-10 lg:grid-cols-2">
						<div>
							<p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
								Evidence
							</p>
							<h2 className="mt-2 font-[Fraunces,serif] text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
								Don't just get an answer. See where it came from.
							</h2>
							<p className="mt-4 text-muted-foreground">
								Every grounded answer and Studio artifact keeps its evidence
								attached. Designed to keep evidence close to every claim.
							</p>
							<ul className="mt-6 space-y-2 text-sm text-foreground">
								<li>
									<span className="font-medium text-primary">PDF</span> → page
								</li>
								<li>
									<span className="font-medium text-primary">YouTube</span> →
									timestamp
								</li>
								<li>
									<span className="font-medium text-primary">Website</span> →
									section
								</li>
								<li>
									<span className="font-medium text-primary">Transcript</span> →
									passage
								</li>
							</ul>
						</div>
						<div className="kw-card p-6" aria-hidden>
							<p className="text-sm text-foreground">
								Pods restart when the liveness probe fails, not when the process
								exits cleanly.{" "}
								<span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-medium text-primary">
									[1]
								</span>
							</p>
							<div className="mt-4 flex flex-wrap gap-1.5">
								<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
									<span className="text-primary">[1]</span> Official docs ·
									Probes — Liveness
								</span>
								<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
									<span className="text-primary">[2]</span> Handbook · p.42
								</span>
								<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
									<span className="text-primary">[3]</span> Course · 8:15
								</span>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Use cases */}
			<section className="border-t border-border bg-muted/30 py-16 sm:py-20">
				<div className="mx-auto max-w-6xl px-4 sm:px-6">
					<SectionHeading title="Built for the way developers actually learn." />
					<div className="mt-12 grid gap-4 lg:grid-cols-3">
						<article className="kw-card p-6">
							<div className="flex size-9 items-center justify-center rounded-full bg-muted">
								<BookOpen className="size-4 text-primary" aria-hidden />
							</div>
							<h3 className="mt-3 font-[Fraunces,serif] text-lg font-semibold">
								Learn Kubernetes
							</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Documentation + YouTube course → Learning Roadmap → Study Guide
								→ grounded Q&amp;A.
							</p>
						</article>
						<article className="kw-card p-6">
							<div className="flex size-9 items-center justify-center rounded-full bg-muted">
								<GitCompare className="size-4 text-primary" aria-hidden />
							</div>
							<h3 className="mt-3 font-[Fraunces,serif] text-lg font-semibold">
								Compare frameworks
							</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Official docs + tutorials + articles → Compare Sources →
								agreements, tradeoffs, conflicting recommendations.
							</p>
						</article>
						<article className="kw-card p-6">
							<div className="flex size-9 items-center justify-center rounded-full bg-muted">
								<FileText className="size-4 text-primary" aria-hidden />
							</div>
							<h3 className="mt-3 font-[Fraunces,serif] text-lg font-semibold">
								Research a technology
							</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Multiple technical articles → Research Brief → evidence and open
								questions.
							</p>
						</article>
					</div>
				</div>
			</section>

			{/* Comparison */}
			<section className="py-16 sm:py-20">
				<div className="mx-auto max-w-6xl px-4 sm:px-6">
					<SectionHeading
						title="Your sources become a reusable knowledge base."
						description="Same material — different workflow."
					/>
					<div className="mt-12 grid gap-4 md:grid-cols-3">
						<div className="rounded-xl border border-border p-5">
							<h3 className="text-sm font-semibold text-muted-foreground uppercase">
								Traditional
							</h3>
							<p className="mt-3 text-sm text-foreground">
								Search → open 15 tabs → watch videos → take notes → lose
								sources.
							</p>
						</div>
						<div className="rounded-xl border border-border p-5">
							<h3 className="text-sm font-semibold text-muted-foreground uppercase">
								Chat with uploads
							</h3>
							<p className="mt-3 text-sm text-foreground">
								Upload → ask → receive an answer.
							</p>
						</div>
						<div className="rounded-xl border border-primary/40 bg-accent/40 p-5">
							<h3 className="text-sm font-semibold text-primary uppercase">
								Knowledge Workbench
							</h3>
							<p className="mt-3 text-sm text-foreground">
								Collect sources → organize a notebook → research → generate
								artifacts → follow citations.
							</p>
						</div>
					</div>
				</div>
			</section>

			{/* Pricing */}
			<section
				id="pricing"
				className="scroll-mt-20 border-t border-border bg-muted/30 py-16 sm:py-20"
			>
				<div className="mx-auto max-w-6xl px-4 sm:px-6">
					<SectionHeading
						eyebrow="Pricing"
						title="Start free. Join Pro early access when you need more."
						description="Payment is not collected yet — Pro is a waitlist for early access."
					/>
					<div className="mx-auto mt-12 grid max-w-4xl gap-4 md:grid-cols-2">
						<div className="kw-card p-6">
							<p className="text-sm font-medium text-muted-foreground">Free</p>
							<p className="mt-1 font-[Fraunces,serif] text-3xl font-semibold">
								$0
							</p>
							<ul className="mt-4 space-y-2 text-sm text-foreground">
								<li>{free.maxNotebooks} notebooks</li>
								<li>{free.maxSourcesPerNotebook} sources per notebook</li>
								<li>
									{free.monthlyStudioGenerations} Studio generations / month
								</li>
								<li>Grounded chat and citations</li>
								<li>Basic source viewers</li>
							</ul>
						</div>
						<div className="kw-card border-primary/30 p-6 ring-1 ring-primary/20">
							<div className="flex items-center justify-between gap-2">
								<p className="text-sm font-medium text-muted-foreground">Pro</p>
								<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
									Early access
								</span>
							</div>
							<p className="mt-1 font-[Fraunces,serif] text-3xl font-semibold">
								{PRO_PRICE_LABEL}
							</p>
							<ul className="mt-4 space-y-2 text-sm text-foreground">
								<li>Up to {pro.maxNotebooks} notebooks</li>
								<li>Up to {pro.maxSourcesPerNotebook} sources per notebook</li>
								<li>
									{pro.monthlyStudioGenerations} Studio generations / month
								</li>
								<li>Research Brief, Study Guide, Roadmap, Compare</li>
								<li>Markdown export and artifact sharing</li>
							</ul>
						</div>
					</div>
					<PricingCtas />
				</div>
			</section>

			{/* Credibility */}
			<section className="py-16 sm:py-20">
				<div className="mx-auto max-w-6xl px-4 sm:px-6">
					<SectionHeading
						title="Built as a production-oriented research system."
						description="Relevant if you care how the product is put together."
					/>
					<ul className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-2">
						{[
							"PostgreSQL",
							"Qdrant",
							"Hybrid retrieval",
							"Citations",
							"Persistent Research Studio",
						].map((item) => (
							<li
								key={item}
								className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground"
							>
								{item}
							</li>
						))}
					</ul>
				</div>
			</section>

			{/* FAQ */}
			<section className="border-t border-border bg-muted/30 py-16 sm:py-20">
				<div className="mx-auto max-w-3xl px-4 sm:px-6">
					<SectionHeading title="FAQ" />
					<dl className="mt-10 space-y-6">
						{FAQ.map((item) => (
							<div key={item.q}>
								<dt className="font-[Fraunces,serif] text-lg font-semibold text-foreground">
									{item.q}
								</dt>
								<dd className="mt-1.5 text-sm text-muted-foreground">
									{item.a}
								</dd>
							</div>
						))}
					</dl>
				</div>
			</section>

			{/* Final CTA */}
			<section className="py-16 sm:py-24">
				<div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
					<h2 className="font-[Fraunces,serif] text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
						Stop collecting tabs. Build a knowledge base you can actually learn
						from.
					</h2>
					<div className="mt-8 flex justify-center">
						<LandingCta size="lg" source="final" />
					</div>
				</div>
			</section>

			<footer className="border-t border-border py-8">
				<div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-muted-foreground sm:flex-row sm:px-6">
					<p>Knowledge Workbench</p>
					<p>For developers and technical learners</p>
				</div>
			</footer>
		</div>
	);
}
