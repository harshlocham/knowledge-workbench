import { auth } from "@clerk/tanstack-react-start/server";

export async function requireUserId() {
	const { userId } = await auth();

	if (!userId) {
		throw new Error("Unauthorized");
	}

	return userId;
}

export async function getOptionalUserId() {
	const { userId } = await auth();
	return userId ?? null;
}
