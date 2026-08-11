import { TopNavigation } from "#/components/layout/TopNavigation.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Link } from "@tanstack/react-router";

/** Legacy header used on marketing/home; dashboard uses TopNavigation directly. */
export function AppHeader() {
	return (
		<TopNavigation
			actions={
				<Button asChild variant="ghost" size="sm">
					<Link to="/notebooks">Notebooks</Link>
				</Button>
			}
		/>
	);
}
