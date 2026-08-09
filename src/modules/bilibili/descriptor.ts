import { createSiteModuleHashInput, type SiteModuleDescriptor } from "../contracts";
import { BILIBILI_SECTION_TARGETS, BILIBILI_SITE_MODULE_MANIFEST } from "./metadata";

const excludeModuleView = { excludeQueryKeys: ["page"] } as const;

export const BILIBILI_SITE_MODULE_DESCRIPTOR = Object.freeze({
  schemaVersion: 1,
  manifest: BILIBILI_SITE_MODULE_MANIFEST,
  fallbackUrl: "https://www.bilibili.com/video/",
  routes: [
    {
      targetId: BILIBILI_SECTION_TARGETS.search,
      sectionId: "search",
      match: {
        hostname: "www.bilibili.com",
        query: { key: "page", value: "search", caseInsensitive: true }
      }
    },
    {
      targetId: BILIBILI_SECTION_TARGETS.bangumi,
      sectionId: "bangumi",
      match: {
        hostname: "www.bilibili.com",
        query: { key: "page", value: "anime", caseInsensitive: true }
      }
    },
    {
      targetId: BILIBILI_SECTION_TARGETS.dynamic,
      sectionId: "dynamic",
      match: {
        hostname: "www.bilibili.com",
        query: { key: "page", value: "moments", caseInsensitive: true }
      }
    },
    {
      targetId: BILIBILI_SECTION_TARGETS.home,
      sectionId: "home",
      match: {
        hostname: "www.bilibili.com",
        query: { key: "page", value: "home", caseInsensitive: true }
      }
    },
    {
      targetId: BILIBILI_SECTION_TARGETS.live,
      sectionId: "live",
      match: { hostname: "live.bilibili.com" }
    },
    {
      targetId: BILIBILI_SECTION_TARGETS.dynamic,
      sectionId: "dynamic",
      match: { hostname: "t.bilibili.com" }
    },
    {
      targetId: BILIBILI_SECTION_TARGETS.search,
      sectionId: "search",
      match: { hostname: "search.bilibili.com" }
    },
    {
      targetId: BILIBILI_SECTION_TARGETS.home,
      sectionId: "home",
      match: {
        hostname: "www.bilibili.com",
        path: { kind: "exact", values: ["/", "/index.html"] },
        ...excludeModuleView
      }
    },
    {
      targetId: BILIBILI_SECTION_TARGETS.dynamic,
      sectionId: "dynamic",
      match: {
        hostname: "www.bilibili.com",
        path: { kind: "prefix", values: ["/v/dynamic", "/dynamic"] },
        ...excludeModuleView
      }
    },
    {
      targetId: BILIBILI_SECTION_TARGETS.popular,
      sectionId: "popular",
      match: {
        hostname: "www.bilibili.com",
        path: { kind: "prefix", values: ["/v/popular"] },
        ...excludeModuleView
      }
    },
    {
      targetId: BILIBILI_SECTION_TARGETS.video,
      sectionId: "video",
      match: {
        hostname: "www.bilibili.com",
        path: {
          kind: "prefix",
          values: ["/video", "/list", "/medialist/play"]
        },
        ...excludeModuleView
      }
    },
    {
      targetId: BILIBILI_SECTION_TARGETS.bangumi,
      sectionId: "bangumi",
      match: {
        hostname: "www.bilibili.com",
        path: {
          kind: "prefix",
          values: ["/bangumi", "/guochuang", "/cinema", "/movie", "/tv", "/documentary"]
        },
        ...excludeModuleView
      }
    }
  ],
  contentProfiles: [
    {
      id: "native",
      root: { id: "document", kind: "document" },
      hiddenElementSelectors: {
        "home-feed": [
          ".recommended-container",
          ".recommended-container_floor-aside",
          ".feed2 .container"
        ],
        "dynamic-feed": [".bili-dyn-list", ".bili-dyn-list__items", ".opus-list"],
        "related-videos": [
          "#reco_list",
          ".recommend-list-v1",
          ".rec-list",
          ".video-page-card-small"
        ],
        comments: ["#comment", ".comment-container", ".reply-warp", "bili-comments"],
        "search-suggestions": [".nav-search-suggest", ".search-panel", ".suggest-wrap"],
        ads: [
          ".ad-report",
          ".banner-card",
          ".floor-single-card",
          ".video-card-ad-small",
          "a[href*='cm.bilibili.com']"
        ],
        "top-navigation": ["#internationalHeader", ".bili-header"]
      },
      routeScopedFilters: {
        "home-feed": ["home"],
        "dynamic-feed": ["dynamic"],
        "related-videos": ["video"]
      },
      videoCardSelectors: [
        ".bili-video-card",
        ".feed-card",
        ".video-item",
        ".small-item",
        ".bili-dyn-card-video",
        ".video-page-card-small"
      ],
      videoTitleSelectors: [".bili-video-card__info--tit", ".title", "h3", "[title]"],
      searchInputSelectors: [
        ".nav-search-input",
        "#nav-searchform input",
        "input[type='search']",
        "input[placeholder*='搜索']"
      ]
    },
    {
      id: "ave-mujica",
      root: { id: "bewly-shadow", kind: "open-shadow", hostSelector: "#bewly" },
      hiddenElementSelectors: {
        "home-feed": [".video-card"],
        "dynamic-feed": [".video-card"],
        "search-suggestions": ["#search-suggestion"],
        "top-navigation": ["header:has(.right-side):has(.logo)"]
      },
      routeScopedFilters: {
        "home-feed": ["home"],
        "dynamic-feed": ["dynamic"]
      },
      videoCardSelectors: [".video-card"],
      videoTitleSelectors: ["h3", "[title]"],
      searchInputSelectors: ["#search-wrap input"]
    }
  ],
  lifecycle: [{ target: "window", event: "bewlyMounted" }],
  distribution: {
    artifactName: "hourleaf-site-bilibili",
    execution: "bundled-reviewed"
  }
} as const satisfies SiteModuleDescriptor);

/** Stable, canonical payload used when producing the release SHA-256 file. */
export const BILIBILI_SITE_MODULE_HASH_INPUT = createSiteModuleHashInput(
  BILIBILI_SITE_MODULE_DESCRIPTOR
);

export { BILIBILI_SECTION_TARGETS } from "./metadata";
