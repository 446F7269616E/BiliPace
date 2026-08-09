import type { ContentFilterId } from "../shared/types";

export type SiteExperience = "bilibili" | "bewlybewly-ave-mujica";
export type ContentRoot = Document | ShadowRoot;

export interface ContentSiteAdapter {
  id: SiteExperience;
  roots(document: Document): ContentRoot[];
  hiddenElementSelectors: Readonly<Partial<Record<ContentFilterId, readonly string[]>>>;
  videoCardSelectors: readonly string[];
  videoTitleSelectors: readonly string[];
  searchInputSelectors: readonly string[];
}

const BILIBILI_ADAPTER: ContentSiteAdapter = {
  id: "bilibili",
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
  id: "bewlybewly-ave-mujica",
  roots: (document) => {
    const host = document.querySelector<HTMLElement>("#bewly[data-version]");
    return host?.shadowRoot ? [host.shadowRoot] : [];
  },
  hiddenElementSelectors: {
    "home-feed": ["#bewly-wrapper main"],
    "dynamic-feed": ["#bewly-wrapper main"],
    "search-suggestions": ["#search-suggestion"],
    "top-navigation": ["header:has(.right-side):has(.logo)"]
  },
  videoCardSelectors: [".video-card"],
  videoTitleSelectors: ["h3", "[title]", "[class*='title']"],
  searchInputSelectors: ["#search-wrap input"]
};

const ADAPTERS = [BILIBILI_ADAPTER, BEWLYBEWLY_ADAPTER] as const;

export function detectSiteAdapters(document: Document): ContentSiteAdapter[] {
  return ADAPTERS.filter((adapter) => adapter.roots(document).length > 0);
}

export function detectSiteExperience(document: Document): SiteExperience {
  return BEWLYBEWLY_ADAPTER.roots(document).length > 0
    ? BEWLYBEWLY_ADAPTER.id
    : BILIBILI_ADAPTER.id;
}

/**
 * BewlyBewly can show a native page in its open-shadow-root drawer while the
 * top-level URL remains the homepage. Prefer the visible drawer URL for section
 * attribution, without injecting into frames or creating a second timer.
 */
export function getEffectiveBilibiliUrl(document: Document, topLevelUrl: string): string {
  for (const root of BEWLYBEWLY_ADAPTER.roots(document)) {
    for (const frame of root.querySelectorAll<HTMLIFrameElement>("iframe[src]")) {
      const bounds = frame.getBoundingClientRect();
      if (bounds.width <= 1 || bounds.height <= 1) continue;
      const source = frame.getAttribute("src");
      if (!source) continue;
      try {
        const resolved = new URL(source, topLevelUrl);
        if (resolved.protocol === "https:" && /(^|\.)bilibili\.com$/i.test(resolved.hostname)) {
          return resolved.href;
        }
      } catch {
        // Ignore a transient or incomplete iframe URL and keep the top-level route.
      }
    }
  }
  return topLevelUrl;
}
