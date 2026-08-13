import {
  PLAN_COMPLETION_MODES,
  PLAN_ITEM_SOURCES,
  type PlanCompletionMode,
  type PlanItemInput,
  type PlanItemSource
} from "./types";

export const MAX_PLAN_ITEMS = 500;
export const MAX_PLAN_IMPORT_ITEMS = 100;
export const MAX_PLAN_TITLE_LENGTH = 200;
export const MAX_PLAN_ID_LENGTH = 100;
export const MIN_PLAN_DURATION_MINUTES = 1;
export const MAX_PLAN_DURATION_MINUTES = 1_440;
export const LEGACY_PLAN_DURATION_MINUTES = 45;
export const MIN_PLAN_FLOW_EXTENSION_MINUTES = 1;
export const MAX_PLAN_FLOW_EXTENSION_MINUTES = 15;

export interface NormalizedPlanItemInput {
  url: string;
  origin: string;
  identity: string;
  bvid?: string;
  title: string;
  source: PlanItemSource;
  scheduledDurationMinutes: number;
  completionMode: PlanCompletionMode;
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
  if (!isPlanDurationMinutes(input.scheduledDurationMinutes)) return null;
  if (!isPlanCompletionMode(input.completionMode)) return null;
  return {
    url: url.href,
    origin: url.origin,
    identity: url.href,
    ...(typeof input.bvid === "string" ? { bvid: input.bvid } : {}),
    title: title || url.hostname,
    source,
    scheduledDurationMinutes: input.scheduledDurationMinutes,
    completionMode: input.completionMode
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

export function isPlanCompletionMode(value: unknown): value is PlanCompletionMode {
  return typeof value === "string" && PLAN_COMPLETION_MODES.includes(value as PlanCompletionMode);
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

export function isPlanDurationMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_PLAN_DURATION_MINUTES &&
    value <= MAX_PLAN_DURATION_MINUTES
  );
}

export function isPlanFlowExtensionMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_PLAN_FLOW_EXTENSION_MINUTES &&
    value <= MAX_PLAN_FLOW_EXTENSION_MINUTES
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
