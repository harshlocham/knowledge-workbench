import type { MessageCitation } from "#/db/schema/messages.ts";

export type ChatMessageDTO = {
	id: string;
	notebookId: string;
	role: "user" | "assistant";
	content: string;
	citations: MessageCitation[];
	createdAt: string;
};
