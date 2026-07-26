/**
 * Tiny RAG eval harness.
 *
 * Usage:
 *   bun run eval:rag -- --notebook <uuid> [--source <youtubeId>]
 *
 * Checks that hybrid retrieval returns clips near expected time ranges
 * for a fixed question set (regression guard for intro-bias bugs).
 */

import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { notebooks } from "#/db/schema/notebooks.ts";
import { sources } from "#/db/schema/sources.ts";
import { retrieveHybridNotebookChunks } from "#/lib/rag/hybrid-retrieve.server.ts";

type Case = {
  id: string;
  question: string;
  /** At least one retrieved hit should land in one of these [start,end] second windows. */
  expectAnyWindow: Array<[number, number]>;
};

const CASES: Case[] = [
  {
    id: "recovery-challenges",
    question: "What challenges were faced during recovery?",
    expectAnyWindow: [
      [2400, 3200], // site arrival / mats
      [3300, 4200], // pull / mud / snatch
    ],
  },
  {
    id: "recovery-equipment",
    question: "What equipment and rigging was used to pull the excavators?",
    expectAnyWindow: [
      [2800, 4200],
    ],
  },
];

function parseArgs(argv: string[]) {
  const notebookIdx = argv.indexOf("--notebook");
  const sourceIdx = argv.indexOf("--source");
  return {
    notebookId: notebookIdx >= 0 ? argv[notebookIdx + 1] : undefined,
    sourceHint: sourceIdx >= 0 ? argv[sourceIdx + 1] : undefined,
  };
}

function hitInWindow(
  tStart: number | undefined,
  windows: Array<[number, number]>,
) {
  if (typeof tStart !== "number") return false;
  return windows.some(([start, end]) => tStart >= start && tStart <= end);
}

async function main() {
  const { notebookId: argNotebookId, sourceHint } = parseArgs(process.argv);

  let notebookId = argNotebookId;
  let ownerId: string | undefined;

  if (!notebookId) {
    const [yt] = await db
      .select({
        notebookId: sources.notebookId,
        title: sources.title,
        url: sources.originalUrl,
      })
      .from(sources)
      .where(eq(sources.type, "youtube"))
      .limit(20);

    const match = sourceHint
      ? (
          await db.select().from(sources).where(eq(sources.type, "youtube"))
        ).find(
          (row) =>
            row.originalUrl?.includes(sourceHint) ||
            row.title.toLowerCase().includes(sourceHint.toLowerCase()),
        )
      : yt;

    if (!match) {
      console.error(
        "No YouTube source found. Pass --notebook <uuid> after indexing a video.",
      );
      process.exit(1);
    }
    notebookId = match.notebookId;
    console.log(`Using notebook ${notebookId} (${match.title})`);
  }

  const [nb] = await db
    .select({ ownerId: notebooks.ownerId })
    .from(notebooks)
    .where(eq(notebooks.id, notebookId!))
    .limit(1);
  ownerId = nb?.ownerId;
  if (!ownerId) {
    console.error("Notebook not found:", notebookId);
    process.exit(1);
  }

  let failed = 0;

  for (const testCase of CASES) {
    const { hits } = await retrieveHybridNotebookChunks({
      notebookId: notebookId!,
      ownerId,
      question: testCase.question,
      finalLimit: 8,
    });

    const times = hits
      .map((hit) => hit.locator?.tStart)
      .filter((t): t is number => typeof t === "number");
    const ok = hits.some((hit) =>
      hitInWindow(hit.locator?.tStart, testCase.expectAnyWindow),
    );

    console.log(`\n[${testCase.id}] ${ok ? "PASS" : "FAIL"}`);
    console.log(`  Q: ${testCase.question}`);
    console.log(
      `  hit tStarts: ${times.map((t) => Math.round(t)).join(", ") || "(none)"}`,
    );
    if (!ok) {
      failed += 1;
      console.log(
        `  expected a hit in one of: ${testCase.expectAnyWindow
          .map(([a, b]) => `${a}-${b}s`)
          .join(", ")}`,
      );
    }
  }

  console.log(
    `\n${CASES.length - failed}/${CASES.length} passed${failed ? ` (${failed} failed)` : ""}`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

await main();
