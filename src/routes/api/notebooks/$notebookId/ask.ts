import { createFileRoute } from "@tanstack/react-router";

import { runNotebookAsk } from "#/features/chat/ask-notebook.server.ts";
import { requireOwnedNotebook } from "#/features/sources/notebook-access.server.ts";

type AskBody = {
	question?: string;
};

export const Route = createFileRoute("/api/notebooks/$notebookId/ask")({
	server: {
		handlers: {
			POST: async ({ params, request }) => {
				let ownerId: string;
				try {
					const access = await requireOwnedNotebook(params.notebookId);
					ownerId = access.userId;
				} catch {
					return new Response("Unauthorized", { status: 401 });
				}

				let body: AskBody;
				try {
					body = (await request.json()) as AskBody;
				} catch {
					return Response.json({ error: "Invalid JSON body" }, { status: 400 });
				}

				const question = body.question?.trim() ?? "";
				if (!question || question.length > 4000) {
					return Response.json(
						{ error: "Question must be 1–4000 characters" },
						{ status: 400 },
					);
				}

				const encoder = new TextEncoder();
				const stream = new ReadableStream({
					start(controller) {
						const send = (payload: unknown) => {
							controller.enqueue(
								encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
							);
						};

						void (async () => {
							try {
								const result = await runNotebookAsk({
									notebookId: params.notebookId,
									ownerId,
									question,
									onPhase: (event) => {
										send({ type: "phase", ...event });
									},
									onToken: (token) => {
										send({ type: "token", text: token });
									},
								});

								send({
									type: "done",
									userMessage: result.userMessage,
									assistantMessage: result.assistantMessage,
								});
							} catch (error) {
								send({
									type: "error",
									message:
										error instanceof Error
											? error.message
											: "Failed to answer question",
								});
							} finally {
								controller.close();
							}
						})();
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
