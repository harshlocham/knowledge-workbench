/** Split assistant summary content into body + clickable follow-up questions. */
export function splitFollowUpQuestions(content: string): {
	body: string;
	questions: string[];
} {
	const match = content.match(
		/\n(?:#{1,3}\s*)?Follow-up questions:?\s*\n([\s\S]*)$/i,
	);
	if (!match || match.index == null) {
		return { body: content, questions: [] };
	}

	const body = content.slice(0, match.index).trimEnd();
	const questions = match[1]
		.split("\n")
		.map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
		.map((line) => line.replace(/\*+/g, "").trim())
		.filter((line) => line.length >= 12)
		.map((line) => (line.endsWith("?") ? line : `${line}?`))
		.slice(0, 6);

	return { body, questions };
}
