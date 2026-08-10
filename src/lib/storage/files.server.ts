import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

/**
 * Source binary storage.
 * - Local disk when S3_BUCKET is unset (dev default)
 * - S3 / Cloudflare R2 when S3_BUCKET (+ credentials) are set
 *
 * Keys stay portable: `uploads/{notebookId}/{sourceId}.{pdf|vtt}`
 */

const UPLOAD_ROOT =
	process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

function s3Config() {
	const bucket = process.env.S3_BUCKET?.trim();
	if (!bucket) return null;

	const region = process.env.S3_REGION?.trim() || "auto";
	const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
	const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
	const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();

	if (!accessKeyId || !secretAccessKey) {
		throw new Error(
			"S3_BUCKET is set but S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are missing",
		);
	}

	return {
		bucket,
		client: new S3Client({
			region,
			endpoint,
			forcePathStyle: Boolean(endpoint),
			credentials: { accessKeyId, secretAccessKey },
		}),
	};
}

function objectKey(storageKey: string) {
	return storageKey.replace(/^\/+/, "");
}

export function pdfStorageKey(notebookId: string, sourceId: string) {
	return path.posix.join("uploads", notebookId, `${sourceId}.pdf`);
}

export function vttStorageKey(notebookId: string, sourceId: string) {
	return path.posix.join("uploads", notebookId, `${sourceId}.vtt`);
}

function resolveLocalPath(storageKey: string) {
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

export function isRemoteStorageEnabled() {
	return Boolean(process.env.S3_BUCKET?.trim());
}

export async function saveSourceFile(options: {
	storageKey: string;
	data: Uint8Array;
	contentType?: string;
}) {
	const remote = s3Config();
	if (remote) {
		await remote.client.send(
			new PutObjectCommand({
				Bucket: remote.bucket,
				Key: objectKey(options.storageKey),
				Body: options.data,
				ContentType: options.contentType ?? "application/octet-stream",
			}),
		);
		return options.storageKey;
	}

	const absolute = resolveLocalPath(options.storageKey);
	await mkdir(path.dirname(absolute), { recursive: true });
	await writeFile(absolute, options.data);
	return options.storageKey;
}

export async function readSourceFile(storageKey: string) {
	const remote = s3Config();
	if (remote) {
		const response = await remote.client.send(
			new GetObjectCommand({
				Bucket: remote.bucket,
				Key: objectKey(storageKey),
			}),
		);
		const body = response.Body;
		if (!body) {
			throw new Error("Source file is empty in object storage");
		}
		const bytes = await body.transformToByteArray();
		return Buffer.from(bytes);
	}

	return readFile(resolveLocalPath(storageKey));
}

export async function deleteSourceFile(storageKey: string | null | undefined) {
	if (!storageKey) {
		return;
	}

	const remote = s3Config();
	if (remote) {
		try {
			await remote.client.send(
				new DeleteObjectCommand({
					Bucket: remote.bucket,
					Key: objectKey(storageKey),
				}),
			);
		} catch (error) {
			console.error("[storage] failed to delete object", storageKey, error);
		}
		return;
	}

	try {
		await unlink(resolveLocalPath(storageKey));
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
