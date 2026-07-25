import { useEffect, useRef } from "react";
import { MessageSquare, Plus } from "lucide-react";

import { EmptyState } from "#/components/layout/EmptyState.tsx";
import {
  ChatBubble,
  TypingIndicator,
} from "#/components/workspace/ChatBubble.tsx";
import { ChatComposer } from "#/components/workspace/ChatComposer.tsx";
import { Button } from "#/components/ui/button.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type { ChatMessageDTO } from "#/features/chat/chat.functions.ts";

export function ChatPanel({
  messages,
  isAsking,
  question,
  onQuestionChange,
  onAsk,
  onRegenerate,
  chatError,
  readyCount,
  sourceCount,
  onAddSources,
  activeCitationKey,
  onCitationClick,
}: {
  messages: ChatMessageDTO[];
  isAsking: boolean;
  question: string;
  onQuestionChange: (value: string) => void;
  onAsk: () => void;
  onRegenerate: () => void;
  chatError: string | null;
  readyCount: number;
  sourceCount: number;
  onAddSources?: () => void;
  activeCitationKey: string | null;
  onCitationClick: (citation: MessageCitation, messageId: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAsking]);

  const lastAssistantId = [...messages]
    .reverse()
    .find((m) => m.role === "assistant")?.id;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--workspace-bg)]">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length === 0 && !isAsking ? (
          sourceCount === 0 ? (
            <EmptyState
              icon={Plus}
              title="Add a source to get started"
              description="Drop in a PDF, website, YouTube video, or text. Then ask questions grounded in those sources."
              action={
                onAddSources ? (
                  <Button type="button" onClick={onAddSources}>
                    <Plus />
                    Add sources
                  </Button>
                ) : null
              }
              className="h-full"
            />
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="Ask this notebook"
              description="Answers are grounded in your sources and include citations you can open in Knowledge Tools."
              className="h-full"
            />
          )
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {messages.map((message) => (
              <ChatBubble
                key={message.id}
                message={message}
                activeCitationKey={activeCitationKey}
                onCitationClick={onCitationClick}
                onRegenerate={onRegenerate}
                isLastAssistant={message.id === lastAssistantId}
              />
            ))}
            {isAsking ? <TypingIndicator /> : null}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <ChatComposer
        value={question}
        onChange={onQuestionChange}
        onSubmit={onAsk}
        disabled={isAsking}
        readyCount={readyCount}
        error={chatError}
      />
    </section>
  );
}
