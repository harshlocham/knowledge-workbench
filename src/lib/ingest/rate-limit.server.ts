import { count, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { sources } from "#/db/schema/sources.ts";
import { INGEST_LIMITS } from "#/lib/ingest/limits.ts";

const createBuckets = new Map<string, number[]>();

/** In-memory sliding window (per server process). Fine for single-node / dev. */
export function assertCreateRateLimit(userId: string) {
  const now = Date.now();
  const windowMs = INGEST_LIMITS.createWindowMs;
  const prior = (createBuckets.get(userId) ?? []).filter(
    (ts) => now - ts < windowMs,
  );

  if (prior.length >= INGEST_LIMITS.maxCreatesPerWindow) {
    throw new Error(
      `Too many sources added. Limit is ${INGEST_LIMITS.maxCreatesPerWindow} per 10 minutes — try again shortly.`,
    );
  }

  prior.push(now);
  createBuckets.set(userId, prior);
}

export async function assertNotebookSourceCapacity(notebookId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(sources)
    .where(eq(sources.notebookId, notebookId));

  const total = row?.value ?? 0;
  if (total >= INGEST_LIMITS.maxSourcesPerNotebook) {
    throw new Error(
      `This notebook already has ${INGEST_LIMITS.maxSourcesPerNotebook} sources. Delete some before adding more.`,
    );
  }
}
