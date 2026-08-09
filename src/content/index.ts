import { runtimeGetURL, storageAddChangeListener } from "../shared/browser";
import { sendRequest, type SessionEvent } from "../shared/messages";
import type { PageDecision } from "../shared/types";
import { STORAGE_KEYS } from "../shared/storage-keys";
import { resolveSiteModule, subscribeSiteModuleRegistry } from "../modules/registry";
import { ContentFilterController } from "./content-filters";

const ROOT_ID = "hourleaf-block-root";
const HEARTBEAT_INTERVAL_MS = 15_000;
const ROUTE_POLL_INTERVAL_MS = 1_000;
const SESSION_ID = createSessionId();
const contentFilters = new ContentFilterController();

subscribeSiteModuleRegistry(() => void evaluatePage());

let renderedForUrl = "";
let lastSeenUrl = window.location.href;
let evaluationGeneration = 0;
let mediaObserver: MutationObserver | null = null;
let bodyWasInert = false;
let managedBody: HTMLElement | null = null;
let contentStarted = false;
let planCheckGeneration = 0;
let initializationRetry: ReturnType<typeof setTimeout> | null = null;

void initializeContent();

window.addEventListener("popstate", routeMayHaveChanged);
window.addEventListener("hashchange", routeMayHaveChanged);
document.addEventListener("visibilitychange", () => {
  if (contentStarted) void sendSessionUpdate("heartbeat");
});
storageAddChangeListener((changes, areaName) => {
  if (areaName !== "local") return;
  const changed = changes[STORAGE_KEYS.settings];
  if (!changed || changed.newValue === undefined) return;
  void evaluatePage();
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
    if (decision.allowed) return "allowed";
    if (contentStarted) await sendSessionUpdate("stop");
    contentStarted = false;
    removeBlockPage();
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
    const [decision, settings] = await Promise.all([
      sendRequest({
        type: "GET_PAGE_DECISION",
        url,
        ...(match ? { targetId: match.targetId } : {})
      }),
      sendRequest({ type: "GET_SETTINGS" })
    ]);
    if (generation !== evaluationGeneration || topLevelUrl !== window.location.href) return;
    contentFilters.apply(module?.contentSettings(settings) ?? settings.contentFilters, url);
    if (!decision.blocked) {
      removeBlockPage();
      renderedForUrl = url;
      return;
    }

    if (renderedForUrl !== url || !document.getElementById(ROOT_ID)) {
      await whenDocumentReady();
      if (topLevelUrl !== window.location.href) return;
      renderBlockPage(decision, url);
      renderedForUrl = url;
    }
  } catch (error) {
    // A missing or restarting background context must never break the current site.
    console.debug("Hourleaf page check unavailable", error);
  }
}

function renderBlockPage(decision: PageDecision, url: string): void {
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
  const heading = element("h1", "", "当前页面已受限");
  heading.id = "hourleaf-title";

  const moduleMatch = resolveSiteModule(url)?.match(url);
  const sectionLabel =
    moduleMatch && (!decision.targetId || decision.targetId === moduleMatch.targetId)
      ? moduleMatch.sectionLabel
      : "此页面";
  const reasonText =
    decision.reason === "daily-limit"
      ? `${sectionLabel}的今日使用额度已用完。`
      : `${sectionLabel}在当前时段不可用。`;
  const message = element("p", "message", reasonText);
  message.id = "hourleaf-message";

  const actions = element("div", "actions");
  const backButton = element("button", "", "返回上一页");
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
    allowButton = element("button", "primary", "临时访问");
    allowButton.type = "button";
    actions.append(allowButton);
  }

  const hint = decision.canRequestTemporaryAccess
    ? element("p", "hint", `今日还可临时访问 ${decision.temporaryAccessUsesRemaining} 次。`)
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
    status.textContent = "正在开启临时访问…";
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
      status.textContent = "今天的临时访问次数已用完。";
    } catch {
      status.textContent = "临时访问没有开启，请重试。";
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
  button:hover { filter: brightness(.97); transform: translateY(-1px); }
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
