import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export type ExtractedUrlArticle = {
  title: string;
  canonicalUrl: string;
  content: string;
  excerpt: string | null;
  siteName: string | null;
  headings: string[];
};

function normalizeUrl(input: string) {
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return new URL(withProtocol).toString();
}

function htmlToPlainText(html: string): { text: string; headings: string[] } {
  // linkedom needs a full document shell; a bare <body> fragment leaves content outside body.
  const { document, Node } = parseHTML(
    `<html><body>${html}</body></html>`,
  );
  const body = document.body;
  const headings: string[] = [];
  const parts: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent?.replace(/\s+/g, " ").trim();
      if (value) {
        parts.push(value);
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (["script", "style", "noscript"].includes(tag)) {
      return;
    }

    if (/^h[1-6]$/.test(tag)) {
      const heading = el.textContent?.replace(/\s+/g, " ").trim();
      if (heading) {
        headings.push(heading);
        parts.push(`\n\n## ${heading}\n\n`);
      }
      return;
    }

    if (["p", "div", "section", "article", "li", "br", "tr"].includes(tag)) {
      parts.push("\n\n");
    }

    for (const child of Array.from(el.childNodes)) {
      walk(child);
    }
  };

  walk(body);

  const text = parts
    .join(" ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return { text, headings };
}

/** Fetch a page and extract readable article content via Mozilla Readability. */
export async function extractUrlArticle(
  rawUrl: string,
): Promise<ExtractedUrlArticle> {
  const url = normalizeUrl(rawUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "KnowledgeWorkbenchBot/1.0 (+https://localhost; research assistant)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Timed out while fetching the URL");
    }
    throw new Error(
      error instanceof Error ? error.message : "Failed to fetch URL",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch URL (HTTP ${response.status})`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml")
  ) {
    throw new Error("URL did not return an HTML page");
  }

  const html = await response.text();
  const { document } = parseHTML(html);
  // Readability uses document.baseURI for relative URL resolution.
  Object.defineProperty(document, "baseURI", {
    configurable: true,
    value: url,
  });
  if (!document.documentURI) {
    Object.defineProperty(document, "documentURI", {
      configurable: true,
      value: url,
    });
  }

  const reader = new Readability(document as unknown as Document);
  const article = reader.parse();

  if (!article?.textContent?.trim() && !article?.content?.trim()) {
    throw new Error("Could not extract readable article content from URL");
  }

  const { text, headings } = article.content
    ? htmlToPlainText(article.content)
    : {
        text: article.textContent?.trim() ?? "",
        headings: [] as string[],
      };

  if (!text.trim()) {
    throw new Error("Extracted article content was empty");
  }

  const canonical =
    document.querySelector('link[rel="canonical"]')?.getAttribute("href") ??
    response.url ??
    url;

  let canonicalUrl = url;
  try {
    canonicalUrl = new URL(canonical, url).toString();
  } catch {
    canonicalUrl = url;
  }

  return {
    title: article.title?.trim() || document.title?.trim() || canonicalUrl,
    canonicalUrl,
    content: text,
    excerpt: article.excerpt?.trim() || null,
    siteName: article.siteName?.trim() || null,
    headings,
  };
}

export { normalizeUrl };
