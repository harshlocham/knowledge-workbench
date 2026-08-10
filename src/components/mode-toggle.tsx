import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "#/components/ui/button.tsx";

const themes = ["system", "light", "dark"] as const;

export function ModeToggle() {
	const { theme, setTheme } = useTheme();

	const cycleTheme = () => {
		const currentIndex = themes.indexOf(
			(theme as (typeof themes)[number]) ?? "system",
		);
		const nextTheme = themes[(currentIndex + 1) % themes.length];
		setTheme(nextTheme);
	};

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			aria-label="Cycle theme"
			className="relative"
			onClick={cycleTheme}
		>
			<Sun
				className={`size-4 transition-all ${
					theme === "light"
						? "scale-100 rotate-0"
						: "absolute scale-0 -rotate-90"
				}`}
			/>
			<Moon
				className={`size-4 transition-all ${
					theme === "dark" ? "scale-100 rotate-0" : "absolute scale-0 rotate-90"
				}`}
			/>
			<Monitor
				className={`size-4 transition-all ${
					theme === "system" || !theme
						? "scale-100 rotate-0"
						: "absolute scale-0 rotate-90"
				}`}
			/>
			<span className="sr-only">Cycle theme</span>
		</Button>
	);
}
