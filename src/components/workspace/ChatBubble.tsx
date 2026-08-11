import { Check, Copy, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import { CitationChips } from "#/components/workspace/CitationChips.tsx";
import { MarkdownWithCitations } from "#/components/workspace/MarkdownWithCitations.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type { ChatMessageDTO } from "#/features/chat/chat.functions.ts";
import { splitFollowUpQuestions } from "#/lib/chat/follow-up-questions.ts";
import { cn } from "#/lib/utils.ts";

export function ChatBubble({
	message,
	activeCitationKey,
	onCitationClick,
	onFollowUpAsk,
	followUpsDisabled = false,
	onRegenerate,
	isLastAssistant,
}: {
	message: ChatMessageDTO;
	activeCitationKey: string | null;
	onCitationClick: (citation: MessageCitation, messageId: string) => void;
	onFollowUpAsk?: (question: string) => void;
	followUpsDisabled?: boolean;
	onRegenerate?: () => void;
	isLastAssistant?: boolean;
}) {
	const [copied, setCopied] = useState(false);
	const isUser = message.role === "user";

	const citationChips = useMemo(
		() => message.citations ?? [],
		[message.citations],
	);

	const { body: assistantBody, questions: followUps } = useMemo(
		() =>
			isUser
				? { body: message.content, questions: [] as string[] }
				: splitFollowUpQuestions(message.content),
		[isUser, message.content],
	);

	async function handleCopy() {
		await navigator.clipboard.writeText(message.content);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1500);
	}

	return (
		<div
			className={cn(
				"group flex w-full flex-col gap-2",
				isUser ? "items-end" : "items-start",
			)}
		>
			<div
				className={cn(
					"max-w-[min(100%,42rem)] rounded-2xl px-4 py-3 text-sm leading-relaxed",
					isUser
						? "bg-foreground text-background"
						: "border border-border bg-card text-foreground shadow-[var(--shadow-soft)]",
				)}
			>
				{isUser ? (
					<p className="whitespace-pre-wrap">{message.content}</p>
				) : (
					<MarkdownWithCitations
						content={assistantBody}
						citations={citationChips}
						ownerId={message.id}
						activeCitationKey={activeCitationKey}
						onCitationClick={onCitationClick}
					/>
				)}

				{!isUser && followUps.length > 0 ? (
					<div className="mt-3 border-t border-border pt-3">
						<p className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
							Follow-up questions
						</p>
						<div className="flex flex-col gap-2">
							{followUps.map((question) => (
								<button
									key={question}
									type="button"
									disabled={!onFollowUpAsk || followUpsDisabled}
									onClick={() => onFollowUpAsk?.(question)}
									className={cn(
										"rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-left text-sm text-foreground transition focus-ring",
										!onFollowUpAsk || followUpsDisabled
											? "cursor-not-allowed opacity-60"
											: "hover:border-primary/40 hover:bg-accent",
									)}
								>
									{question}
								</button>
							))}
						</div>
					</div>
				) : null}

				{!isUser ? (
					<CitationChips
						citations={citationChips}
						ownerId={message.id}
						activeCitationKey={activeCitationKey}
						onCitationClick={onCitationClick}
						className="mt-3 border-t border-border pt-3"
					/>
				) : null}
			</div>

			{!isUser ? (
				<div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
					<Button
						type="button"
						variant="ghost"
						size="xs"
						onClick={() => void handleCopy()}
						aria-label="Copy answer"
					>
						{copied ? <Check /> : <Copy />}
						{copied ? "Copied" : "Copy"}
					</Button>
					{isLastAssistant && onRegenerate ? (
						<Button
							type="button"
							variant="ghost"
							size="xs"
							onClick={onRegenerate}
							aria-label="Regenerate answer"
						>
							<RefreshCw />
							Regenerate
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}

export function TypingIndicator({ label }: { label?: string }) {
	return (
		<div className="mr-auto inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-[var(--shadow-soft)]">
			<span className="inline-flex items-center gap-1.5">
				<span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
				<span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
				<span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
			</span>
			<span>{label?.trim() || "Generating answer…"}</span>
		</div>
	);
}
