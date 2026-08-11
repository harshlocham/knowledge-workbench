/**
 * Structured application errors. Server throws AppError; clients parse the
 * wire-safe `[CODE] message` format because custom Error fields often drop
 * across the TanStack Start RPC boundary.
 */

export const APP_ERROR_CODES = [
	"UNAUTHORIZED",
	"NOTEBOOK_LIMIT",
	"SOURCE_LIMIT",
	"STUDIO_GENERATION_LIMIT",
	"PRO_FEATURE",
	"VALIDATION",
	"GENERATION_FAILED",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

const CODE_SET = new Set<string>(APP_ERROR_CODES);

export class AppError extends Error {
	readonly code: AppErrorCode;

	constructor(code: AppErrorCode, message: string) {
		super(formatAppErrorMessage(code, message));
		this.name = "AppError";
		this.code = code;
	}
}

export function formatAppErrorMessage(code: AppErrorCode, message: string) {
	return `[${code}] ${message}`;
}

export function parseAppError(error: unknown): {
	code: AppErrorCode | null;
	message: string;
} {
	const raw =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "";

	const match = /^\[([A-Z_]+)\]\s*(.*)$/s.exec(raw.trim());
	const codeCandidate = match?.[1];
	if (codeCandidate && CODE_SET.has(codeCandidate)) {
		return {
			code: codeCandidate as AppErrorCode,
			message: match?.[2]?.trim() || raw,
		};
	}

	if (error instanceof AppError) {
		return { code: error.code, message: stripCodePrefix(error.message) };
	}

	return { code: null, message: raw || "Something went wrong" };
}

function stripCodePrefix(message: string) {
	const match = /^\[([A-Z_]+)\]\s*(.*)$/s.exec(message.trim());
	return match?.[2]?.trim() || message;
}

export function isLimitOrProError(code: AppErrorCode | null) {
	return (
		code === "NOTEBOOK_LIMIT" ||
		code === "SOURCE_LIMIT" ||
		code === "STUDIO_GENERATION_LIMIT" ||
		code === "PRO_FEATURE"
	);
}

/** Maps error codes to waitlist intent sources. */
export function upgradeSourceForError(
	code: AppErrorCode | null,
): "studio_generation_limit" | "export" | "share" | "general_upgrade" {
	if (code === "STUDIO_GENERATION_LIMIT") return "studio_generation_limit";
	return "general_upgrade";
}
