import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Link2, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	createArtifactShare,
	getArtifactShare,
	revokeArtifactShare,
} from "#/features/studio/artifact-share.functions.ts";
import type { ArtifactDTO } from "#/features/studio/artifacts.types.ts";

function absoluteShareUrl(path: string) {
	if (typeof window === "undefined") return path;
	return new URL(path, window.location.origin).toString();
}

export function ArtifactShareDialog({
	artifact,
	open,
	onOpenChange,
	onShareChange,
}: {
	artifact: ArtifactDTO;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Lets the parent refresh `isShared` after create/revoke. */
	onShareChange: (isShared: boolean) => void;
}) {
	const getShareFn = useServerFn(getArtifactShare);
	const createShareFn = useServerFn(createArtifactShare);
	const revokeShareFn = useServerFn(revokeArtifactShare);

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [shareUrl, setShareUrl] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!open) return;

		let cancelled = false;
		setLoading(true);
		setError(null);

		void getShareFn({ data: { artifactId: artifact.id } })
			.then((status) => {
				if (cancelled) return;
				if (status.shared) {
					setShareUrl(absoluteShareUrl(status.path));
				} else {
					setShareUrl(null);
				}
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setError(
					err instanceof Error ? err.message : "Could not load share status",
				);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [open, artifact.id, getShareFn]);

	async function handleCreate() {
		setLoading(true);
		setError(null);
		try {
			const status = await createShareFn({ data: { artifactId: artifact.id } });
			setShareUrl(absoluteShareUrl(status.path));
			onShareChange(true);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Could not create share link",
			);
		} finally {
			setLoading(false);
		}
	}

	async function handleRevoke() {
		setLoading(true);
		setError(null);
		try {
			await revokeShareFn({ data: { artifactId: artifact.id } });
			setShareUrl(null);
			onShareChange(false);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Could not revoke share link",
			);
		} finally {
			setLoading(false);
		}
	}

	async function handleCopyLink() {
		if (!shareUrl) return;
		try {
			await navigator.clipboard.writeText(shareUrl);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			setError("Copy failed");
		}
	}

	const canShare = artifact.status === "ready";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Share artifact</DialogTitle>
					<DialogDescription>
						Anyone with the link can read this artifact. Your notebook and
						private source files stay private.
					</DialogDescription>
				</DialogHeader>

				{!canShare ? (
					<p className="text-sm text-muted-foreground">
						Only ready artifacts can be shared.
					</p>
				) : loading && !shareUrl ? (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<LoaderCircle className="size-4 animate-spin" />
						Loading…
					</div>
				) : shareUrl ? (
					<div className="flex flex-col gap-3">
						<p className="text-xs font-medium text-muted-foreground">
							Share link
						</p>
						<div className="flex gap-2">
							<Input
								id="artifact-share-url"
								readOnly
								value={shareUrl}
								className="font-mono text-xs"
								aria-label="Share link"
							/>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void handleCopyLink()}
							>
								{copied ? <Check /> : <Copy />}
								{copied ? "Copied" : "Copy link"}
							</Button>
						</div>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						Create a read-only link you can send to anyone.
					</p>
				)}

				{error ? <p className="text-sm text-destructive">{error}</p> : null}

				<DialogFooter>
					{shareUrl ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => void handleRevoke()}
							disabled={loading}
						>
							Revoke link
						</Button>
					) : (
						<Button
							type="button"
							onClick={() => void handleCreate()}
							disabled={loading || !canShare}
						>
							{loading ? <LoaderCircle className="animate-spin" /> : <Link2 />}
							Create share link
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
