import { PLAN_ITEM_SOURCES, type PlanItemInput, type PlanItemSource } from "./types";

export const MAX_PLAN_ITEMS = 500;
export const MAX_PLAN_IMPORT_ITEMS = 100;
export const MAX_PLAN_TITLE_LENGTH = 200;
export const MAX_PLAN_ID_LENGTH = 100;

const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const BILIBILI_HOST_PATTERN = /(^|\.)bilibili\.com$/i;

export interface NormalizedPlanItemInput {
  bvid: string;
  url: string;
  title: string;
  source: PlanItemSource;
}

export function isBvid(value: unknown): value is string {
  return typeof value === "string" && BVID_PATTERN.test(value);
}

/** Returns a BVID only for an actual HTTPS Bilibili /video/:bvid route. */
export function extractBvidFromVideoUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4_096) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !BILIBILI_HOST_PATTERN.test(url.hostname)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() !== "video" || !isBvid(segments[1])) return null;
  return segments[1];
}

export function canonicalVideoUrl(bvid: string): string {
  if (!isBvid(bvid)) throw new Error("Invalid BVID");
  return `https://www.bilibili.com/video/${bvid}`;
}

/**
 * Validates a queue input and reduces it to the minimum persisted video identity.
 * If both URL and BVID are present they must identify the same video.
 */
export function normalizePlanItemInput(
  input: unknown,
  fallbackSource: PlanItemSource = "manual"
): NormalizedPlanItemInput | null {
  if (!isRecord(input)) return null;
  if (!isPlanItemSource(fallbackSource)) return null;

  const fromBvid = input.bvid === undefined ? null : isBvid(input.bvid) ? input.bvid : null;
  const fromUrl = input.url === undefined ? null : extractBvidFromVideoUrl(input.url);
  if (input.bvid !== undefined && fromBvid === null) return null;
  if (input.url !== undefined && fromUrl === null) return null;
  if (fromBvid && fromUrl && fromBvid !== fromUrl) return null;
  const bvid = fromBvid ?? fromUrl;
  if (!bvid) return null;

  if (input.title !== undefined && typeof input.title !== "string") return null;
  if (typeof input.title === "string" && input.title.length > MAX_PLAN_TITLE_LENGTH) return null;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length > MAX_PLAN_TITLE_LENGTH) return null;

  const source = input.source === undefined ? fallbackSource : input.source;
  if (!isPlanItemSource(source)) return null;
  return {
    bvid,
    url: canonicalVideoUrl(bvid),
    title: title || bvid,
    source
  };
}

export function isPlanItemSource(value: unknown): value is PlanItemSource {
  return typeof value === "string" && PLAN_ITEM_SOURCES.includes(value as PlanItemSource);
}

export function isPlanItemInput(value: unknown): value is PlanItemInput {
  return normalizePlanItemInput(value) !== null;
}

export function isPlanId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_PLAN_ID_LENGTH &&
    value.trim() === value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
