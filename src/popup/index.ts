import {
  storageAddChangeListener,
  tabsAddActivatedListener,
  tabsAddUpdatedListener,
  tabsQuery
} from "../shared/browser";
import { configureLocale, localizeDocumentTitle, t } from "../shared/i18n";
import { sendRequest } from "../shared/messages";
import { resolveTargetAllowance } from "../shared/remaining-time";
import { STORAGE_KEYS } from "../shared/storage-keys";
import type {
  FocusSettings,
  ManagedSite,
  PageDecision,
  SiteTargetSettings,
  TimePeriodSettings,
  TrackingStatus,
  UsageSummary
} from "../shared/types";
import { assertAppRoot, describeError, element, formatDuration, icon } from "../styles/dom";

interface PopupData {
  settings: FocusSettings;
  usage: UsageSummary;
  pageDecision: PageDecision | null;
  pageUrl: string | null;
  trackingStatus: TrackingStatus;
}

interface CurrentSiteSummary {
  site: ManagedSite | null;
  target: SiteTargetSettings | null;
  activePeriod: TimePeriodSettings | null;
  hostname: string | null;
  usedSeconds: number;
  allowanceUsedSeconds: number;
  limitSeconds: number | null;
  remainingSeconds: number | null;
}

const app = assertAppRoot();
let currentData: PopupData | null = null;
let refreshSequence = 0;
let refreshScheduled = false;

configureLocale("system");
void loadPopup();
const syncTimer = window.setInterval(() => void refreshLiveSummary(), 5_000);
const displayTimer = window.setInterval(() => advanceLiveUsage(), 1_000);
const removeTabActivatedListener = tabsAddActivatedListener(() => scheduleRefresh());
const removeTabUpdatedListener = tabsAddUpdatedListener((_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url !== undefined || changeInfo.status === "complete")) {
    scheduleRefresh();
  }
});
const removeStorageListener = storageAddChangeListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEYS.settings]) scheduleRefresh();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleRefresh();
});
window.addEventListener(
  "pagehide",
  () => {
    window.clearInterval(syncTimer);
    window.clearInterval(displayTimer);
    removeTabActivatedListener();
    removeTabUpdatedListener();
    removeStorageListener();
  },
  { once: true }
);

async function loadPopup(): Promise<void> {
  renderLoading();
  try {
    const data = await fetchPopupData();
    configureLocale(data.settings.locale);
    localizeDocumentTitle("popup");
    renderPopup(data);
  } catch (error) {
    renderError(describeError(error));
  }
}

async function refreshLiveSummary(): Promise<void> {
  if (document.visibilityState !== "visible") return;
  const sequence = ++refreshSequence;
  try {
    const data = await fetchPopupData();
    if (sequence !== refreshSequence) return;
    if (data.settings.locale !== currentData?.settings.locale) {
      configureLocale(data.settings.locale);
      localizeDocumentTitle("popup");
    }
    renderPopup(data);
  } catch {
    // 保留最近一次确认的数据，等待下一轮刷新恢复。
  }
}

async function fetchPopupData(): Promise<PopupData> {
  const [settings, usage, trackingStatus, tabs] = await Promise.all([
    sendRequest({ type: "GET_SETTINGS" }),
    sendRequest({ type: "GET_USAGE", period: "day" }),
    sendRequest({ type: "GET_TRACKING_STATUS" }),
    tabsQuery({ active: true, currentWindow: true })
  ]);
  const pageUrl = tabs[0]?.url ?? null;
  const httpUrl = parseHttpUrl(pageUrl);
  const pageDecision = httpUrl
    ? await sendRequest({ type: "GET_PAGE_DECISION", url: httpUrl.href })
    : null;
  return { settings, usage, trackingStatus, pageDecision, pageUrl };
}

function scheduleRefresh(): void {
  if (refreshScheduled) return;
  refreshScheduled = true;
  window.setTimeout(() => {
    refreshScheduled = false;
    void refreshLiveSummary();
  }, 0);
}

function advanceLiveUsage(): void {
  const data = currentData;
  if (!data || document.visibilityState !== "visible" || !data.trackingStatus.isTracking) return;
  const targetId = data.trackingStatus.targetId;
  if (!targetId || data.pageDecision?.targetId !== targetId) return;
  const activePeriodId = data.pageDecision.activePeriodId;
  const usage: UsageSummary = {
    ...data.usage,
    totalSeconds: data.usage.totalSeconds + 1,
    byTarget: {
      ...data.usage.byTarget,
      [targetId]: (data.usage.byTarget[targetId] ?? 0) + 1
    },
    byPeriod: activePeriodId
      ? {
          ...data.usage.byPeriod,
          [activePeriodId]: (data.usage.byPeriod[activePeriodId] ?? 0) + 1
        }
      : data.usage.byPeriod
  };
  renderPopup({ ...data, usage });
}

function renderLoading(): void {
  app.replaceChildren(
    element("div", {
      className: "popup-shell",
      attrs: { "aria-busy": "true" },
      children: [
        createHeader(),
        element("section", {
          className: "current-site-card card skeleton",
          text: t("popup.loading")
        }),
        createMainLink()
      ]
    })
  );
}

function renderError(message: string): void {
  const retry = element("button", {
    className: "btn btn--primary",
    text: t("options.reload"),
    attrs: { type: "button" }
  });
  retry.addEventListener("click", () => void loadPopup());

  app.replaceChildren(
    element("div", {
      className: "popup-shell",
      children: [
        createHeader(),
        element("section", {
          className: "state-view card popup-error",
          attrs: { role: "alert" },
          children: [
            element("div", {
              children: [
                element("div", { className: "state-view__icon", children: [icon("warning")] }),
                element("h2", { text: t("popup.loadFailed") }),
                element("p", { text: message }),
                retry
              ]
            })
          ]
        }),
        createMainLink()
      ]
    })
  );
}

function renderPopup(data: PopupData): void {
  currentData = data;
  const summary = resolveCurrentSiteSummary(data);
  const existingCard = app.querySelector<HTMLElement>(".current-site-card");
  if (existingCard && app.querySelector(".popup-shell")) {
    existingCard.replaceWith(createCurrentSiteCard(data, summary));
    return;
  }
  app.replaceChildren(
    element("div", {
      className: "popup-shell",
      children: [
        createHeader(),
        createCurrentSiteCard(data, summary),
        createMainLink(),
        element("p", {
          className: "popup-footer",
          text: t("popup.localOnly")
        })
      ]
    })
  );
}

function resolveCurrentSiteSummary(data: PopupData): CurrentSiteSummary {
  const parsedUrl = parseHttpUrl(data.pageUrl);
  const decisionTarget = data.pageDecision?.targetId
    ? (data.settings.targets[data.pageDecision.targetId] ?? null)
    : null;
  const trackingTarget = data.trackingStatus.targetId
    ? (data.settings.targets[data.trackingStatus.targetId] ?? null)
    : null;
  const trackingSite = trackingTarget ? (data.settings.sites[trackingTarget.siteId] ?? null) : null;
  const candidateTarget =
    decisionTarget ?? (trackingSite?.origin === parsedUrl?.origin ? trackingTarget : null);
  const siteId = data.pageDecision?.siteId ?? candidateTarget?.siteId;
  const site = siteId
    ? (data.settings.sites[siteId] ?? null)
    : (Object.values(data.settings.sites).find(
        (candidate) => candidate.origin === parsedUrl?.origin
      ) ?? null);
  const target = candidateTarget?.siteId === site?.id ? candidateTarget : null;
  const targetIds = target ? [target.id] : (site?.targetIds ?? []);
  const fallbackUsedSeconds = targetIds.reduce(
    (total, id) => total + Math.max(0, data.usage.byTarget[id] ?? 0),
    0
  );
  const allowance = target
    ? resolveTargetAllowance(target, data.usage, data.pageDecision?.activePeriodId)
    : null;

  return {
    site,
    target,
    activePeriod: allowance?.activePeriod ?? null,
    hostname: site?.hostname ?? parsedUrl?.hostname ?? null,
    usedSeconds: allowance?.usedTodaySeconds ?? fallbackUsedSeconds,
    allowanceUsedSeconds: allowance?.allowanceUsedSeconds ?? 0,
    limitSeconds: allowance?.limitSeconds ?? null,
    remainingSeconds: allowance?.remainingSeconds ?? null
  };
}

function createCurrentSiteCard(data: PopupData, summary: CurrentSiteSummary): HTMLElement {
  const configured = Boolean(summary.site);
  const progress =
    summary.limitSeconds === null || summary.limitSeconds <= 0
      ? 0
      : Math.min(100, (summary.allowanceUsedSeconds / summary.limitSeconds) * 100);
  const label = summary.site?.label || summary.hostname || t("popup.currentPage");
  const scope = summary.target
    ? [
        summary.hostname ?? t("popup.currentWebsite"),
        summary.target.label,
        summary.activePeriod?.name ||
          (summary.activePeriod ? t("popup.defaultPeriodName") : undefined)
      ]
        .filter(Boolean)
        .join(" · ")
    : configured
      ? summary.hostname
      : t("popup.unconfiguredScope");
  const status = describeCurrentStatus(data, summary);

  return element("section", {
    className: "current-site-card card",
    attrs: { "aria-labelledby": "current-site-title" },
    children: [
      element("header", {
        className: "current-site-card__header",
        children: [
          element("div", {
            className: "current-site-card__identity",
            children: [
              element("span", {
                className: "current-site-card__icon",
                children: [icon(configured ? "clock" : "eye")]
              }),
              element("div", {
                children: [
                  element("p", { text: t("popup.currentWebsite") }),
                  element("h1", { text: label, attrs: { id: "current-site-title" } }),
                  element("span", { text: scope ?? "" })
                ]
              })
            ]
          }),
          element("span", {
            className: "current-site-card__status",
            dataset: { status: status.kind },
            text: status.label
          })
        ]
      }),
      element("div", {
        className: "current-site-card__metrics",
        children: [
          createMetric(
            t("popup.usedToday"),
            configured ? formatDuration(summary.usedSeconds) : t("popup.notConfigured"),
            "popup-today-time"
          ),
          createMetric(
            t("popup.remaining"),
            !configured
              ? t("popup.notConfigured")
              : summary.remainingSeconds === null
                ? t("popup.unlimited")
                : formatDuration(summary.remainingSeconds),
            "popup-remaining-time"
          )
        ]
      }),
      summary.limitSeconds === null || !configured
        ? element("p", {
            className: "current-site-card__note",
            text: configured ? t("popup.noLimit") : t("popup.configureHint")
          })
        : element("div", {
            className: "current-site-card__progress",
            attrs: {
              role: "progressbar",
              "aria-label": t("popup.limitProgress"),
              "aria-valuemin": "0",
              "aria-valuemax": "100",
              "aria-valuenow": String(Math.round(progress))
            },
            children: [element("span", { attrs: { style: `width: ${progress.toFixed(2)}%` } })]
          })
    ]
  });
}

function createMetric(label: string, value: string, testId: string): HTMLElement {
  return element("div", {
    className: "current-site-card__metric",
    children: [
      element("span", { text: label }),
      element("strong", { text: value, attrs: { "data-testid": testId } })
    ]
  });
}

function describeCurrentStatus(
  data: PopupData,
  summary: CurrentSiteSummary
): { kind: "active" | "blocked" | "paused" | "unmanaged"; label: string } {
  if (!summary.site) return { kind: "unmanaged", label: t("popup.notConfigured") };
  if (!data.settings.enabled) {
    return { kind: "paused", label: t("popup.paused") };
  }
  if (data.pageDecision?.blocked) return { kind: "blocked", label: t("popup.restricted") };
  const trackingTarget = data.trackingStatus.targetId
    ? data.settings.targets[data.trackingStatus.targetId]
    : undefined;
  if (data.trackingStatus.isTracking && trackingTarget?.siteId === summary.site.id) {
    return { kind: "active", label: t("popup.tracking") };
  }
  return { kind: "paused", label: t("popup.notTracking") };
}

function createHeader(): HTMLElement {
  return element("header", {
    className: "popup-header",
    children: [
      element("div", {
        className: "brand",
        attrs: { "aria-label": "Hourleaf" },
        children: [
          element("span", { className: "brand__mark", children: [icon("leaf")] }),
          element("span", {
            className: "brand__meta",
            children: [
              element("span", { text: "Hourleaf" }),
              element("small", { text: t("popup.summary") })
            ]
          })
        ]
      })
    ]
  });
}

function createMainLink(): HTMLAnchorElement {
  return element("a", {
    className: "btn btn--primary popup-main-link",
    attrs: {
      href: "dashboard.html",
      target: "_blank",
      rel: "noreferrer",
      "data-testid": "popup-open-dashboard"
    },
    children: [icon("bar-chart"), t("popup.openMain")]
  });
}

function parseHttpUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
