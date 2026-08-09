import type { ModulePlanNavigationAdapter } from "../contracts";

const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/u;

export interface BilibiliPlanIdentity {
  kind: "bvid";
  value: string;
  canonicalUrl: string;
}

export function extractBilibiliPlanIdentity(input: string | URL): BilibiliPlanIdentity | null {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !isBilibiliHostname(url.hostname)) return null;
  const pathValue = url.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/iu)?.[1];
  const queryValue = url.searchParams.get("bvid") ?? "";
  const rawValue = pathValue ?? (BVID_PATTERN.test(queryValue) ? queryValue : undefined);
  if (!rawValue) return null;
  const value = `BV${rawValue.slice(2)}`;
  return { kind: "bvid", value, canonicalUrl: `https://www.bilibili.com/video/${value}` };
}

export function isBilibiliPlanIdentity(value: unknown): value is string {
  return typeof value === "string" && BVID_PATTERN.test(value);
}

/** Compatibility exports owned by the optional module rather than shared core. */
export const isBvid = isBilibiliPlanIdentity;
export function extractBvidFromVideoUrl(input: string | URL): string | null {
  return extractBilibiliPlanIdentity(input)?.value ?? null;
}
export function canonicalVideoUrl(bvid: string): string {
  if (!isBilibiliPlanIdentity(bvid)) throw new Error("Invalid Bilibili video identity");
  return `https://www.bilibili.com/video/${bvid}`;
}

export const BILIBILI_PLAN_NAVIGATION_ADAPTER: ModulePlanNavigationAdapter = Object.freeze({
  createNavigationRequest(url: string) {
    const identity = extractBilibiliPlanIdentity(url);
    return {
      type: "GET_PLAN_NAVIGATION_DECISION" as const,
      url,
      ...(identity ? { bvid: identity.value } : {})
    };
  }
});

function isBilibiliHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return normalized === "bilibili.com" || normalized.endsWith(".bilibili.com");
}
