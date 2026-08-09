import { PLAN_ITEM_SOURCES, type PlanItemInput, type PlanItemSource } from "./types";

export const MAX_PLAN_ITEMS = 500;
export const MAX_PLAN_IMPORT_ITEMS = 100;
export const MAX_PLAN_TITLE_LENGTH = 200;
export const MAX_PLAN_ID_LENGTH = 100;

export interface NormalizedPlanItemInput {
  url: string;
  origin: string;
  identity: string;
  bvid?: string;
  title: string;
  source: PlanItemSource;
}

/**
 * Validates a queue input and reduces it to the minimum persisted page identity.
 * A legacy opaque identity may be retained alongside the URL during migration.
 */
export function normalizePlanItemInput(
  input: unknown,
  fallbackSource: PlanItemSource = "manual"
): NormalizedPlanItemInput | null {
  if (!isRecord(input)) return null;
  if (!isPlanItemSource(fallbackSource)) return null;

  if (typeof input.url !== "string") return null;
  const url = normalizePlanUrl(input.url);
  if (!url) return null;
  if (input.bvid !== undefined && (typeof input.bvid !== "string" || input.bvid.length > 100))
    return null;

  if (input.title !== undefined && typeof input.title !== "string") return null;
  if (typeof input.title === "string" && input.title.length > MAX_PLAN_TITLE_LENGTH) return null;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length > MAX_PLAN_TITLE_LENGTH) return null;

  const source = input.source === undefined ? fallbackSource : input.source;
  if (!isPlanItemSource(source)) return null;
  return {
    url: url.href,
    origin: url.origin,
    identity: url.href,
    ...(typeof input.bvid === "string" ? { bvid: input.bvid } : {}),
    title: title || url.hostname,
    source
  };
}

export function normalizePlanUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 4_096) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    url.hash = "";
    return url;
  } catch {
    return null;
  }
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
