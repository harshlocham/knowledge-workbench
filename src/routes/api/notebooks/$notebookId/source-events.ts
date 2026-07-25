import { createFileRoute } from "@tanstack/react-router";
import { desc, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { sources } from "#/db/schema/sources.ts";
import type { SourceDTO } from "#/features/sources/sources.functions.ts";
import { requireOwnedNotebook } from "#/features/sources/notebook-access.server.ts";
import type { IndexProgress } from "#/lib/rag/index-source.server.ts";

function readMetaNumber(metadata: unknown, key: string): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}

function readIndexProgress(metadata: unknown): IndexProgress | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).indexProgress;
  if (!value || typeof value !== "object") return null;
  const progress = value as Partial<IndexProgress>;
  if (
    typeof progress.phase !== "string" ||
    typeof progress.percent !== "number" ||
    typeof progress.message !== "string"
  ) {
    return null;
  }
  return {
    phase: progress.phase as IndexProgress["phase"],
    percent: progress.percent,
    message: progress.message,
  };
}

function toSourceDTO(row: typeof sources.$inferSelect): SourceDTO {
  return {
    id: row.id,
    notebookId: row.notebookId,
    type: row.type,
    title: row.title,
    status: row.status,
    errorMessage: row.errorMessage,
    originalUrl: row.originalUrl,
    charCount: readMetaNumber(row.metadata, "charCount"),
    chunkCount: readMetaNumber(row.metadata, "chunkCount"),
    pageCount: readMetaNumber(row.metadata, "pageCount"),
    indexProgress: readIndexProgress(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const Route = createFileRoute(
  "/api/notebooks/$notebookId/source-events",
)({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          await requireOwnedNotebook(params.notebookId);
        } catch {
          return new Response("Unauthorized", { status: 401 });
        }

        const encoder = new TextEncoder();
        let closed = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const stream = new ReadableStream({
          start(controller) {
            const send = (payload: unknown) => {
              if (closed) return;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
              );
            };

            const tick = async () => {
              if (closed) return;

              try {
                const rows = await db
                  .select()
                  .from(sources)
                  .where(eq(sources.notebookId, params.notebookId))
                  .orderBy(desc(sources.createdAt));

                const items = rows.map(toSourceDTO);
                const pending = items.some(
                  (item) =>
                    item.status === "uploading" || item.status === "indexing",
                );

                send({
                  type: "sources",
                  sources: items,
                  pending,
                  at: new Date().toISOString(),
                });

                if (!pending) {
                  send({ type: "done" });
                  closed = true;
                  controller.close();
                  return;
                }
              } catch (error) {
                send({
                  type: "error",
                  message:
                    error instanceof Error
                      ? error.message
                      : "Failed to stream source updates",
                });
                closed = true;
                controller.close();
                return;
              }

              timer = setTimeout(() => {
                void tick();
              }, 1000);
            };

            void tick();

            request.signal.addEventListener("abort", () => {
              closed = true;
              if (timer) clearTimeout(timer);
              try {
                controller.close();
              } catch {
                // already closed
              }
            });
          },
          cancel() {
            closed = true;
            if (timer) clearTimeout(timer);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
