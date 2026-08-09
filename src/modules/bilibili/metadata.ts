import type { SiteModuleManifest } from "../../shared/types";

export const BILIBILI_SECTION_TARGETS = Object.freeze({
  home: "module:bilibili:home",
  dynamic: "module:bilibili:dynamic",
  popular: "module:bilibili:popular",
  video: "module:bilibili:video",
  live: "module:bilibili:live",
  bangumi: "module:bilibili:bangumi",
  search: "module:bilibili:search"
});

/** Metadata-only catalog entry; importing it never pulls selectors or executable hooks. */
export const BILIBILI_SITE_MODULE_MANIFEST = Object.freeze({
  id: "hourleaf.site.bilibili",
  version: "1.0.0",
  name: "Bilibili",
  hosts: [
    "https://www.bilibili.com/*",
    "https://live.bilibili.com/*",
    "https://t.bilibili.com/*",
    "https://search.bilibili.com/*"
  ],
  sections: [
    {
      id: "home",
      targetId: BILIBILI_SECTION_TARGETS.home,
      label: "首页",
      hosts: ["https://www.bilibili.com/*"]
    },
    {
      id: "dynamic",
      targetId: BILIBILI_SECTION_TARGETS.dynamic,
      label: "动态",
      hosts: ["https://www.bilibili.com/*", "https://t.bilibili.com/*"]
    },
    {
      id: "popular",
      targetId: BILIBILI_SECTION_TARGETS.popular,
      label: "热门",
      hosts: ["https://www.bilibili.com/*"]
    },
    {
      id: "video",
      targetId: BILIBILI_SECTION_TARGETS.video,
      label: "视频",
      hosts: ["https://www.bilibili.com/*"]
    },
    {
      id: "live",
      targetId: BILIBILI_SECTION_TARGETS.live,
      label: "直播",
      hosts: ["https://live.bilibili.com/*"]
    },
    {
      id: "bangumi",
      targetId: BILIBILI_SECTION_TARGETS.bangumi,
      label: "番剧影视",
      hosts: ["https://www.bilibili.com/*"]
    },
    {
      id: "search",
      targetId: BILIBILI_SECTION_TARGETS.search,
      label: "搜索",
      hosts: ["https://www.bilibili.com/*", "https://search.bilibili.com/*"]
    }
  ],
  capabilities: ["classify", "content-filter", "plan", "usage-tracking"]
} as const satisfies SiteModuleManifest);
