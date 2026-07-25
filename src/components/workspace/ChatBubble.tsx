import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CitationBadge } from "#/components/workspace/CitationBadge.tsx";
import { Button } from "#/components/ui/button.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type { ChatMessageDTO } from "#/features/chat/chat.functions.ts";
import { cn } from "#/lib/utils.ts";

function citationKey(messageId: string, citation: MessageCitation) {
  return `${messageId}:${citation.chunkId}:${citation.citationNumber ?? ""}`;
}

function injectCitationBadges(
  node: ReactNode,
  citations: MessageCitation[],
  messageId: string,
  activeCitationKey: string | null,
  onCitationClick: (citation: MessageCitation, messageId: string) => void,
): ReactNode {
  if (typeof node === "string") {
    const parts = node.split(/(\[\d+\])/g);
    return parts.map((part, index) => {
      const match = part.match(/^\[(\d+)\]$/);
      if (!match) {
        return <span key={`t-${index}`}>{part}</span>;
      }
      const citationNumber = Number(match[1]);
      const citation =
        citations.find((item) => item.citationNumber === citationNumber) ??
        citations[citationNumber - 1];
      if (!citation) {
        return <span key={`c-${index}`}>{part}</span>;
      }
      const key = citationKey(messageId, citation);
      return (
        <CitationBadge
          key={`c-${index}`}
          number={citationNumber}
          title={citation.sourceTitle}
          active={activeCitationKey === key}
          onClick={() => onCitationClick(citation, messageId)}
        />
      );
    });
  }

  if (Array.isArray(node)) {
    return node.map((child, index) => (
      <span key={index}>
        {injectCitationBadges(
          child,
          citations,
          messageId,
          activeCitationKey,
          onCitationClick,
        )}
      </span>
    ));
  }

  return node;
}

function MarkdownWithCitations({
  content,
  citations,
  messageId,
  activeCitationKey,
  onCitationClick,
}: {
  content: string;
  citations: MessageCitation[];
  messageId: string;
  activeCitationKey: string | null;
  onCitationClick: (citation: MessageCitation, messageId: string) => void;
}) {
  const wrap =
    (Tag: "p" | "li" | "td" | "th" | "strong" | "em") =>
    ({ children }: { children?: ReactNode }) => {
      const Comp = Tag;
      return (
        <Comp>
          {injectCitationBadges(
            children,
            citations,
            messageId,
            activeCitationKey,
            onCitationClick,
          )}
        </Comp>
      );
    };

  return (
    <div className="prose prose-sm max-w-none text-foreground prose-p:my-2 prose-pre:my-3 prose-headings:font-[Fraunces,serif] prose-a:text-primary prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: wrap("p"),
          li: wrap("li"),
          td: wrap("td"),
          th: wrap("th"),
          strong: wrap("strong"),
          em: wrap("em"),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function ChatBubble({
  message,
  activeCitationKey,
  onCitationClick,
  onRegenerate,
  isLastAssistant,
}: {
  message: ChatMessageDTO;
  activeCitationKey: string | null;
  onCitationClick: (citation: MessageCitation, messageId: string) => void;
  onRegenerate?: () => void;
  isLastAssistant?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const citationChips = useMemo(
    () => message.citations ?? [],
    [message.citations],
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
            content={message.content}
            citations={citationChips}
            messageId={message.id}
            activeCitationKey={activeCitationKey}
            onCitationClick={onCitationClick}
          />
        )}

        {!isUser && citationChips.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
            {citationChips.map((citation) => {
              const key = citationKey(message.id, citation);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onCitationClick(citation, message.id)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium transition focus-ring",
                    activeCitationKey === key
                      ? "bg-accent text-foreground ring-2 ring-primary"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  [{citation.citationNumber}] {citation.sourceTitle ?? "Source"}
                  {citation.locator?.page != null
                    ? ` · p.${citation.locator.page}`
                    : ""}
                  {citation.locator?.tStart != null
                    ? ` · ${Math.floor(citation.locator.tStart / 60)}:${String(
                        Math.floor(citation.locator.tStart % 60),
                      ).padStart(2, "0")}`
                    : ""}
                </button>
              );
            })}
          </div>
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

export function TypingIndicator() {
  return (
    <div className="mr-auto inline-flex items-center gap-1.5 rounded-2xl border border-border bg-card px-4 py-3 shadow-[var(--shadow-soft)]">
      <span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
      <span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
      <span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
      <span className="sr-only">Generating answer</span>
    </div>
  );
}
