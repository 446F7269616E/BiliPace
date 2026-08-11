import { tabsQuery } from "../shared/browser";
import { sendRequest } from "../shared/messages";
import type {
  FocusSettings,
  ManagedSite,
  PageDecision,
  SiteTargetSettings,
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
  hostname: string | null;
  usedSeconds: number;
  limitSeconds: number | null;
}

const app = assertAppRoot();
let currentData: PopupData | null = null;

void loadPopup();
window.setInterval(() => void refreshLiveSummary(), 5_000);

async function loadPopup(): Promise<void> {
  renderLoading();
  try {
    const tabsPromise = tabsQuery({ active: true, currentWindow: true });
    const [settings, usage, trackingStatus, tabs] = await Promise.all([
      sendRequest({ type: "GET_SETTINGS" }),
      sendRequest({ type: "GET_USAGE", period: "day" }),
      sendRequest({ type: "GET_TRACKING_STATUS" }),
      tabsPromise
    ]);
    const pageUrl = tabs[0]?.url ?? null;
    const pageDecision = pageUrl
      ? await sendRequest({ type: "GET_PAGE_DECISION", url: pageUrl })
      : null;
    renderPopup({ settings, usage, trackingStatus, pageDecision, pageUrl });
  } catch (error) {
    renderError(describeError(error));
  }
}

async function refreshLiveSummary(): Promise<void> {
  if (!currentData || document.visibilityState !== "visible") return;
  try {
    const pageDecisionPromise = currentData.pageUrl
      ? sendRequest({ type: "GET_PAGE_DECISION", url: currentData.pageUrl })
      : Promise.resolve(null);
    const [usage, trackingStatus, pageDecision] = await Promise.all([
      sendRequest({ type: "GET_USAGE", period: "day" }),
      sendRequest({ type: "GET_TRACKING_STATUS" }),
      pageDecisionPromise
    ]);
    renderPopup({ ...currentData, usage, trackingStatus, pageDecision });
  } catch {
    // 保留最近一次确认的数据，等待下一轮刷新恢复。
  }
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
          text: "正在读取当前网站使用时间"
        }),
        createMainLink()
      ]
    })
  );
}

function renderError(message: string): void {
  const retry = element("button", {
    className: "btn btn--primary",
    text: "重新加载",
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
                element("h2", { text: "使用时间加载失败" }),
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
  app.replaceChildren(
    element("div", {
      className: "popup-shell",
      children: [
        createHeader(),
        createCurrentSiteCard(data, summary),
        createMainLink(),
        element("p", {
          className: "popup-footer",
          text: "使用时间仅保存在当前浏览器"
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
  const usedSeconds = targetIds.reduce(
    (total, id) => total + Math.max(0, data.usage.byTarget[id] ?? 0),
    0
  );
  const limitSeconds =
    target?.dailyLimitMinutes === null || target?.dailyLimitMinutes === undefined
      ? null
      : target.dailyLimitMinutes * 60;

  return {
    site,
    target,
    hostname: site?.hostname ?? parsedUrl?.hostname ?? null,
    usedSeconds,
    limitSeconds
  };
}

function createCurrentSiteCard(data: PopupData, summary: CurrentSiteSummary): HTMLElement {
  const configured = Boolean(summary.site);
  const remainingSeconds =
    summary.limitSeconds === null ? null : Math.max(0, summary.limitSeconds - summary.usedSeconds);
  const progress =
    summary.limitSeconds === null || summary.limitSeconds <= 0
      ? 0
      : Math.min(100, (summary.usedSeconds / summary.limitSeconds) * 100);
  const label = summary.site?.label || summary.hostname || "当前页面";
  const scope = summary.target
    ? `${summary.hostname ?? "当前网站"} · ${summary.target.label}`
    : configured
      ? summary.hostname
      : "尚未添加时间配置";
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
                  element("p", { text: "当前网站" }),
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
            "今日已用",
            configured ? formatDuration(summary.usedSeconds) : "未配置",
            "popup-today-time"
          ),
          createMetric(
            "剩余时间",
            !configured
              ? "未配置"
              : remainingSeconds === null
                ? "不限额"
                : formatDuration(remainingSeconds),
            "popup-remaining-time"
          )
        ]
      }),
      summary.limitSeconds === null || !configured
        ? element("p", {
            className: "current-site-card__note",
            text: configured ? "当前范围没有设置每日限额" : "进入主界面可为此网站添加时间配置"
          })
        : element("div", {
            className: "current-site-card__progress",
            attrs: {
              role: "progressbar",
              "aria-label": "今日限额使用进度",
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
  if (!summary.site) return { kind: "unmanaged", label: "未配置" };
  if (!data.settings.enabled || !summary.site.enabled) {
    return { kind: "paused", label: "已暂停" };
  }
  if (data.pageDecision?.blocked) return { kind: "blocked", label: "当前受限" };
  const trackingTarget = data.trackingStatus.targetId
    ? data.settings.targets[data.trackingStatus.targetId]
    : undefined;
  if (data.trackingStatus.isTracking && trackingTarget?.siteId === summary.site.id) {
    return { kind: "active", label: "正在计时" };
  }
  return { kind: "paused", label: "当前未计时" };
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
              element("small", { text: "时间概览" })
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
    children: [icon("bar-chart"), "进入 Hourleaf 主界面"]
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
