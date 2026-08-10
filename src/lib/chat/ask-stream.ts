import type { ChatMessageDTO } from "#/features/chat/chat.types.ts";

export type AskStreamPhase =
	| "understanding"
	| "searching"
	| "ranking"
	| "writing"
	| "saving";

export type AskStreamHandlers = {
	onPhase?: (phase: AskStreamPhase, message: string) => void;
	onToken?: (token: string) => void;
};

/**
 * POST /api/notebooks/:id/ask and consume SSE progress + tokens.
 */
export async function askNotebookStream(
	notebookId: string,
	question: string,
	handlers: AskStreamHandlers = {},
): Promise<{
	userMessage: ChatMessageDTO;
	assistantMessage: ChatMessageDTO;
}> {
	const response = await fetch(`/api/notebooks/${notebookId}/ask`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "text/event-stream",
		},
		body: JSON.stringify({ question }),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(text || `Ask failed (${response.status})`);
	}

	if (!response.body) {
		throw new Error("Ask stream returned no body");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let result:
		| {
				userMessage: ChatMessageDTO;
				assistantMessage: ChatMessageDTO;
		  }
		| undefined;
	let streamError: string | undefined;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const parts = buffer.split("\n\n");
		buffer = parts.pop() ?? "";

		for (const part of parts) {
			const line = part
				.split("\n")
				.map((entry) => entry.trim())
				.find((entry) => entry.startsWith("data:"));
			if (!line) continue;

			const raw = line.slice(5).trim();
			if (!raw) continue;

			let event: Record<string, unknown>;
			try {
				event = JSON.parse(raw) as Record<string, unknown>;
			} catch {
				continue;
			}

			if (event.type === "phase") {
				handlers.onPhase?.(
					event.phase as AskStreamPhase,
					String(event.message ?? ""),
				);
			} else if (event.type === "token") {
				handlers.onToken?.(String(event.text ?? ""));
			} else if (event.type === "done") {
				result = {
					userMessage: event.userMessage as ChatMessageDTO,
					assistantMessage: event.assistantMessage as ChatMessageDTO,
				};
			} else if (event.type === "error") {
				streamError = String(event.message ?? "Failed to answer question");
			}
		}
	}

	if (streamError) {
		throw new Error(streamError);
	}
	if (!result) {
		throw new Error("Ask stream ended without a result");
	}

	return result;
}
