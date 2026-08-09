import type { SectionId } from "../../shared/types";
import {
  BILIBILI_SECTION_TARGETS,
  BILIBILI_SITE_MODULE_DESCRIPTOR,
  BILIBILI_SITE_MODULE_HASH_INPUT
} from "./descriptor";
import {
  BILIBILI_PLAN_NAVIGATION_ADAPTER,
  canonicalVideoUrl,
  extractBvidFromVideoUrl,
  extractBilibiliPlanIdentity,
  isBvid,
  isBilibiliPlanIdentity
} from "./plan-identity";
import { BILIBILI_SITE_MODULE } from "./site-module";

export function classifyBilibiliModuleUrl(input: string | URL): SectionId | null {
  return (BILIBILI_SITE_MODULE.match(input)?.sectionId as SectionId | undefined) ?? null;
}

export {
  BILIBILI_PLAN_NAVIGATION_ADAPTER,
  BILIBILI_SECTION_TARGETS,
  BILIBILI_SITE_MODULE_DESCRIPTOR,
  BILIBILI_SITE_MODULE_HASH_INPUT,
  canonicalVideoUrl,
  extractBvidFromVideoUrl,
  extractBilibiliPlanIdentity,
  isBvid,
  isBilibiliPlanIdentity
};
export { BILIBILI_SITE_MODULE };
export * from "./integrations/manual";
export * from "./integrations/open-platform";
export * from "./integrations/types";
export { BILIBILI_SITE_MODULE_MANIFEST } from "./metadata";
