import {
  getExtensionApi,
  idleQueryState,
  tabsGet,
  tabsQuery,
  type ExtensionApi,
  type ExtensionTab
} from "../shared/browser";
import type { SectionId, SiteId, TargetId, TrackingStatus } from "../shared/types";
import { AnalyticsService } from "../shared/analytics";
import type { SessionEvent } from "../shared/messages";

export const TRACKING_INTERVAL_MS = 15_000;
const MAX_RECORDABLE_GAP_MS = 30_000;
const IDLE_DETECTION_SECONDS = 60;

export interface IntervalHandle {
  stop(): void;
}

export type UsageEligibility = (
  url: string,
  at: number,
  targetId?: TargetId
) => boolean | Promise<boolean>;
export interface TrackingTarget {
  targetId: TargetId;
  siteId?: SiteId;
  legacySection?: SectionId;
}
export type TrackingTargetResolver = (
  url: string,
  requestedTargetId?: TargetId
) => TrackingTarget | null | Promise<TrackingTarget | null>;

export class UsageTracker {
  private readonly activeTabByWindow = new Map<number, ExtensionTab>();
  private readonly sessionByTab = new Map<number, string>();
  private readonly visibleByTab = new Map<number, boolean>();
  private readonly targetByTab = new Map<number, TargetId>();
  private currentTab: ExtensionTab | null = null;
  private focusedWindowId: number | null = null;
  private windowFocused = true;
  private idleState: TrackingStatus["idleState"] = "unsupported";
  private lastTickAt: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly analytics = new AnalyticsService(),
    private readonly now: () => number = Date.now,
    private readonly api: ExtensionApi | null = getExtensionApi(),
    private readonly isUsageAllowed: UsageEligibility = () => true,
    private readonly resolveTarget: TrackingTargetResolver = () => null
  ) {
    this.lastTickAt = this.now();
  }

  async start(): Promise<IntervalHandle> {
    if (!this.api?.tabs) return { stop: () => undefined };

    this.api.idle?.setDetectionInterval?.(IDLE_DETECTION_SECONDS);
    const [activeTabs, idleState] = await Promise.all([
      tabsQuery({ active: true, lastFocusedWindow: true }).catch(() => []),
      idleQueryState(IDLE_DETECTION_SECONDS).catch(() => "unsupported" as const)
    ]);
    this.currentTab = activeTabs[0] ?? null;
    this.focusedWindowId = this.currentTab?.windowId ?? null;
    if (this.currentTab?.windowId !== undefined) {
      this.activeTabByWindow.set(this.currentTab.windowId, this.currentTab);
    }
    this.idleState = idleState;
    this.lastTickAt = this.now();
    this.bindEvents();
    this.intervalId = setInterval(() => void this.flush(), TRACKING_INTERVAL_MS);

    return { stop: () => this.stop() };
  }

  async getStatus(): Promise<TrackingStatus> {
    const url = this.currentTab?.url ?? "";
    const target = await Promise.resolve(
      this.resolveTarget(
        url,
        this.currentTab?.id === undefined ? undefined : this.targetByTab.get(this.currentTab.id)
      )
    ).catch(() => null);
    const pageVisible =
      this.currentTab?.id !== undefined && this.visibleByTab.get(this.currentTab.id) === true;
    const candidate = target !== null && pageVisible && this.windowFocused && this.isUserActive();
    const isTracking = candidate
      ? await Promise.resolve(this.isUsageAllowed(url, this.now(), target?.targetId)).catch(
          () => false
        )
      : false;
    return {
      ...(target?.siteId ? { siteId: target.siteId } : {}),
      ...(target ? { targetId: target.targetId } : {}),
      section: target?.legacySection ?? null,
      isTracking,
      idleState: this.idleState,
      windowFocused: this.windowFocused
    };
  }

  /** Public for lifecycle hosts and deterministic tests. */
  flush(at = this.now()): Promise<void> {
    const end = Math.max(at, this.lastTickAt);
    const rawStart = this.lastTickAt;
    this.lastTickAt = end;

    const url = this.currentTab?.url ?? "";
    const pageVisible =
      this.currentTab?.id !== undefined && this.visibleByTab.get(this.currentTab.id) === true;
    const eligible = pageVisible && this.windowFocused && this.isUserActive();
    if (!eligible || end <= rawStart) return Promise.resolve();

    // Browser background contexts can be suspended. Never count a long sleep as active usage.
    const start = Math.max(rawStart, end - MAX_RECORDABLE_GAP_MS);
    const requestedTargetId =
      this.currentTab?.id === undefined ? undefined : this.targetByTab.get(this.currentTab.id);
    return Promise.all([
      Promise.resolve(this.resolveTarget(url, requestedTargetId)),
      Promise.resolve(this.isUsageAllowed(url, end, requestedTargetId))
    ])
      .then(([target, allowed]) =>
        target && allowed ? this.analytics.recordInterval(target.targetId, start, end) : undefined
      )
      .catch(() => undefined);
  }

  handleSessionUpdate(
    tab: ExtensionTab | undefined,
    event: SessionEvent,
    sessionId: string,
    url: string,
    visibility: "visible" | "hidden",
    targetId?: TargetId
  ): boolean {
    const tabId = tab?.id;
    if (tabId === undefined) return false;
    const existingSession = this.sessionByTab.get(tabId);

    if (event !== "start" && existingSession !== undefined && existingSession !== sessionId) {
      return false;
    }
    if (event !== "start" && existingSession === undefined) {
      // A non-persistent background may restart between heartbeats; safely resume
      // without retroactively counting the missing interval.
      this.sessionByTab.set(tabId, sessionId);
    }

    void this.flush();
    if (event === "stop") {
      this.visibleByTab.set(tabId, false);
      this.sessionByTab.delete(tabId);
      this.targetByTab.delete(tabId);
      return true;
    }

    this.sessionByTab.set(tabId, sessionId);
    this.visibleByTab.set(tabId, visibility === "visible");
    if (targetId) this.targetByTab.set(tabId, targetId);
    const updatedTab = { ...tab, id: tabId, url };
    if (tab?.windowId !== undefined) this.activeTabByWindow.set(tab.windowId, updatedTab);
    if (this.currentTab?.id === tabId || tab?.active) this.currentTab = updatedTab;
    return true;
  }

  private bindEvents(): void {
    this.api?.tabs?.onActivated?.addListener((activeInfo) => {
      void this.flush();
      void tabsGet(activeInfo.tabId)
        .then((tab) => {
          if (!tab) return;
          this.activeTabByWindow.set(activeInfo.windowId, tab);
          if (this.focusedWindowId === null || this.focusedWindowId === activeInfo.windowId) {
            this.currentTab = tab;
          }
        })
        .catch(() => undefined);
    });

    this.api?.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
      if (!changeInfo.url && changeInfo.status !== "complete") return;
      const windowId = tab.windowId;
      const activeInWindow =
        windowId === undefined ? undefined : this.activeTabByWindow.get(windowId);
      if (activeInWindow?.id !== tabId && this.currentTab?.id !== tabId) return;
      void this.flush();
      if (windowId !== undefined) this.activeTabByWindow.set(windowId, tab);
      if (this.currentTab?.id === tabId) this.currentTab = tab;
    });

    this.api?.tabs?.onRemoved?.addListener((tabId) => {
      this.sessionByTab.delete(tabId);
      this.visibleByTab.delete(tabId);
      this.targetByTab.delete(tabId);
      if (this.currentTab?.id !== tabId) return;
      void this.flush();
      this.currentTab = null;
    });

    this.api?.windows?.onFocusChanged?.addListener((windowId) => {
      void this.flush();
      const none = this.api?.windows?.WINDOW_ID_NONE ?? -1;
      if (windowId === none) {
        this.windowFocused = false;
        this.focusedWindowId = null;
        return;
      }
      this.windowFocused = true;
      this.focusedWindowId = windowId;
      const cached = this.activeTabByWindow.get(windowId);
      if (cached) this.currentTab = cached;
      void tabsQuery({ active: true, windowId })
        .then((tabs) => {
          const active = tabs[0];
          if (!active || this.focusedWindowId !== windowId) return;
          this.activeTabByWindow.set(windowId, active);
          this.currentTab = active;
        })
        .catch(() => undefined);
    });

    this.api?.idle?.onStateChanged?.addListener((state) => {
      void this.flush();
      this.idleState = state;
    });
  }

  private isUserActive(): boolean {
    return this.idleState === "active" || this.idleState === "unsupported";
  }

  private stop(): void {
    void this.flush();
    if (this.intervalId !== null) clearInterval(this.intervalId);
    this.intervalId = null;
  }
}
