import { Send } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";

export function ChatComposer({
	value,
	onChange,
	onSubmit,
	disabled,
	readyCount,
	error,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	disabled?: boolean;
	readyCount: number;
	error?: string | null;
}) {
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
			className="border-t border-border bg-card/95 px-4 py-3 backdrop-blur-sm sm:px-6"
		>
			{error ? (
				<p className="mb-2 text-sm text-destructive" role="alert">
					{error}
				</p>
			) : null}
			<div className="mx-auto flex max-w-3xl gap-2">
				<Textarea
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={
						readyCount > 0
							? "Ask a question about your sources…"
							: "Add a ready source before asking…"
					}
					rows={2}
					className="min-h-11 resize-none bg-background"
					disabled={disabled}
					aria-label="Ask the notebook"
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							onSubmit();
						}
					}}
				/>
				<Button
					type="submit"
					size="icon-lg"
					disabled={disabled || !value.trim()}
					aria-label="Send question"
				>
					<Send />
				</Button>
			</div>
		</form>
	);
}
