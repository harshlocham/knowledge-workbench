import { Show, SignInButton } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";

import { Button } from "#/components/ui/button.tsx";
import { track } from "#/lib/analytics.ts";

const NOTEBOOKS_PATH = "/notebooks";

/**
 * Primary / secondary conversion CTAs. Signed-out opens Clerk; signed-in goes
 * to notebooks. After sign-in, Clerk redirects to notebooks.
 */
export function LandingCta({
	label = "Try Knowledge Workbench",
	variant = "default",
	size = "default",
	source = "hero",
	className,
}: {
	label?: string;
	variant?: "default" | "outline" | "ghost" | "secondary";
	size?: "default" | "sm" | "lg";
	source?: string;
	className?: string;
}) {
	function onClick(kind: "primary" | "signup") {
		track(kind === "signup" ? "signup_started" : "landing_cta_click", {
			source,
			label,
		});
	}

	return (
		<>
			<Show when="signed-in">
				<Button asChild variant={variant} size={size} className={className}>
					<Link to={NOTEBOOKS_PATH} onClick={() => onClick("primary")}>
						{label === "Try Knowledge Workbench" || label === "Start free"
							? "Open notebooks"
							: label}
					</Link>
				</Button>
			</Show>
			<Show when="signed-out">
				<SignInButton
					mode="modal"
					forceRedirectUrl={NOTEBOOKS_PATH}
					fallbackRedirectUrl={NOTEBOOKS_PATH}
				>
					<Button
						type="button"
						variant={variant}
						size={size}
						className={className}
						onClick={() => onClick("signup")}
					>
						{label}
					</Button>
				</SignInButton>
			</Show>
		</>
	);
}
