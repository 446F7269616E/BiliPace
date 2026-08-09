import type { ContentFilterId, ContentFilterSettings } from "../shared/types";
import type { ModuleMatch, SiteModuleRuntime } from "../modules/contracts";
import { resolveSiteModule } from "../modules/registry";
import {
  collectAdapterRoots,
  detectSiteAdapters,
  type ContentRoot,
  type ContentSiteAdapter
} from "./site-adapters";

const STYLE_ATTRIBUTE = "data-hourleaf-content-filter-style";
const CARD_HIDDEN_ATTRIBUTE = "data-hourleaf-card-hidden";
const MAX_TITLE_LENGTH = 240;

export class ContentFilterController {
  private settings: ContentFilterSettings | null = null;
  private contentObservers: MutationObserver[] = [];
  private scanFrame: number | null = null;
  private pendingScans = new Map<ContentSiteAdapter, Set<ParentNode>>();
  private knownRoots: ContentRoot[] = [];
  private applicationSignature = "";
  private keywords: string[] = [];
  private patterns: RegExp[] = [];
  private module: SiteModuleRuntime | null = null;
  private match: ModuleMatch | null = null;
  private lifecycleCleanups: Array<() => void> = [];

  constructor(private readonly document: Document = window.document) {
    this.document.addEventListener("keydown", this.handleSearchShortcut, true);
  }

  apply(settings: ContentFilterSettings, url: string): void {
    const nextModule = resolveSiteModule(url);
    const nextMatch = nextModule?.match(url) ?? null;
    const nextSignature = createApplicationSignature(settings, nextMatch);
    const nextRoots = collectAdapterRoots(nextModule, this.document);
    const rootsChanged = !haveSameRoots(this.knownRoots, nextRoots);
    const moduleChanged = this.module !== nextModule;

    this.settings = settings;
    this.module = nextModule;
    this.match = nextMatch;
    if (moduleChanged) this.bindLifecycleEvents();
    if (nextSignature === this.applicationSignature && !rootsChanged && !moduleChanged) return;

    this.applicationSignature = nextSignature;
    this.knownRoots = nextRoots;
    this.keywords = settings.videoCards.keywords.map((item) => item.toLocaleLowerCase());
    this.patterns = settings.videoCards.regexPatterns.map(compileSafePattern).filter(isDefined);
    this.refreshEnhancements();
  }

  stop(): void {
    this.settings = null;
    this.module = null;
    this.match = null;
    this.applicationSignature = "";
    this.knownRoots = [];
    this.disconnectContentObservers();
    this.cancelPendingScans();
    this.removeStyles();
    this.clearFilteredCards();
    this.document.removeEventListener("keydown", this.handleSearchShortcut, true);
    this.clearLifecycleEvents();
  }

  private renderStyles(): void {
    this.removeStyles();
    const settings = this.settings;
    if (!settings?.enabled) return;

    const section = this.match?.sectionId;
    for (const adapter of detectSiteAdapters(this.module, this.document)) {
      const selectors = Object.entries(settings.hiddenElements).flatMap(([rawId, hidden]) => {
        const id = rawId as ContentFilterId;
        if (!hidden) return [];
        const scopedSections = adapter.routeScopedFilters[id] ?? [];
        if (scopedSections.length > 0 && (!section || !scopedSections.includes(section))) return [];
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
    if (!this.shouldFilterVideoCards()) return;

    const adapters = detectSiteAdapters(this.module, this.document);
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

  private readonly handleEnvironmentChange = (): void => {
    if (!this.settings) return;
    const nextRoots = collectAdapterRoots(this.module, this.document);
    if (haveSameRoots(this.knownRoots, nextRoots)) return;
    this.knownRoots = nextRoots;
    this.refreshEnhancements();
  };

  private bindLifecycleEvents(): void {
    this.clearLifecycleEvents();
    const module = this.module;
    if (!module) return;
    for (const lifecycle of module.descriptor.lifecycle) {
      const target: EventTarget =
        lifecycle.target === "window"
          ? (this.document.defaultView ?? this.document)
          : this.document;
      target.addEventListener(lifecycle.event, this.handleEnvironmentChange);
      this.lifecycleCleanups.push(() =>
        target.removeEventListener(lifecycle.event, this.handleEnvironmentChange)
      );
    }
  }

  private clearLifecycleEvents(): void {
    for (const cleanup of this.lifecycleCleanups) cleanup();
    this.lifecycleCleanups = [];
  }

  private scheduleCardScan(adapter: ContentSiteAdapter, roots: ParentNode[]): void {
    const pendingRoots = this.pendingScans.get(adapter) ?? new Set<ParentNode>();
    for (const root of roots) pendingRoots.add(root);
    this.pendingScans.set(adapter, pendingRoots);
    if (this.scanFrame !== null) return;
    this.scanFrame = requestAnimationFrame(() => {
      this.scanFrame = null;
      const scans = this.pendingScans;
      this.pendingScans = new Map();
      if (!this.shouldFilterVideoCards()) return;
      for (const [pendingAdapter, pendingAdapterRoots] of scans) {
        for (const root of pendingAdapterRoots) this.filterCards(root, pendingAdapter);
      }
    });
  }

  private cancelPendingScans(): void {
    if (this.scanFrame !== null) cancelAnimationFrame(this.scanFrame);
    this.scanFrame = null;
    this.pendingScans.clear();
  }

  private refreshEnhancements(): void {
    this.cancelPendingScans();
    this.renderStyles();
    this.refreshCardFiltering();
    this.observeContentRoots();
  }

  private shouldFilterVideoCards(): boolean {
    return Boolean(
      this.settings?.enabled &&
      this.settings.videoCards.enabled &&
      (this.keywords.length > 0 || this.patterns.length > 0)
    );
  }

  private refreshCardFiltering(): void {
    this.clearFilteredCards();
    if (!this.shouldFilterVideoCards()) return;

    for (const adapter of detectSiteAdapters(this.module, this.document)) {
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
    for (const root of collectAdapterRoots(this.module, this.document)) {
      for (const card of root.querySelectorAll(`[${CARD_HIDDEN_ATTRIBUTE}]`)) {
        card.removeAttribute(CARD_HIDDEN_ATTRIBUTE);
      }
    }
  }

  private removeStyles(): void {
    for (const root of collectAdapterRoots(this.module, this.document)) {
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

    for (const adapter of detectSiteAdapters(this.module, this.document)) {
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
  return [...cards];
}

function createApplicationSignature(
  settings: ContentFilterSettings,
  match: ModuleMatch | null
): string {
  return `${match?.moduleId ?? ""}:${match?.targetId ?? ""}\n${JSON.stringify(settings)}`;
}

function haveSameRoots(current: ContentRoot[], next: ContentRoot[]): boolean {
  return current.length === next.length && current.every((root) => next.includes(root));
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
