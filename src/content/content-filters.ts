import { classifyBilibiliUrl } from "../shared/url";
import type { ContentFilterId, ContentFilterSettings } from "../shared/types";
import { detectSiteAdapters, type ContentRoot, type ContentSiteAdapter } from "./site-adapters";

const STYLE_ATTRIBUTE = "data-bilipace-content-filter-style";
const CARD_HIDDEN_ATTRIBUTE = "data-bilipace-card-hidden";
const MAX_TITLE_LENGTH = 240;

const ROUTE_SCOPED_FILTERS: Readonly<
  Partial<Record<ContentFilterId, ReturnType<typeof classifyBilibiliUrl>>>
> = {
  "home-feed": "home",
  "dynamic-feed": "dynamic",
  "related-videos": "video"
};

export class ContentFilterController {
  private settings: ContentFilterSettings | null = null;
  private url = "";
  private contentObservers: MutationObserver[] = [];
  private environmentObserver: MutationObserver | null = null;
  private scanFrame: number | null = null;
  private pendingScans: Array<{ adapter: ContentSiteAdapter; root: ParentNode }> = [];
  private rootCount = 0;
  private keywords: string[] = [];
  private patterns: RegExp[] = [];

  constructor(private readonly document: Document = window.document) {
    this.document.addEventListener("keydown", this.handleSearchShortcut, true);
    this.document.addEventListener("bewlyMounted", this.handleEnvironmentChange);
    this.observeEnvironment();
  }

  apply(settings: ContentFilterSettings, url: string): void {
    this.settings = settings;
    this.url = url;
    this.keywords = settings.videoCards.keywords.map((item) => item.toLocaleLowerCase());
    this.patterns = settings.videoCards.regexPatterns.map(compileSafePattern).filter(isDefined);
    this.renderStyles();
    this.refreshCardFiltering();
    this.observeContentRoots();
  }

  stop(): void {
    this.settings = null;
    this.disconnectContentObservers();
    this.environmentObserver?.disconnect();
    this.environmentObserver = null;
    if (this.scanFrame !== null) cancelAnimationFrame(this.scanFrame);
    this.scanFrame = null;
    this.removeStyles();
    this.clearFilteredCards();
    this.document.removeEventListener("keydown", this.handleSearchShortcut, true);
    this.document.removeEventListener("bewlyMounted", this.handleEnvironmentChange);
  }

  private renderStyles(): void {
    this.removeStyles();
    const settings = this.settings;
    if (!settings?.enabled) return;

    const section = classifyBilibiliUrl(this.url);
    for (const adapter of detectSiteAdapters(this.document)) {
      const selectors = Object.entries(settings.hiddenElements).flatMap(([rawId, hidden]) => {
        const id = rawId as ContentFilterId;
        if (!hidden) return [];
        const scopedSection = ROUTE_SCOPED_FILTERS[id];
        if (scopedSection && section !== scopedSection) return [];
        return adapter.hiddenElementSelectors[id] ?? [];
      });
      const css = [...new Set([...selectors, `[${CARD_HIDDEN_ATTRIBUTE}]`])]
        .map((selector) => `${selector} { display: none !important; }`)
        .join("\n");
      for (const root of adapter.roots(this.document)) appendStyle(root, css, this.document);
    }
  }

  private observeContentRoots(): void {
    this.disconnectContentObservers();
    const adapters = detectSiteAdapters(this.document);
    const roots = adapters.flatMap((adapter) => adapter.roots(this.document));
    this.rootCount = new Set(roots).size;
    for (const adapter of adapters) {
      for (const root of adapter.roots(this.document)) {
        const observer = new MutationObserver((mutations) => {
          const addedRoots = mutations.flatMap((mutation) =>
            [...mutation.addedNodes].filter((node): node is Element => node instanceof Element)
          );
          if (addedRoots.length > 0) this.scheduleCardScan(adapter, addedRoots);
        });
        observer.observe(root instanceof Document ? root.documentElement : root, {
          childList: true,
          subtree: true
        });
        this.contentObservers.push(observer);
      }
    }
  }

  private disconnectContentObservers(): void {
    for (const observer of this.contentObservers) observer.disconnect();
    this.contentObservers = [];
  }

  private observeEnvironment(): void {
    this.environmentObserver?.disconnect();
    this.environmentObserver = new MutationObserver(() => {
      const nextCount = collectAdapterRoots(this.document).length;
      if (nextCount !== this.rootCount) this.handleEnvironmentChange();
    });
    this.environmentObserver.observe(this.document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  private readonly handleEnvironmentChange = (): void => {
    if (!this.settings) return;
    this.renderStyles();
    this.refreshCardFiltering();
    this.observeContentRoots();
  };

  private scheduleCardScan(adapter: ContentSiteAdapter, roots: ParentNode[]): void {
    for (const root of roots) this.pendingScans.push({ adapter, root });
    if (this.scanFrame !== null) return;
    this.scanFrame = requestAnimationFrame(() => {
      this.scanFrame = null;
      const scans = this.pendingScans.splice(0);
      if (!this.settings?.enabled || !this.settings.videoCards.enabled) return;
      for (const scan of scans) this.filterCards(scan.root, scan.adapter);
    });
  }

  private refreshCardFiltering(): void {
    this.clearFilteredCards();
    const cardSettings = this.settings?.videoCards;
    if (!this.settings?.enabled || !cardSettings?.enabled) return;

    if (this.keywords.length === 0 && this.patterns.length === 0) return;

    for (const adapter of detectSiteAdapters(this.document)) {
      for (const root of adapter.roots(this.document)) {
        this.filterCards(root, adapter);
      }
    }
  }

  private filterCards(root: ParentNode, adapter: ContentSiteAdapter): void {
    for (const card of findCards(root, adapter)) {
      const title = readCardTitle(card, adapter).slice(0, MAX_TITLE_LENGTH);
      if (!title) continue;
      const normalized = title.toLocaleLowerCase();
      if (
        this.keywords.some((keyword) => normalized.includes(keyword)) ||
        this.patterns.some((pattern) => pattern.test(title))
      ) {
        card.setAttribute(CARD_HIDDEN_ATTRIBUTE, "");
      }
    }
  }

  private clearFilteredCards(): void {
    for (const root of collectAdapterRoots(this.document)) {
      for (const card of root.querySelectorAll(`[${CARD_HIDDEN_ATTRIBUTE}]`)) {
        card.removeAttribute(CARD_HIDDEN_ATTRIBUTE);
      }
    }
  }

  private removeStyles(): void {
    for (const root of collectAdapterRoots(this.document)) {
      for (const style of root.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`)) style.remove();
    }
  }

  private readonly handleSearchShortcut = (event: KeyboardEvent): void => {
    if (
      event.key !== "/" ||
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.isComposing ||
      !this.settings?.enabled ||
      !this.settings.slashToSearch ||
      isEditableTarget(event)
    ) {
      return;
    }

    for (const adapter of detectSiteAdapters(this.document)) {
      for (const root of adapter.roots(this.document)) {
        for (const selector of adapter.searchInputSelectors) {
          const input = root.querySelector<HTMLInputElement>(selector);
          if (!input || input.disabled || input.getBoundingClientRect().width <= 1) continue;
          event.preventDefault();
          input.focus();
          input.select();
          return;
        }
      }
    }
  };
}

function collectAdapterRoots(document: Document): ContentRoot[] {
  return [...new Set(detectSiteAdapters(document).flatMap((adapter) => adapter.roots(document)))];
}

function appendStyle(root: ContentRoot, css: string, document: Document): void {
  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, "");
  style.textContent = css;
  if (root instanceof Document) (root.head ?? root.documentElement).append(style);
  else root.prepend(style);
}

function findCards(root: ParentNode, adapter: ContentSiteAdapter): Element[] {
  const cards = new Set<Element>();
  for (const selector of adapter.videoCardSelectors) {
    if (root instanceof Element && root.matches(selector)) cards.add(root);
    for (const card of root.querySelectorAll(selector)) cards.add(card);
  }
  if (adapter.id === "bewlybewly-ave-mujica") {
    for (const link of root.querySelectorAll("a[href*='/video/BV']")) {
      const card = link.closest("article, li, [class*='video-card'], [class*='feed-card']");
      if (card) cards.add(card);
    }
  }
  return [...cards];
}

function readCardTitle(card: Element, adapter: ContentSiteAdapter): string {
  for (const selector of adapter.videoTitleSelectors) {
    const titleElement = card.matches(selector) ? card : card.querySelector(selector);
    if (!titleElement) continue;
    const title = titleElement.getAttribute("title") ?? titleElement.textContent ?? "";
    if (title.trim()) return title.trim();
  }
  return "";
}

function compileSafePattern(source: string): RegExp | undefined {
  if (!source || source.length > 80) return undefined;
  if (/\\[1-9]|\(\?<([=!])|\([^)]*[+*][^)]*\)[+*{]/.test(source)) return undefined;
  try {
    return new RegExp(source, "iu");
  } catch {
    return undefined;
  }
}

function isEditableTarget(event: KeyboardEvent): boolean {
  const path = event.composedPath();
  return path.some(
    (target) =>
      target instanceof Element &&
      Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
