import { sendRequest } from "../shared/messages";
import {
  SECTION_IDS,
  SECTION_LABELS,
  type FocusSettings,
  type PlanState,
  type SectionId,
  type TrackingStatus,
  type UsageSummary
} from "../shared/types";
import { assertAppRoot, element, formatDuration, icon } from "../styles/dom";
import { createPageNavigation } from "../ui/page-navigation";

interface HomeData {
  settings: FocusSettings;
  usage: UsageSummary;
  tracking: TrackingStatus;
  plan: PlanState;
}

const REFRESH_INTERVAL_MS = 15_000;
const app = assertAppRoot();
let refreshSequence = 0;

document.body.classList.add("home-page");
void loadHome();

window.setInterval(() => {
  if (document.visibilityState === "visible") void refreshHome();
}, REFRESH_INTERVAL_MS);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshHome();
});

async function loadHome(): Promise<void> {
  renderLoading();
  await refreshHome(true);
}

async function refreshHome(showError = false): Promise<void> {
  const sequence = ++refreshSequence;
  try {
    const [settings, usage, tracking, plan] = await Promise.all([
      sendRequest({ type: "GET_SETTINGS" }),
      sendRequest({ type: "GET_USAGE", period: "day" }),
      sendRequest({ type: "GET_TRACKING_STATUS" }),
      sendRequest({ type: "GET_PLAN_STATE" })
    ]);
    if (sequence !== refreshSequence) return;
    const data = { settings, usage, tracking, plan };
    if (app.querySelector<HTMLElement>("[data-home-root]")) updateHome(data);
    else renderHome(data);
  } catch {
    if (sequence !== refreshSequence || !showError) return;
    renderError();
  }
}

function renderLoading(): void {
  app.replaceChildren(
    createShell(
      element("section", {
        className: "card state-view home-state",
        attrs: { "aria-busy": "true", "aria-label": "正在打开专注中心" },
        children: [
          element("div", {
            children: [
              element("div", { className: "state-view__icon", children: [icon("focus")] }),
              element("h2", { text: "正在准备你的专注中心" }),
              element("p", { text: "马上就好…" })
            ]
          })
        ]
      })
    )
  );
}

function renderError(): void {
  const retry = element("button", {
    className: "btn btn--primary",
    text: "重试",
    attrs: { type: "button" }
  });
  retry.addEventListener("click", () => void loadHome());
  app.replaceChildren(
    createShell(
      element("section", {
        className: "card state-view home-state",
        attrs: { role: "alert" },
        children: [
          element("div", {
            children: [
              element("div", { className: "state-view__icon", children: [icon("warning")] }),
              element("h2", { text: "暂时打不开专注中心" }),
              element("p", { text: "你的设置和记录仍安全保存在这台设备上。" }),
              retry
            ]
          })
        ]
      })
    )
  );
}

function renderHome(data: HomeData): void {
  const pendingItems = data.plan.queue.items.filter((item) => item.status === "pending");
  const managedSections = SECTION_IDS.filter(
    (section) => data.settings.sectionRules[section].enabled
  ).length;
  const trackingCopy = describeTracking(data.tracking);
  const topSection = getTopSection(data.usage);

  const content = element("div", {
    dataset: { homeRoot: "true" },
    children: [
      element("header", {
        className: "home-heading",
        children: [
          element("div", {
            children: [
              element("p", { className: "home-heading__eyebrow", text: "今天的节奏" }),
              element("h1", { className: "page-title", text: "先看清时间，再决定下一步" }),
              element("p", {
                className: "page-description",
                text: "专注状态、观看清单和使用时间都在这里。"
              })
            ]
          }),
          createLiveStatus(data.tracking, trackingCopy)
        ]
      }),
      element("section", {
        className: "home-overview",
        attrs: { "aria-label": "今日使用摘要" },
        children: [
          element("article", {
            className: "home-time-card card",
            children: [
              element("p", {
                className: "home-time-card__label",
                text: "今天的 Bilibili 使用时间"
              }),
              element("p", {
                className: "home-time-card__value",
                text: formatDuration(data.usage.totalSeconds),
                attrs: {
                  "aria-label": formatDuration(data.usage.totalSeconds, true),
                  "data-testid": "home-today-time",
                  "data-home-field": "today-value"
                }
              }),
              element("p", {
                className: "home-time-card__detail",
                dataset: { homeField: "today-detail" },
                text: topSection
                  ? `今天最多用于${SECTION_LABELS[topSection]}，${formatDuration(data.usage.bySection[topSection], true)}`
                  : "今天还没有记录，打开 Bilibili 后会自动开始。"
              }),
              element("a", {
                className: "home-time-card__link",
                attrs: { href: "dashboard.html" },
                children: ["查看使用洞察", icon("arrow")]
              })
            ]
          }),
          element("div", {
            className: "home-summary-grid",
            children: [
              createSummaryCard({
                title: "专注保护",
                status: data.settings.enabled ? "已开启" : "已暂停",
                description: data.settings.enabled
                  ? `正在管理 ${managedSections} 个页面区域`
                  : "原有规则已保留，可随时继续",
                iconName: "shield",
                active: data.settings.enabled,
                href: "options.html#sections",
                linkLabel: "调整专注设置"
              }),
              createSummaryCard({
                title: "计划模式",
                status: data.plan.settings.enabled ? "已开启" : "已暂停",
                description:
                  pendingItems.length > 0
                    ? `观看清单还有 ${pendingItems.length} 项待完成`
                    : "观看清单还是空的",
                iconName: "calendar",
                active: data.plan.settings.enabled,
                href: "plan.html",
                linkLabel: "打开观看清单"
              })
            ]
          })
        ]
      }),
      createNextSteps(data, pendingItems[0]?.title),
      element("footer", {
        className: "home-footer",
        children: [
          element("span", { text: "使用时间和观看清单只保存在这台设备" }),
          element("a", { text: "查看数据与隐私", attrs: { href: "options.html#privacy" } })
        ]
      })
    ]
  });

  app.replaceChildren(createShell(content));
}

function createShell(content: HTMLElement): HTMLElement {
  return element("div", {
    className: "home-shell app-shell",
    children: [createPageNavigation({ currentPage: "home" }), content]
  });
}

function createLiveStatus(tracking: TrackingStatus, copy: string): HTMLElement {
  return element("section", {
    className: "home-live-status card",
    dataset: { tracking: String(tracking.isTracking), homeField: "tracking" },
    attrs: { "aria-label": `计时状态：${copy}`, "aria-live": "polite" },
    children: [
      element("span", {
        className: "home-live-status__indicator",
        attrs: { "aria-hidden": "true" }
      }),
      element("span", {
        children: [
          element("strong", {
            text: tracking.isTracking ? "正在计时" : "当前未计时",
            dataset: { homeField: "tracking-title" }
          }),
          element("small", { text: copy, dataset: { homeField: "tracking-copy" } })
        ]
      })
    ]
  });
}

interface SummaryCardOptions {
  title: string;
  status: string;
  description: string;
  iconName: "shield" | "calendar";
  active: boolean;
  href: string;
  linkLabel: string;
}

function createSummaryCard(options: SummaryCardOptions): HTMLElement {
  return element("article", {
    className: "home-summary-card card",
    dataset: {
      active: String(options.active),
      homeField: options.iconName === "shield" ? "focus-card" : "plan-card"
    },
    children: [
      element("div", {
        className: "home-summary-card__top",
        children: [
          element("span", {
            className: "home-summary-card__icon",
            children: [icon(options.iconName)]
          }),
          element("span", {
            className: "home-summary-card__status",
            text: options.status,
            dataset: {
              homeField: options.iconName === "shield" ? "focus-status" : "plan-status"
            }
          })
        ]
      }),
      element("div", {
        children: [
          element("h2", { text: options.title }),
          element("p", {
            text: options.description,
            dataset: {
              homeField: options.iconName === "shield" ? "focus-description" : "plan-description"
            }
          })
        ]
      }),
      element("a", {
        className: "home-summary-card__link",
        attrs: { href: options.href },
        children: [options.linkLabel, icon("arrow")]
      })
    ]
  });
}

function createNextSteps(data: HomeData, firstPendingTitle?: string): HTMLElement {
  const items = [
    {
      iconName: "calendar" as const,
      title: firstPendingTitle ? "继续你的观看清单" : "为下次观看留一个目标",
      description: firstPendingTitle ? `下一项：${firstPendingTitle}` : "加入一个真正想看的视频。",
      href: "plan.html",
      action: firstPendingTitle ? "查看清单" : "添加视频",
      fieldPrefix: "next-plan"
    },
    {
      iconName: "bar-chart" as const,
      title: data.usage.totalSeconds > 0 ? "回顾今天的时间" : "从今天开始记录",
      description:
        data.usage.totalSeconds > 0
          ? "看看时间最多流向了哪个页面。"
          : "只记录你在前台实际使用的时间。",
      href: "dashboard.html",
      action: "查看洞察",
      fieldPrefix: "next-usage"
    },
    {
      iconName: "settings" as const,
      title: "让规则更贴合你的节奏",
      description: "选择要管理的页面，设置每日时长和专注时段。",
      href: "options.html",
      action: "打开设置",
      fieldPrefix: "next-settings"
    }
  ];

  return element("section", {
    className: "home-next",
    attrs: { "aria-labelledby": "home-next-title" },
    children: [
      element("header", {
        className: "home-next__header",
        children: [
          element("div", {
            children: [
              element("h2", { text: "下一步", attrs: { id: "home-next-title" } }),
              element("p", { text: "从当下最需要的事开始。" })
            ]
          })
        ]
      }),
      element("div", {
        className: "home-next__grid",
        children: items.map((item) =>
          element("a", {
            className: "home-action-card card",
            attrs: { href: item.href },
            children: [
              element("span", {
                className: "home-action-card__icon",
                children: [icon(item.iconName)]
              }),
              element("span", {
                className: "home-action-card__copy",
                children: [
                  element("strong", {
                    text: item.title,
                    dataset: { homeField: `${item.fieldPrefix}-title` }
                  }),
                  element("span", {
                    text: item.description,
                    dataset: { homeField: `${item.fieldPrefix}-description` }
                  })
                ]
              }),
              element("span", {
                className: "home-action-card__action",
                children: [
                  element("span", {
                    text: item.action,
                    dataset: { homeField: `${item.fieldPrefix}-action` }
                  }),
                  icon("arrow")
                ]
              })
            ]
          })
        )
      })
    ]
  });
}

/** Refreshes live values without replacing focused controls or navigation. */
function updateHome(data: HomeData): void {
  const pendingItems = data.plan.queue.items.filter((item) => item.status === "pending");
  const firstPendingTitle = pendingItems[0]?.title;
  const managedSections = SECTION_IDS.filter(
    (section) => data.settings.sectionRules[section].enabled
  ).length;
  const topSection = getTopSection(data.usage);
  const trackingCopy = describeTracking(data.tracking);

  const tracking = getHomeField("tracking");
  if (tracking) {
    tracking.dataset.tracking = String(data.tracking.isTracking);
    tracking.setAttribute("aria-label", `计时状态：${trackingCopy}`);
  }
  setHomeText("tracking-title", data.tracking.isTracking ? "正在计时" : "当前未计时");
  setHomeText("tracking-copy", trackingCopy);

  const duration = getHomeField("today-value");
  if (duration) {
    duration.textContent = formatDuration(data.usage.totalSeconds);
    duration.setAttribute("aria-label", formatDuration(data.usage.totalSeconds, true));
  }
  setHomeText(
    "today-detail",
    topSection
      ? `今天最多用于${SECTION_LABELS[topSection]}，${formatDuration(data.usage.bySection[topSection], true)}`
      : "今天还没有记录，打开 Bilibili 后会自动开始。"
  );

  updateSummaryCard(
    "focus",
    data.settings.enabled,
    data.settings.enabled ? "已开启" : "已暂停",
    data.settings.enabled ? `正在管理 ${managedSections} 个页面区域` : "原有规则已保留，可随时继续"
  );
  updateSummaryCard(
    "plan",
    data.plan.settings.enabled,
    data.plan.settings.enabled ? "已开启" : "已暂停",
    pendingItems.length > 0 ? `观看清单还有 ${pendingItems.length} 项待完成` : "观看清单还是空的"
  );

  setHomeText("next-plan-title", firstPendingTitle ? "继续你的观看清单" : "为下次观看留一个目标");
  setHomeText(
    "next-plan-description",
    firstPendingTitle ? `下一项：${firstPendingTitle}` : "加入一个真正想看的视频。"
  );
  setHomeText("next-plan-action", firstPendingTitle ? "查看清单" : "添加视频");
  setHomeText(
    "next-usage-title",
    data.usage.totalSeconds > 0 ? "回顾今天的时间" : "从今天开始记录"
  );
  setHomeText(
    "next-usage-description",
    data.usage.totalSeconds > 0 ? "看看时间最多流向了哪个页面。" : "只记录你在前台实际使用的时间。"
  );
}

function updateSummaryCard(
  prefix: "focus" | "plan",
  active: boolean,
  status: string,
  description: string
): void {
  const card = getHomeField(`${prefix}-card`);
  if (card) card.dataset.active = String(active);
  setHomeText(`${prefix}-status`, status);
  setHomeText(`${prefix}-description`, description);
}

function getHomeField(name: string): HTMLElement | null {
  return app.querySelector<HTMLElement>(`[data-home-field="${name}"]`);
}

function setHomeText(name: string, value: string): void {
  const target = getHomeField(name);
  if (target) target.textContent = value;
}

function describeTracking(status: TrackingStatus): string {
  if (status.isTracking && status.section)
    return `正在记录${SECTION_LABELS[status.section]}的使用时间`;
  if (status.idleState === "idle" || status.idleState === "locked") {
    return "你已离开设备，计时已自动暂停";
  }
  if (!status.windowFocused) return "浏览器窗口未聚焦，计时已自动暂停";
  if (status.section) return `${SECTION_LABELS[status.section]}当前不在前台`;
  return "打开 Bilibili 后会自动开始计时";
}

function getTopSection(usage: UsageSummary): SectionId | null {
  return SECTION_IDS.reduce<SectionId | null>((top, section) => {
    if (usage.bySection[section] <= 0) return top;
    return top === null || usage.bySection[section] > usage.bySection[top] ? section : top;
  }, null);
}
