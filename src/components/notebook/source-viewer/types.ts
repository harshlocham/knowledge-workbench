import type { MessageCitation } from "#/db/schema/messages.ts";

export type ViewerHighlight = {
  chunkId: string;
  content: string;
  locator?: MessageCitation["locator"];
};

export type ViewerCue = {
  cueIndex: number;
  tStart: number;
  tEnd: number;
  text: string;
};

export type ViewerPage = {
  page: number;
  text: string;
};

export type ViewerSource = {
  id: string;
  title: string;
  type: "pdf" | "text" | "url" | "youtube" | "vtt" | string;
  status: string;
  content: string;
  highlight: ViewerHighlight | null;
  originalUrl?: string | null;
  videoId?: string | null;
  pages?: ViewerPage[] | null;
  cues?: ViewerCue[] | null;
  pageCount?: number | null;
  hasFile?: boolean;
};

export type CitationNavItem = MessageCitation & {
  key: string;
};
