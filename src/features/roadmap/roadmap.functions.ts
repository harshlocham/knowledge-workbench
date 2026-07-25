import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { chunks } from "#/db/schema/chunks.ts";
import { sources } from "#/db/schema/sources.ts";
import { requireOwnedNotebook } from "#/features/sources/notebook-access.server.ts";
import {
  generateLearningRoadmap,
  sampleClipsForRoadmap,
  type LearningRoadmap,
  type RoadmapClipInput,
} from "#/lib/rag/generate-roadmap.server.ts";

export type { LearningRoadmap };

export const buildLearningRoadmap = createServerFn({ method: "POST" })
  .validator(
    z.object({
      notebookId: z.string().uuid(),
      focus: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ data }): Promise<LearningRoadmap> => {
    await requireOwnedNotebook(data.notebookId);

    const youtubeSources = await db
      .select({
        id: sources.id,
        title: sources.title,
      })
      .from(sources)
      .where(
        and(
          eq(sources.notebookId, data.notebookId),
          eq(sources.type, "youtube"),
          eq(sources.status, "ready"),
        ),
      )
      .orderBy(asc(sources.createdAt));

    if (youtubeSources.length === 0) {
      throw new Error(
        "Add at least one ready YouTube source to generate a learning roadmap.",
      );
    }

    const sourceIds = youtubeSources.map((s) => s.id);
    const titleById = new Map(youtubeSources.map((s) => [s.id, s.title]));

    const chunkRows = await db
      .select({
        id: chunks.id,
        sourceId: chunks.sourceId,
        content: chunks.content,
        locator: chunks.locator,
        chunkIndex: chunks.chunkIndex,
      })
      .from(chunks)
      .where(
        and(
          eq(chunks.notebookId, data.notebookId),
          inArray(chunks.sourceId, sourceIds),
        ),
      )
      .orderBy(asc(chunks.sourceId), asc(chunks.chunkIndex));

    const clips: RoadmapClipInput[] = chunkRows.map((row, i) => ({
      index: i + 1,
      chunkId: row.id,
      sourceId: row.sourceId,
      sourceTitle: titleById.get(row.sourceId) ?? "YouTube",
      text: row.content,
      locator: row.locator ?? {},
    }));

    const sampled = sampleClipsForRoadmap(clips);

    return generateLearningRoadmap({
      clips: sampled,
      sourceCount: youtubeSources.length,
      focus: data.focus,
    });
  });
