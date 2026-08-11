/**
 * Share tokens are opaque bearer credentials. They must be long, random, and
 * independent of the artifact UUID so guessing one is infeasible.
 */

const SHARE_TOKEN_BYTES = 32;
/** base64url of 32 bytes is 43 characters with no padding. */
export const SHARE_TOKEN_MIN_LENGTH = 32;

export function createShareToken(): string {
	const bytes = new Uint8Array(SHARE_TOKEN_BYTES);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

/** Loose shape check used by the public route before hitting the database. */
export function isShareTokenShape(token: string) {
	return (
		typeof token === "string" &&
		token.length >= SHARE_TOKEN_MIN_LENGTH &&
		/^[A-Za-z0-9_-]+$/.test(token)
	);
}
