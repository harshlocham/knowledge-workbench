import { createFileRoute, notFound } from "@tanstack/react-router";

import { SharedArtifactDocument } from "#/components/workspace/studio/SharedArtifactDocument.tsx";
import { getSharedArtifact } from "#/features/studio/artifact-share.functions.ts";
import { isShareTokenShape } from "#/lib/artifacts/share-token.ts";

export const Route = createFileRoute("/share/$token")({
	loader: async ({ params }) => {
		if (!isShareTokenShape(params.token)) {
			throw notFound();
		}
		return getSharedArtifact({ data: { token: params.token } });
	},
	component: SharedArtifactPage,
	notFoundComponent: SharedNotFound,
});

function SharedArtifactPage() {
	const shared = Route.useLoaderData();

	return (
		<div className="min-h-dvh bg-background">
			<main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
				<SharedArtifactDocument shared={shared} />
			</main>
		</div>
	);
}

function SharedNotFound() {
	return (
		<div className="flex min-h-dvh items-center justify-center bg-background px-4">
			<div className="max-w-md text-center">
				<p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
					Knowledge Workbench
				</p>
				<h1 className="mt-3 font-[Fraunces,serif] text-2xl font-semibold text-foreground">
					Share link not found
				</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					This link may have been revoked, expired, or never existed.
				</p>
			</div>
		</div>
	);
}
