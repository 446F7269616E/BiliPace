import type { ImportedBilibiliVideo } from "./types";

const BVID_PATTERN = /\b(BV[0-9A-Za-z]{10})\b/;
const MARKDOWN_LINK_PATTERN = /^\s*\[([^\]]{1,240})\]\((https?:\/\/[^\s)]+)\)\s*$/;
const URL_PATTERN = /https?:\/\/[^\s<>\])}"']+/i;

export const MANUAL_IMPORT_LIMITS = Object.freeze({
  maxInputCharacters: 100_000,
  maxLines: 1_000,
  maxItems: 500,
  maxTitleCharacters: 120
});

export type ManualImportRejectionReason =
  | "empty"
  | "invalid-url"
  | "unsupported-host"
  | "insecure-url"
  | "missing-bvid"
  | "short-link-requires-browser"
  | "item-limit";

export interface ManualImportRejection {
  lineNumber: number;
  /** Trimmed and bounded so error rendering cannot echo an unlimited input. */
  input: string;
  reason: ManualImportRejectionReason;
}

export interface ManualImportResult {
  items: ImportedBilibiliVideo[];
  rejected: ManualImportRejection[];
  duplicateCount: number;
  truncated: boolean;
}

interface ParsedLine {
  candidate: string;
  title?: string;
}

/**
 * Parse pasted links locally. No redirects are followed and no page metadata is
 * fetched, so the operation never exposes the user's Bilibili session.
 */
export function parseManualBilibiliImport(input: string): ManualImportResult {
  const boundedInput = input.slice(0, MANUAL_IMPORT_LIMITS.maxInputCharacters);
  const allLines = boundedInput.split(/\r?\n/);
  const lines = allLines.slice(0, MANUAL_IMPORT_LIMITS.maxLines);
  const items: ImportedBilibiliVideo[] = [];
  const rejected: ManualImportRejection[] = [];
  const seenBvids = new Set<string>();
  let duplicateCount = 0;

  for (const [lineIndex, rawLine] of lines.entries()) {
    const lineNumber = lineIndex + 1;
    const line = rawLine.trim();
    if (!line) continue;

    if (items.length >= MANUAL_IMPORT_LIMITS.maxItems) {
      rejected.push(rejection(lineNumber, line, "item-limit"));
      continue;
    }

    const parsedLine = splitLine(line);
    const parsedVideo = parseBilibiliVideoReference(parsedLine.candidate, parsedLine.title);
    if (!parsedVideo.ok) {
      rejected.push(rejection(lineNumber, line, parsedVideo.reason));
      continue;
    }

    if (seenBvids.has(parsedVideo.item.bvid)) {
      duplicateCount += 1;
      continue;
    }

    seenBvids.add(parsedVideo.item.bvid);
    items.push(parsedVideo.item);
  }

  return {
    items,
    rejected,
    duplicateCount,
    truncated:
      input.length > MANUAL_IMPORT_LIMITS.maxInputCharacters ||
      allLines.length > MANUAL_IMPORT_LIMITS.maxLines
  };
}

export type BilibiliVideoReferenceResult =
  | { ok: true; item: ImportedBilibiliVideo }
  | { ok: false; reason: Exclude<ManualImportRejectionReason, "empty" | "item-limit"> };

export function parseBilibiliVideoReference(
  candidate: string,
  preferredTitle?: string
): BilibiliVideoReferenceResult {
  const value = candidate.trim();
  const bareBvid = value.match(new RegExp(`^${BVID_PATTERN.source}$`, "i"));
  if (bareBvid?.[1]) return success(normalizeBvid(bareBvid[1]), preferredTitle);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "insecure-url" };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "b23.tv" || hostname.endsWith(".b23.tv")) {
    return { ok: false, reason: "short-link-requires-browser" };
  }
  if (hostname !== "bilibili.com" && !hostname.endsWith(".bilibili.com")) {
    return { ok: false, reason: "unsupported-host" };
  }

  const bvid = extractBvid(url);
  if (!bvid) return { ok: false, reason: "missing-bvid" };
  return success(bvid, preferredTitle);
}

function splitLine(line: string): ParsedLine {
  const markdownMatch = line.match(MARKDOWN_LINK_PATTERN);
  if (markdownMatch?.[1] && markdownMatch[2]) {
    return { candidate: markdownMatch[2], title: markdownMatch[1] };
  }

  const urlMatch = line.match(URL_PATTERN);
  if (!urlMatch) return { candidate: line };

  const prefix = line
    .slice(0, urlMatch.index)
    .replace(/[\s|\-:：]+$/u, "")
    .trim();
  return { candidate: urlMatch[0], title: prefix || undefined };
}

function extractBvid(url: URL): string | null {
  const pathMatch = url.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/i);
  const queryMatch = url.searchParams
    .get("bvid")
    ?.match(new RegExp(`^${BVID_PATTERN.source}$`, "i"));
  const rawBvid = pathMatch?.[1] ?? queryMatch?.[1];
  return rawBvid ? normalizeBvid(rawBvid) : null;
}

function normalizeBvid(value: string): string {
  return `BV${value.slice(2)}`;
}

function success(bvid: string, preferredTitle?: string): BilibiliVideoReferenceResult {
  const title = sanitizeTitle(preferredTitle) || bvid;
  return {
    ok: true,
    item: {
      bvid,
      title,
      url: `https://www.bilibili.com/video/${bvid}`
    }
  };
}

function sanitizeTitle(value?: string): string {
  const withoutControlCharacters = Array.from(value ?? "", (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  }).join("");

  return withoutControlCharacters
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MANUAL_IMPORT_LIMITS.maxTitleCharacters);
}

function rejection(
  lineNumber: number,
  input: string,
  reason: ManualImportRejectionReason
): ManualImportRejection {
  return { lineNumber, input: input.slice(0, 240), reason };
}
