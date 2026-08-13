import { runtimeGetURL, storageAddChangeListener } from "../shared/browser";
import { formatLocalDate } from "../shared/analytics";
import { sendRequest, type SessionEvent } from "../shared/messages";
import { configureLocale, t } from "../shared/i18n";
import type { PageDecision, PlanNavigationDecision } from "../shared/types";
import { STORAGE_KEYS } from "../shared/storage-keys";
import { resolveSiteModule, subscribeSiteModuleRegistry } from "../modules/registry";
import { ContentFilterController } from "./content-filters";

const ROOT_ID = "hourleaf-block-root";
const HEARTBEAT_INTERVAL_MS = 15_000;
const ROUTE_POLL_INTERVAL_MS = 1_000;
const SESSION_ID = createSessionId();
const contentFilters = new ContentFilterController();
const LOCAL_STYLE_ID = "hourleaf-local-module-style";

subscribeSiteModuleRegistry(() => void evaluatePage());

let lastSeenUrl = window.location.href;
let evaluationGeneration = 0;
let mediaObserver: MutationObserver | null = null;
let bodyWasInert = false;
let managedBody: HTMLElement | null = null;
let contentStarted = false;
let planCheckGeneration = 0;
let initializationRetry: ReturnType<typeof setTimeout> | null = null;
let flowEndedCleanup: (() => void) | null = null;

configureLocale("system");

void initializeContent();

window.addEventListener("popstate", routeMayHaveChanged);
window.addEventListener("hashchange", routeMayHaveChanged);
document.addEventListener("visibilitychange", () => {
  if (contentStarted) void sendSessionUpdate("heartbeat");
});
storageAddChangeListener((changes, areaName) => {
  if (areaName !== "local") return;
  const settingsChanged = changes[STORAGE_KEYS.settings];
  const changed = settingsChanged ?? changes[STORAGE_KEYS.localModules];
  if (!changed || changed.newValue === undefined) return;
  void (settingsChanged ? syncContentLocale().then(evaluatePage) : evaluatePage());
});
window.addEventListener("pagehide", () => {
  if (contentStarted) void sendSessionUpdate("stop");
});

setInterval(() => {
  void refreshContentState();
}, HEARTBEAT_INTERVAL_MS);

// Isolated content-script worlds cannot reliably monkey-patch the page's History
// object in every browser. A cheap URL-only poll covers pushState/replaceState and
// Site-specific SPA navigation is covered without injecting code into the page world.
setInterval(routeMayHaveChanged, ROUTE_POLL_INTERVAL_MS);

function routeMayHaveChanged(): void {
  if (window.location.href === lastSeenUrl) return;
  lastSeenUrl = window.location.href;
  void handleRouteChange();
}

async function initializeContent(): Promise<void> {
  await syncContentLocale();
  const outcome = await enforcePlanNavigation();
  if (outcome === "unavailable") {
    scheduleInitializationRetry();
    return;
  }
  if (outcome === "redirected" || contentStarted) return;
  contentStarted = true;
  await sendSessionUpdate("start");
  await evaluatePage();
}

async function handleRouteChange(): Promise<void> {
  if (contentStarted) await sendSessionUpdate("stop");
  contentStarted = false;
  const outcome = await enforcePlanNavigation();
  if (outcome === "unavailable") {
    scheduleInitializationRetry();
    return;
  }
  if (outcome === "redirected") return;
  contentStarted = true;
  await sendSessionUpdate("route");
  await evaluatePage();
}

async function refreshContentState(): Promise<void> {
  const outcome = await enforcePlanNavigation();
  if (outcome === "unavailable") return;
  if (outcome === "redirected") return;
  if (!contentStarted) {
    contentStarted = true;
    await sendSessionUpdate("start");
  } else {
    await sendSessionUpdate("heartbeat");
  }
  await evaluatePage();
}

async function enforcePlanNavigation(): Promise<"allowed" | "redirected" | "unavailable"> {
  const module = resolveSiteModule(window.location.href);
  const generation = ++planCheckGeneration;
  try {
    const decision = await sendRequest(
      module?.plan
        ? module.plan.createNavigationRequest(window.location.href)
        : { type: "GET_PLAN_NAVIGATION_DECISION", url: window.location.href }
    );
    if (generation !== planCheckGeneration) return "unavailable";
    if (decision.allowed) {
      if (decision.reason === "expired" && decision.completionMode === "lenient") {
        void showReminder(
          t("end.title"),
          t("end.lenientReminder"),
          `plan:${decision.itemId ?? ""}`
        );
      }
      if (decision.flowContinuationKind === "video-end" && decision.itemId) {
        monitorVideoEnd(`plan:${decision.itemId}`, undefined, async () => {
          await sendRequest({
            type: "STOP_PLAN_FLOW",
            itemId: decision.itemId as string,
            reason: "video-ended",
            url: window.location.href
          });
          goToEnd({ source: "plan", itemId: decision.itemId, reason: "expired" });
        });
      }
      return "allowed";
    }
    if (contentStarted) await sendSessionUpdate("stop");
    contentStarted = false;
    if (
      decision.reason === "expired" &&
      decision.completionMode === "flow" &&
      decision.flowDecisionRequired &&
      decision.itemId
    ) {
      await whenDocumentReady();
      const flowKey = `plan:${decision.itemId}`;
      if (document.getElementById(ROOT_ID)?.dataset.flowKey === flowKey) return "redirected";
      removeBlockPage();
      renderPlanFlowChoice(decision);
      return "redirected";
    }
    removeBlockPage();
    if (decision.reason === "expired") {
      goToEnd({ source: "plan", itemId: decision.itemId, reason: "expired" });
      return "redirected";
    }
    // No source URL is included: the extension page receives no arbitrary URL,
    // query, search term, user id, or other browsing detail.
    window.location.replace(runtimeGetURL("plan.html"));
    return "redirected";
  } catch {
    // A newly waking event page can miss the first document_start request.
    // Do not begin tracking or focus evaluation until an authoritative answer
    // arrives; the retry below does not backfill the unavailable interval.
    return "unavailable";
  }
}

function scheduleInitializationRetry(): void {
  if (initializationRetry !== null) return;
  initializationRetry = setTimeout(() => {
    initializationRetry = null;
    void initializeContent();
  }, 750);
}

async function sendSessionUpdate(event: SessionEvent): Promise<void> {
  try {
    const match = resolveSiteModule(window.location.href)?.match(window.location.href);
    await sendRequest({
      type: "SESSION_UPDATE",
      event,
      sessionId: SESSION_ID,
      url: window.location.href,
      ...(match ? { targetId: match.targetId } : {}),
      visibility: document.visibilityState === "visible" ? "visible" : "hidden"
    });
  } catch {
    // Non-persistent backgrounds can be unavailable briefly. The next heartbeat
    // re-establishes the session without backfilling unverified elapsed time.
  }
}

async function evaluatePage(): Promise<void> {
  const topLevelUrl = window.location.href;
  const url = topLevelUrl;
  const module = resolveSiteModule(url);
  const match = module?.match(url);
  const generation = ++evaluationGeneration;
  try {
    const [decision, settings, localRules] = await Promise.all([
      sendRequest({
        type: "GET_PAGE_DECISION",
        url,
        ...(match ? { targetId: match.targetId } : {})
      }),
      sendRequest({ type: "GET_SETTINGS" }),
      sendRequest({ type: "GET_LOCAL_PAGE_RULES", url }).catch(() => ({
        css: "",
        hideSelectors: [],
        moduleIds: []
      }))
    ]);
    if (generation !== evaluationGeneration || topLevelUrl !== window.location.href) return;
    configureLocale(settings.locale);
    contentFilters.apply(module?.contentSettings(settings) ?? settings.contentFilters, url);
    applyLocalPageRules(localRules.css, localRules.hideSelectors);
    if (!decision.blocked) {
      removeBlockPage();
      if (decision.needsReminder && decision.activePeriodId) {
        void showReminder(
          t("end.title"),
          t("end.limitMessage", { site: "Hourleaf" }),
          `focus:${decision.activePeriodId}`
        );
      }
      if (
        decision.flowContinuationKind === "video-end" &&
        decision.targetId &&
        decision.activePeriodId
      ) {
        monitorVideoEnd(
          `focus:${decision.targetId}:${decision.activePeriodId}`,
          undefined,
          async () => {
            await sendRequest({
              type: "STOP_PERIOD_FLOW",
              url: window.location.href,
              targetId: decision.targetId as string,
              periodId: decision.activePeriodId as string
            });
            goToEnd({
              source: "focus",
              siteId: decision.siteId,
              targetId: decision.targetId,
              periodId: decision.activePeriodId,
              reason: "period-limit"
            });
          }
        );
      }
      return;
    }
    await whenDocumentReady();
    if (topLevelUrl !== window.location.href) return;
    if (decision.needsVisitConfirmation && decision.siteId) {
      goToEnd({
        source: "confirmation",
        siteId: decision.siteId,
        targetId: decision.targetId,
        reason: "visit-confirmation",
        returnUrl: url,
        waitSeconds: decision.visitConfirmationWaitSeconds
      });
      return;
    }
    if (decision.needsFlowChoice && decision.targetId && decision.activePeriodId) {
      const flowKey = `focus:${decision.targetId}:${decision.activePeriodId}`;
      if (document.getElementById(ROOT_ID)?.dataset.flowKey === flowKey) {
        return;
      }
      renderFocusFlowChoice(decision, url);
      return;
    }
    goToEnd({
      source: "focus",
      siteId: decision.siteId,
      targetId: decision.targetId,
      periodId: decision.activePeriodId,
      reason: decision.reason,
      groupIndex: decision.groupIndex,
      groupCount: decision.groupCount
    });
  } catch (error) {
    // A missing or restarting background context must never break the current site.
    console.debug("Hourleaf page check unavailable", error);
  }
}

function renderPlanFlowChoice(decision: PlanNavigationDecision): void {
  if (!decision.itemId) return;
  renderFlowChoice(`plan:${decision.itemId}`, async (continuation, selectedVideo) => {
    const result = await sendRequest({
      type: "CONTINUE_PLAN_FLOW",
      itemId: decision.itemId as string,
      continuation,
      url: window.location.href
    });
    if (result.continuationKind === "video-end") {
      monitorVideoEnd(`plan:${decision.itemId}`, selectedVideo, async () => {
        await sendRequest({
          type: "STOP_PLAN_FLOW",
          itemId: decision.itemId as string,
          reason: "video-ended",
          url: window.location.href
        });
        goToEnd({ source: "plan", itemId: decision.itemId, reason: "expired" });
      });
    }
    removeBlockPage();
    void initializeContent();
  });
}

function renderFocusFlowChoice(decision: PageDecision, url: string): void {
  if (!decision.targetId || !decision.activePeriodId) return;
  renderFlowChoice(
    `focus:${decision.targetId}:${decision.activePeriodId}`,
    async (continuation, selectedVideo) => {
      const next = await sendRequest({
        type: "GRANT_PERIOD_FLOW",
        url,
        targetId: decision.targetId as string,
        periodId: decision.activePeriodId as string,
        continuation
      });
      if (next.flowContinuationKind === "video-end") {
        monitorVideoEnd(
          `focus:${decision.targetId}:${decision.activePeriodId}`,
          selectedVideo,
          async () => {
            await sendRequest({
              type: "STOP_PERIOD_FLOW",
              url: window.location.href,
              targetId: decision.targetId as string,
              periodId: decision.activePeriodId as string
            });
            goToEnd({
              source: "focus",
              siteId: decision.siteId,
              targetId: decision.targetId,
              periodId: decision.activePeriodId,
              reason: "period-limit"
            });
          }
        );
      }
      removeBlockPage();
    }
  );
}

function renderFlowChoice(
  flowKey: string,
  onContinue: (
    continuation: { kind: "minutes"; minutes: number } | { kind: "video-end" },
    selectedVideo?: HTMLVideoElement
  ) => Promise<void>
): void {
  removeBlockPage();
  const activeMedia = [...document.querySelectorAll<HTMLMediaElement>("video, audio")].filter(
    (media) => !media.paused && !media.ended
  );
  const selectedVideo = selectPrimaryVideo(
    activeMedia.filter((media): media is HTMLVideoElement => media instanceof HTMLVideoElement)
  );
  pauseMedia(document);
  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.dataset.flowKey = flowKey;
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647"
  });
  const shadow = host.attachShadow({ mode: "open" });
  const backdrop = element("main", "backdrop");
  const card = element("section", "card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  const title = element("h1", "", t("end.flowTitle"));
  const message = element("p", "message", t("end.flowDescription"));
  const minutes = document.createElement("select");
  minutes.setAttribute("aria-label", t("common.minutes"));
  for (let value = 1; value <= 15; value += 1) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = t("end.extendMinutes", { minutes: value });
    if (value === 5) option.selected = true;
    minutes.append(option);
  }
  const continueButton = element("button", "primary", t("end.unlock"));
  continueButton.type = "button";
  const actions = element("div", "actions");
  actions.append(minutes, continueButton);
  const status = element("div", "status");
  status.setAttribute("role", "status");
  if (selectedVideo) {
    const videoButton = element("button", "", t("end.untilVideoEnd"));
    videoButton.type = "button";
    videoButton.addEventListener("click", () => {
      void run({ kind: "video-end" }, videoButton);
    });
    actions.append(videoButton);
  }
  continueButton.addEventListener("click", () => {
    void run({ kind: "minutes", minutes: Number(minutes.value) }, continueButton);
  });
  card.append(element("div", "mark", "H"), title, message, actions, status);
  backdrop.append(card);
  const style = document.createElement("style");
  style.textContent = BLOCK_PAGE_CSS;
  shadow.append(style, backdrop);
  document.documentElement.append(host);
  setPageInert(true);
  startMediaGuard(host);
  continueButton.focus();

  async function run(
    continuation: { kind: "minutes"; minutes: number } | { kind: "video-end" },
    button: HTMLButtonElement
  ): Promise<void> {
    button.disabled = true;
    status.textContent = "";
    try {
      await onContinue(continuation, continuation.kind === "video-end" ? selectedVideo : undefined);
      for (const media of activeMedia) {
        if (!media.isConnected || media.ended || !media.paused) continue;
        void media.play().catch(() => undefined);
      }
    } catch {
      status.textContent = t("common.actionFailed");
      button.disabled = false;
    }
  }
}

interface EndContext {
  source: "focus" | "plan" | "confirmation";
  siteId?: string;
  targetId?: string;
  periodId?: string;
  itemId?: string;
  reason?: string;
  groupIndex?: number;
  groupCount?: number;
  returnUrl?: string;
  waitSeconds?: number;
}

function goToEnd(context: EndContext): void {
  flowEndedCleanup?.();
  flowEndedCleanup = null;
  const params = new URLSearchParams({ source: context.source });
  if (context.siteId) params.set("siteId", context.siteId);
  if (context.targetId) params.set("targetId", context.targetId);
  if (context.periodId) params.set("periodId", context.periodId);
  if (context.itemId) params.set("itemId", context.itemId);
  if (context.reason) params.set("reason", context.reason);
  if (context.groupIndex !== undefined) params.set("groupIndex", String(context.groupIndex));
  if (context.groupCount !== undefined) params.set("groupCount", String(context.groupCount));
  if (context.returnUrl) params.set("returnUrl", context.returnUrl);
  if (context.waitSeconds !== undefined) params.set("waitSeconds", String(context.waitSeconds));
  window.location.assign(`${runtimeGetURL("end.html")}#${params.toString()}`);
}

function monitorVideoEnd(
  key: string,
  preferredVideo: HTMLVideoElement | undefined,
  onEnded: () => Promise<void>
): void {
  if ((monitorVideoEnd as unknown as { key?: string }).key === key) return;
  flowEndedCleanup?.();
  let monitoredVideo: HTMLVideoElement | undefined;
  const handler = () => {
    flowEndedCleanup?.();
    flowEndedCleanup = null;
    void onEnded().catch(() => undefined);
  };
  const attach = (video: HTMLVideoElement): boolean => {
    if (video.ended || monitoredVideo) return false;
    monitoredVideo = video;
    document.removeEventListener("play", handlePlay, true);
    video.addEventListener("ended", handler, { once: true });
    return true;
  };
  const handlePlay = (event: Event) => {
    if (event.target instanceof HTMLVideoElement) attach(event.target);
  };
  const current = preferredVideo ?? selectPrimaryVideo(findPlayingVideos());
  if (!current || !attach(current)) document.addEventListener("play", handlePlay, true);
  const replacementObserver = new MutationObserver(() => {
    if (!monitoredVideo || monitoredVideo.isConnected) return;
    monitoredVideo.removeEventListener("ended", handler);
    monitoredVideo = undefined;
    const replacement = selectPrimaryVideo(findPlayingVideos());
    if (!replacement || !attach(replacement)) document.addEventListener("play", handlePlay, true);
  });
  replacementObserver.observe(document, { childList: true, subtree: true });
  (monitorVideoEnd as unknown as { key?: string }).key = key;
  flowEndedCleanup = () => {
    replacementObserver.disconnect();
    document.removeEventListener("play", handlePlay, true);
    monitoredVideo?.removeEventListener("ended", handler);
    delete (monitorVideoEnd as unknown as { key?: string }).key;
  };
}

function findPlayingVideos(): HTMLVideoElement[] {
  return [...document.querySelectorAll<HTMLVideoElement>("video")].filter(
    (video) => !video.paused && !video.ended
  );
}

function selectPrimaryVideo(videos: readonly HTMLVideoElement[]): HTMLVideoElement | undefined {
  if (videos.length === 0) return undefined;
  const pictureInPicture = document.pictureInPictureElement;
  if (pictureInPicture instanceof HTMLVideoElement && videos.includes(pictureInPicture)) {
    return pictureInPicture;
  }
  const fullscreen = document.fullscreenElement;
  if (fullscreen) {
    const fullscreenVideo = videos.find(
      (video) => video === fullscreen || fullscreen.contains(video)
    );
    if (fullscreenVideo) return fullscreenVideo;
  }
  return [...videos].sort((left, right) => visibleVideoArea(right) - visibleVideoArea(left))[0];
}

function visibleVideoArea(video: HTMLVideoElement): number {
  const bounds = video.getBoundingClientRect();
  const width = Math.max(0, Math.min(bounds.right, innerWidth) - Math.max(bounds.left, 0));
  const height = Math.max(0, Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0));
  return width * height;
}

async function syncContentLocale(): Promise<void> {
  try {
    const settings = await sendRequest({ type: "GET_SETTINGS" });
    configureLocale(settings.locale);
  } catch {
    configureLocale("system");
  }
}

async function showReminder(title: string, message: string, key: string): Promise<void> {
  const storageKey = `hourleaf-reminder:${formatLocalDate(new Date())}:${key}`;
  if (sessionStorage.getItem(storageKey)) return;
  sessionStorage.setItem(storageKey, "1");
  await whenDocumentReady();
  const reminder = element("aside", "", `${title} · ${message}`);
  reminder.setAttribute("role", "status");
  Object.assign(reminder.style, {
    position: "fixed",
    right: "20px",
    bottom: "20px",
    zIndex: "2147483646",
    maxWidth: "360px",
    padding: "14px 18px",
    borderRadius: "14px",
    color: "#172033",
    background: "#fff",
    boxShadow: "0 18px 50px rgba(23,32,51,.2)",
    font: "600 13px/1.6 ui-sans-serif, system-ui"
  });
  document.documentElement.append(reminder);
  setTimeout(() => reminder.remove(), 8_000);
}

function applyLocalPageRules(css: string, hideSelectors: string[]): void {
  document.getElementById(LOCAL_STYLE_ID)?.remove();
  const hideCss = hideSelectors
    .map((selector) => `${selector} { display: none !important; }`)
    .join("\n");
  const combined = [hideCss, css].filter((part) => part.trim()).join("\n\n");
  if (!combined) return;
  const style = document.createElement("style");
  style.id = LOCAL_STYLE_ID;
  style.textContent = combined;
  (document.head ?? document.documentElement).append(style);
}

/** @deprecated Kept as a compatibility renderer for module integrations. */
export function renderBlockPage(decision: PageDecision, url: string): void {
  removeBlockPage();
  pauseMedia(document);

  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.setAttribute("role", "presentation");
  // Keep the blocker above extension-replaced homepages even when their
  // light-DOM styles target every div on the page.
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("inset", "0", "important");
  host.style.setProperty("z-index", "2147483647", "important");
  host.style.setProperty("display", "block", "important");
  host.style.setProperty("visibility", "visible", "important");
  host.style.setProperty("opacity", "1", "important");
  host.style.setProperty("pointer-events", "auto", "important");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = BLOCK_PAGE_CSS;

  const backdrop = element("main", "backdrop");
  backdrop.setAttribute("aria-labelledby", "hourleaf-title");
  const card = element("section", "card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-describedby", "hourleaf-message");

  const mark = element("div", "mark", "H");
  mark.setAttribute("aria-hidden", "true");
  const eyebrow = element("p", "eyebrow", "Hourleaf");
  const heading = element("h1", "", t("end.restrictedTitle"));
  heading.id = "hourleaf-title";

  const moduleMatch = resolveSiteModule(url)?.match(url);
  const sectionLabel =
    moduleMatch && (!decision.targetId || decision.targetId === moduleMatch.targetId)
      ? moduleMatch.sectionLabel
      : t("end.currentPage");
  const reasonText =
    decision.reason === "daily-limit"
      ? t("end.limitMessage", { site: sectionLabel })
      : decision.reason === "domain-block"
        ? t("end.domainBlocked", { site: sectionLabel })
        : t("end.periodBlocked", { site: sectionLabel });
  const message = element("p", "message", reasonText);
  message.id = "hourleaf-message";

  const actions = element("div", "actions");
  const backButton = element("button", "", t("end.back"));
  backButton.type = "button";
  backButton.addEventListener("click", () => {
    if (history.length > 1) history.back();
    else {
      const fallbackUrl = resolveSiteModule(url)?.match(url)?.fallbackUrl;
      if (fallbackUrl) window.location.assign(fallbackUrl);
      else window.close();
    }
  });
  actions.append(backButton);

  let allowButton: HTMLButtonElement | null = null;
  if (decision.canRequestTemporaryAccess) {
    allowButton = element("button", "primary", t("end.temporaryAccess"));
    allowButton.type = "button";
    actions.append(allowButton);
  }

  const hint = decision.canRequestTemporaryAccess
    ? element(
        "p",
        "hint",
        t("end.temporaryRemaining", { count: decision.temporaryAccessUsesRemaining })
      )
    : null;
  const status = element("div", "status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  card.append(mark, eyebrow, heading, message, actions);
  if (hint) card.append(hint);
  card.append(status);
  backdrop.append(card);
  shadow.append(style, backdrop);
  document.documentElement.append(host);
  setPageInert(true);
  startMediaGuard(host);

  allowButton?.addEventListener("click", () => void requestTemporaryAccess());

  async function requestTemporaryAccess(): Promise<void> {
    if (!allowButton) return;
    allowButton.disabled = true;
    status.textContent = t("end.openingTemporary");
    try {
      const match = resolveSiteModule(url)?.match(url);
      const nextDecision = await sendRequest({
        type: "GRANT_TEMPORARY_ACCESS",
        url,
        ...(match ? { targetId: match.targetId } : {})
      });
      if (!nextDecision.blocked) {
        removeBlockPage();
        return;
      }
      status.textContent = t("end.temporaryExhausted");
    } catch {
      status.textContent = t("common.actionFailed");
    } finally {
      allowButton.disabled = false;
    }
  }

  requestAnimationFrame(() => (allowButton ?? backButton).focus());
}

function removeBlockPage(): void {
  mediaObserver?.disconnect();
  mediaObserver = null;
  const host = document.getElementById(ROOT_ID);
  if (host) host.remove();
  restoreManagedBody();
}

function setPageInert(inert: boolean): void {
  if (!document.body || !inert || managedBody === document.body) return;
  restoreManagedBody();
  bodyWasInert = document.body.inert;
  document.body.inert = true;
  managedBody = document.body;
}

function restoreManagedBody(): void {
  if (!managedBody) return;
  managedBody.inert = bodyWasInert;
  managedBody = null;
}

function startMediaGuard(host: HTMLElement): void {
  mediaObserver?.disconnect();
  mediaObserver = new MutationObserver((mutations) => {
    // A site module may replace the body during startup. Keep the extension-owned
    // blocker outside that body and restore it across mount transitions.
    if (!host.isConnected && document.documentElement) document.documentElement.append(host);
    setPageInert(true);
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) pauseMedia(node);
      }
    }
  });
  mediaObserver.observe(document, { childList: true, subtree: true });
}

function pauseMedia(root: ParentNode): void {
  for (const media of root.querySelectorAll<HTMLMediaElement>("video, audio")) media.pause();
}

function whenDocumentReady(): Promise<void> {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) =>
    document.addEventListener("DOMContentLoaded", () => resolve(), { once: true })
  );
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const BLOCK_PAGE_CSS = `
  :host { all: initial; color-scheme: light dark; }
  .backdrop {
    position: fixed; inset: 0; z-index: 2147483647; box-sizing: border-box;
    display: grid; place-items: center; overflow: auto; padding: 32px 20px;
    font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #172033;
    background: radial-gradient(circle at 15% 12%, rgba(95, 179, 255, .2), transparent 30%),
      radial-gradient(circle at 85% 88%, rgba(251, 114, 153, .16), transparent 34%), #f7f9fc;
  }
  .card {
    width: min(100%, 520px); box-sizing: border-box; padding: clamp(28px, 6vw, 48px);
    border: 1px solid rgba(23, 32, 51, .09); border-radius: 28px;
    background: rgba(255, 255, 255, .9); box-shadow: 0 28px 80px rgba(33, 47, 79, .14);
    text-align: center; backdrop-filter: blur(18px);
  }
  .mark {
    display: grid; place-items: center; width: 64px; height: 64px; margin: 0 auto 24px;
    border-radius: 20px; color: #fff; background: linear-gradient(135deg, #00aeec, #fb7299);
    box-shadow: 0 14px 28px rgba(0, 174, 236, .22); font: 700 24px/1 ui-sans-serif;
  }
  .eyebrow { margin: 0 0 10px; color: #61708c; font-size: 13px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  h1 { margin: 0; color: #172033; font-size: clamp(28px, 6vw, 38px); line-height: 1.18; letter-spacing: -.03em; }
  .message { margin: 18px auto 0; max-width: 390px; color: #56627a; font-size: 16px; line-height: 1.75; }
  .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 30px; }
  button { min-height: 46px; padding: 0 20px; border: 1px solid #d8deea; border-radius: 13px; color: #29354d; background: #fff; font: 650 14px/1 ui-sans-serif; cursor: pointer; }
  button.primary { border-color: #00aeec; color: #fff; background: #00aeec; }
  @media (hover: hover) and (pointer: fine) { button:hover { filter: brightness(.97); transform: translateY(-1px); } }
  button:focus-visible { outline: 3px solid rgba(0, 174, 236, .35); outline-offset: 3px; }
  button[disabled] { cursor: wait; opacity: .65; transform: none; }
  .hint { margin: 18px 0 0; color: #77839a; font-size: 12px; line-height: 1.55; }
  .status { min-height: 20px; margin-top: 12px; color: #b83b62; font-size: 13px; }
  @media (prefers-color-scheme: dark) {
    .backdrop { color: #f3f6fc; background: radial-gradient(circle at 20% 10%, #163951, transparent 36%), #10141d; }
    .card { border-color: rgba(255,255,255,.1); background: rgba(27, 34, 48, .94); box-shadow: 0 28px 80px rgba(0,0,0,.4); }
    h1 { color: #f3f6fc; } .message { color: #b8c1d4; } .eyebrow, .hint { color: #929db3; }
    button { border-color: #465168; color: #e8edf7; background: #273044; }
    button.primary { border-color: #00aeec; background: #00aeec; color: #fff; }
  }
  @media (prefers-reduced-motion: no-preference) { button { transition: transform .15s ease, filter .15s ease; } }
`;
