import { extractText, getDocumentProxy } from "unpdf";

export type PdfPageText = {
	page: number;
	text: string;
};

/** Page-aware PDF text extraction via unpdf (PDF.js). */
export async function extractPdfPages(
	data: Uint8Array,
): Promise<{ pages: PdfPageText[]; pageCount: number }> {
	const pdf = await getDocumentProxy(data);
	const { totalPages, text } = await extractText(pdf, { mergePages: false });

	const pageTexts = Array.isArray(text) ? text : [text];
	const pages = pageTexts
		.map((pageText, index) => ({
			page: index + 1,
			text: pageText.replace(/\r\n/g, "\n").trim(),
		}))
		.filter((page) => page.text.length > 0);

	return {
		pages,
		pageCount: totalPages,
	};
}
