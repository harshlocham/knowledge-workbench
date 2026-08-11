import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireOwnedArtifact } from "#/features/studio/artifact-access.server.ts";
import {
	assertArtifactShareable,
	type PublicArtifactDTO,
	toPublicArtifactDTO,
} from "#/features/studio/artifact-share.public.ts";
import {
	getArtifactByShareToken,
	updateArtifactById,
} from "#/features/studio/artifacts.store.server.ts";
import {
	createShareToken,
	isShareTokenShape,
} from "#/lib/artifacts/share-token.ts";
import { assertProFeature } from "#/lib/plans/plan.server.ts";

export type ArtifactShareLink = {
	shared: true;
	token: string;
	/** Path-only URL; the client prefixes the current origin. */
	path: string;
};

export type ArtifactShareStatus =
	| ArtifactShareLink
	| {
			shared: false;
	  };

function sharePath(token: string) {
	return `/share/${token}`;
}

/**
 * Returns the existing share link without creating one. Ready artifacts only —
 * pending/failed never appear as shareable.
 */
export const getArtifactShare = createServerFn({ method: "GET" })
	.validator(z.object({ artifactId: z.string().uuid() }))
	.handler(async ({ data }): Promise<ArtifactShareStatus> => {
		const { artifact } = await requireOwnedArtifact(data.artifactId);
		assertArtifactShareable(artifact.status);

		if (!artifact.shareToken) {
			return { shared: false };
		}

		return {
			shared: true,
			token: artifact.shareToken,
			path: sharePath(artifact.shareToken),
		};
	});

/**
 * Creates a share token if one does not already exist. Re-opening the share
 * panel must not rotate the token.
 */
export const createArtifactShare = createServerFn({ method: "POST" })
	.validator(z.object({ artifactId: z.string().uuid() }))
	.handler(async ({ data }): Promise<ArtifactShareLink> => {
		const { userId, artifact } = await requireOwnedArtifact(data.artifactId);
		await assertProFeature(userId, "Artifact sharing");
		assertArtifactShareable(artifact.status);

		if (artifact.shareToken) {
			return {
				shared: true,
				token: artifact.shareToken,
				path: sharePath(artifact.shareToken),
			};
		}

		const token = createShareToken();
		const updated = await updateArtifactById(
			artifact.id,
			{
				shareToken: token,
				sharedAt: new Date(),
			},
			artifact,
		);

		// Re-read via DTO isShared; token is on the row we just wrote.
		if (!updated.isShared) {
			throw new Error("Failed to create share link");
		}

		return {
			shared: true,
			token,
			path: sharePath(token),
		};
	});

/** Disables the public link without deleting the artifact. */
export const revokeArtifactShare = createServerFn({ method: "POST" })
	.validator(z.object({ artifactId: z.string().uuid() }))
	.handler(async ({ data }): Promise<{ shared: false }> => {
		const { artifact } = await requireOwnedArtifact(data.artifactId);

		await updateArtifactById(
			artifact.id,
			{
				shareToken: null,
				sharedAt: null,
			},
			artifact,
		);

		return { shared: false };
	});

/**
 * Public, unauthenticated load of a shared artifact. Invalid, revoked and
 * non-ready tokens all surface as not-found.
 */
export const getSharedArtifact = createServerFn({ method: "GET" })
	.validator(z.object({ token: z.string().min(1).max(128) }))
	.handler(async ({ data }): Promise<PublicArtifactDTO> => {
		if (!isShareTokenShape(data.token)) {
			throw notFound();
		}

		const row = await getArtifactByShareToken(data.token);
		if (!row) {
			throw notFound();
		}

		return toPublicArtifactDTO(row);
	});
