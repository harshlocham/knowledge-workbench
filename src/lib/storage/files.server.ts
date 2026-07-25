import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local file storage for source binaries.
 * Paths are relative keys like `uploads/{notebookId}/{sourceId}.pdf`.
 * Swap the internals later for S3 without changing the indexing pipeline.
 */

const UPLOAD_ROOT = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

export function pdfStorageKey(notebookId: string, sourceId: string) {
  return path.posix.join("uploads", notebookId, `${sourceId}.pdf`);
}

function resolveStoragePath(storageKey: string) {
  const relative = storageKey.replace(/^uploads\/?/, "");
  const absolute = path.resolve(UPLOAD_ROOT, relative);

  if (
    absolute !== UPLOAD_ROOT &&
    !absolute.startsWith(`${UPLOAD_ROOT}${path.sep}`)
  ) {
    throw new Error("Invalid storage path");
  }

  return absolute;
}

export async function saveSourceFile(options: {
  storageKey: string;
  data: Uint8Array;
}) {
  const absolute = resolveStoragePath(options.storageKey);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, options.data);
  return options.storageKey;
}

export async function readSourceFile(storageKey: string) {
  const absolute = resolveStoragePath(storageKey);
  return readFile(absolute);
}

export async function deleteSourceFile(storageKey: string | null | undefined) {
  if (!storageKey) {
    return;
  }

  try {
    await unlink(resolveStoragePath(storageKey));
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}
