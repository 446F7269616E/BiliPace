import type { ContentFilterId } from "../shared/types";

export type ContentRoot = Document | ShadowRoot;

export interface ContentSiteAdapter {
  roots(document: Document): ContentRoot[];
  hiddenElementSelectors: Readonly<Partial<Record<ContentFilterId, readonly string[]>>>;
  videoCardSelectors: readonly string[];
  videoTitleSelectors: readonly string[];
  searchInputSelectors: readonly string[];
}

const BILIBILI_ADAPTER: ContentSiteAdapter = {
  roots: (document) => [document],
  hiddenElementSelectors: {
    "home-feed": [
      ".recommended-container",
      ".recommended-container_floor-aside",
      ".feed2 .container"
    ],
    "dynamic-feed": [".bili-dyn-list", ".bili-dyn-list__items", ".opus-list"],
    "related-videos": ["#reco_list", ".recommend-list-v1", ".rec-list", ".video-page-card-small"],
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
};

const BEWLYBEWLY_ADAPTER: ContentSiteAdapter = {
  // Ave Mujica mounts an open shadow root on a direct `#bewly` host. Do not
  // depend on its version attribute: development builds and mount transitions
  // can omit it or briefly leave more than one host in the document.
  roots: (document) =>
    [...document.querySelectorAll<HTMLElement>("#bewly")]
      .map((host) => host.shadowRoot)
      .filter((root): root is ShadowRoot => root !== null),
  hiddenElementSelectors: {
    // Cards are a stable component boundary in Ave. Hiding them keeps the
    // surrounding navigation available and safely degrades if Ave changes its
    // page layout.
    "home-feed": [".video-card"],
    "dynamic-feed": [".video-card"],
    "search-suggestions": ["#search-suggestion"],
    "top-navigation": ["header:has(.right-side):has(.logo)"]
  },
  videoCardSelectors: [".video-card"],
  videoTitleSelectors: ["h3", "[title]"],
  searchInputSelectors: ["#search-wrap input"]
};

const ADAPTERS = [BILIBILI_ADAPTER, BEWLYBEWLY_ADAPTER] as const;

export function detectSiteAdapters(document: Document): ContentSiteAdapter[] {
  return ADAPTERS.filter((adapter) => adapter.roots(document).length > 0);
}
