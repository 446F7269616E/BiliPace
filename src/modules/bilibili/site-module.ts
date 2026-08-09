import { createDeclarativeSiteModule } from "../runtime";
import { BILIBILI_SITE_MODULE_DESCRIPTOR } from "./descriptor";
import { BILIBILI_PLAN_NAVIGATION_ADAPTER } from "./plan-identity";

export const BILIBILI_SITE_MODULE = createDeclarativeSiteModule(BILIBILI_SITE_MODULE_DESCRIPTOR, {
  plan: BILIBILI_PLAN_NAVIGATION_ADAPTER,
  contentSettings: (settings) =>
    settings.legacyCapsules.bilibili?.contentFilters ?? settings.contentFilters
});
