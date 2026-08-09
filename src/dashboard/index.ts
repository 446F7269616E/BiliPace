import { sendRequest } from "../shared/messages";
import {
  SECTION_IDS,
  SECTION_LABELS,
  type DailyUsage,
  type SectionId,
  type TrackingStatus,
  type UsagePeriod,
  type UsageSummary
} from "../shared/types";
import {
  assertAppRoot,
  describeError,
  element,
  formatDuration,
  icon,
  setButtonBusy,
  toast
} from "../styles/dom";
import { createPageNavigation } from "../ui/page-navigation";

const SECTION_COLORS: Readonly<Record<SectionId, string>> = {
  home: "#e94983",
  dynamic: "#7657d5",
  popular: "#ef7d35",
  video: "#df5277",
  live: "#3b9f91",
  bangumi: "#4e78e8",
  search: "#63738f"
};

const PERIOD_LABELS: Readonly<Record<UsagePeriod, string>> = {
  day: "今日",
  week: "本周",
  month: "本月"
};

const app = assertAppRoot();
let currentPeriod: UsagePeriod = "week";
let loadSequence = 0;
let currentUsage: UsageSummary | null = null;

document.body.classList.add("dashboard-page");
void loadDashboard(currentPeriod);
window.setInterval(() => void refreshLiveDashboard(), 5_000);

async function loadDashboard(period: UsagePeriod): Promise<void> {
  currentPeriod = period;
  const sequence = ++loadSequence;
  renderLoading(period);
  try {
    const [usage, tracking] = await Promise.all([
      sendRequest({ type: "GET_USAGE", period }),
      sendRequest({ type: "GET_TRACKING_STATUS" })
    ]);
    if (sequence !== loadSequence) return;
    currentUsage = usage;
    renderDashboard(usage, tracking);
  } catch (error) {
    if (sequence !== loadSequence) return;
    renderError(period, describeError(error));
  }
}

async function refreshLiveDashboard(): Promise<void> {
  if (!currentUsage || document.visibilityState !== "visible") return;
  try {
    const [usage, tracking] = await Promise.all([
      sendRequest({ type: "GET_USAGE", period: currentPeriod }),
      sendRequest({ type: "GET_TRACKING_STATUS" })
    ]);
    currentUsage = usage;
    const total = document.querySelector<HTMLElement>("[data-testid='dashboard-total-time']");
    if (total) total.textContent = formatDuration(usage.totalSeconds, true);
    const live = document.querySelector<HTMLElement>("[data-testid='dashboard-live-status']");
    if (live) live.textContent = liveTrackingLabel(tracking);
  } catch {
    // Preserve the last confirmed summary while a background page wakes up.
  }
}

function renderLoading(period: UsagePeriod): void {
  const content = createShell(
    period,
    element("section", {
      className: "card state-view",
      attrs: { "aria-busy": "true", "aria-label": "正在加载仪表盘" },
      children: [
        element("div", {
          children: [
            element("div", { className: "state-view__icon", children: [icon("bar-chart")] }),
            element("h2", { text: `正在加载${PERIOD_LABELS[period]}数据` })
          ]
        })
      ]
    })
  );
  app.replaceChildren(content);
}

function renderError(period: UsagePeriod, message: string): void {
  const retry = element("button", {
    className: "btn btn--primary",
    text: "重新加载",
    attrs: { type: "button" }
  });
  retry.addEventListener("click", () => void loadDashboard(period));
  const state = element("section", {
    className: "card state-view",
    attrs: { role: "alert" },
    children: [
      element("div", {
        children: [
          element("div", { className: "state-view__icon", children: [icon("warning")] }),
          element("h2", { text: "使用时间加载失败" }),
          element("p", { text: `${message} 请重试。` }),
          retry
        ]
      })
    ]
  });
  app.replaceChildren(createShell(period, state));
}

function renderDashboard(usage: UsageSummary, tracking: TrackingStatus): void {
  const content = element("div", {
    children: [
      createOverview(usage, tracking),
      element("div", {
        className: "dashboard-grid",
        children: [
          createTrendCard(usage),
          element("aside", {
            className: "dashboard-aside",
            attrs: { "aria-label": "板块统计" },
            children: [createSectionBreakdown(usage)]
          })
        ]
      }),
      createFooter()
    ]
  });
  app.replaceChildren(createShell(usage.period, content));
}

function createShell(period: UsagePeriod, content: HTMLElement): HTMLElement {
  return element("div", {
    className: "dashboard-shell app-shell",
    children: [
      createPageNavigation({ currentPage: "dashboard" }),
      element("section", {
        className: "dashboard-heading",
        children: [
          element("div", {
            children: [element("h1", { className: "page-title", text: "仪表盘" })]
          }),
          createPeriodControl(period)
        ]
      }),
      content
    ]
  });
}

function createPeriodControl(selected: UsagePeriod): HTMLElement {
  const buttons = (Object.keys(PERIOD_LABELS) as UsagePeriod[]).map((period) => {
    const button = element("button", {
      className: "segmented__item",
      text: PERIOD_LABELS[period],
      attrs: {
        type: "button",
        "aria-pressed": period === selected,
        "data-testid": `dashboard-range-${period}`
      }
    });
    button.addEventListener("click", () => {
      if (period !== currentPeriod) void loadDashboard(period);
    });
    return button;
  });
  return element("div", {
    className: "period-control segmented",
    attrs: { role: "group", "aria-label": "统计时间范围" },
    children: buttons
  });
}

function createOverview(usage: UsageSummary, tracking: TrackingStatus): HTMLElement {
  const topSection = getTopSection(usage);
  return element("section", {
    className: "overview-grid",
    attrs: { "aria-label": `${PERIOD_LABELS[usage.period]}概览` },
    children: [
      createMetricCard(
        `${PERIOD_LABELS[usage.period]}总时长`,
        formatDuration(usage.totalSeconds, true),
        formatDateRange(usage),
        true,
        "dashboard-total-time"
      ),
      createMetricCard(
        "实时状态",
        liveTrackingLabel(tracking),
        tracking.isTracking ? "时长正在自动更新" : "切走标签页或离开设备后会自动暂停",
        false,
        "dashboard-live-status"
      ),
      createMetricCard(
        "最多使用",
        topSection ? SECTION_LABELS[topSection] : "暂无",
        topSection ? formatDuration(usage.bySection[topSection], true) : "还没有产生使用记录"
      )
    ]
  });
}

function liveTrackingLabel(tracking: TrackingStatus): string {
  if (tracking.isTracking) {
    return `正在计时 · ${tracking.section ? SECTION_LABELS[tracking.section] : "Bilibili"}`;
  }
  if (tracking.section === null) return "当前未计时";
  if (tracking.idleState === "idle" || tracking.idleState === "locked") return "离开设备，已暂停";
  return "当前未计时";
}

function createMetricCard(
  label: string,
  value: string,
  note: string,
  primary = false,
  testId?: string
): HTMLElement {
  return element("article", {
    className: `metric-card card${primary ? " metric-card--primary" : ""}`,
    children: [
      element("p", { className: "metric-card__label", text: label }),
      element("p", {
        className: "metric-card__value",
        text: value,
        attrs: { "data-testid": testId }
      }),
      element("p", { className: "metric-card__note", text: note })
    ]
  });
}

function createTrendCard(usage: UsageSummary): HTMLElement {
  const maximum = Math.max(1, ...usage.byDay.map(totalForDay));
  const columns = usage.byDay.map((day, index) => {
    const total = totalForDay(day);
    const height = total > 0 ? Math.max(2, (total / maximum) * 100) : 1.2;
    const column = element("div", {
      className: "chart-column",
      attrs: {
        tabindex: "0",
        role: "img",
        "aria-label": `${formatFullDate(day.date)}使用${formatDuration(total, true)}`
      },
      children: [
        element("div", {
          className: "chart-column__track",
          children: [
            element("div", {
              className: "chart-column__bar",
              attrs: { style: `height: ${height.toFixed(2)}%` }
            })
          ]
        }),
        element("span", {
          className: "chart-column__label",
          text: chartLabel(day.date, usage.period, index)
        }),
        element("span", {
          className: "chart-tooltip",
          text: `${formatShortDate(day.date)} · ${formatDuration(total, true)}`,
          attrs: { "aria-hidden": "true" }
        })
      ]
    });
    return column;
  });

  return element("section", {
    className: "chart-card card",
    attrs: { "aria-labelledby": "trend-title" },
    children: [
      element("header", {
        className: "chart-card__header",
        children: [
          element("div", {
            children: [
              element("h2", { text: "每日趋势", attrs: { id: "trend-title" } }),
              element("p", { text: "只统计 Bilibili 页面处于前台且浏览器窗口活跃的时间" })
            ]
          }),
          element("span", {
            className: "badge",
            children: [icon("calendar"), formatDateRange(usage)]
          })
        ]
      }),
      element("div", {
        className: "bar-chart",
        attrs: {
          "aria-label": `${PERIOD_LABELS[usage.period]}每日使用时长柱状图`,
          "data-testid": "dashboard-trend-chart"
        },
        children: columns
      })
    ]
  });
}

function createSectionBreakdown(usage: UsageSummary): HTMLElement {
  const maximum = Math.max(1, ...SECTION_IDS.map((section) => usage.bySection[section]));
  const rows = [...SECTION_IDS]
    .sort((a, b) => usage.bySection[b] - usage.bySection[a])
    .map((section) => {
      const value = usage.bySection[section];
      const percentage = Math.max(0, Math.min(100, (value / maximum) * 100));
      return element("div", {
        className: "section-total",
        attrs: { style: `--section-color: ${SECTION_COLORS[section]}` },
        children: [
          element("div", {
            className: "section-total__header",
            children: [
              element("span", {
                className: "section-total__name",
                children: [
                  element("span", { className: "section-total__dot" }),
                  SECTION_LABELS[section]
                ]
              }),
              element("span", {
                className: "section-total__value",
                text: formatDuration(value, true)
              })
            ]
          }),
          element("div", {
            className: "section-total__track",
            attrs: {
              role: "progressbar",
              "aria-label": `${SECTION_LABELS[section]}时长`,
              "aria-valuemin": "0",
              "aria-valuemax": maximum,
              "aria-valuenow": value
            },
            children: [
              element("div", {
                className: "section-total__bar",
                attrs: { style: `width: ${percentage.toFixed(2)}%` }
              })
            ]
          })
        ]
      });
    });

  return element("section", {
    className: "section-breakdown card",
    attrs: { "aria-labelledby": "breakdown-title", "data-testid": "dashboard-section-list" },
    children: [
      element("h2", { text: "板块分布", attrs: { id: "breakdown-title" } }),
      element("p", { text: "按累计时长从高到低排列" }),
      element("div", { className: "section-totals", children: rows })
    ]
  });
}

function createFooter(): HTMLElement {
  const clearButton = element("button", {
    className: "btn btn--danger",
    text: "清除所有使用数据",
    attrs: { type: "button" }
  });
  clearButton.addEventListener("click", () => openClearDialog());
  return element("footer", {
    className: "dashboard-footer",
    children: [
      element("p", { text: "BiliPace 仅保存日期、板块与时长，不记录视频、搜索词或账号信息。" }),
      clearButton
    ]
  });
}

function openClearDialog(): void {
  const titleId = "clear-data-title";
  const backdrop = element("div", { className: "dialog-backdrop" });
  const cancel = element("button", { className: "btn", text: "取消", attrs: { type: "button" } });
  const confirm = element("button", {
    className: "btn btn--danger",
    text: "永久清除",
    attrs: { type: "button" }
  });
  const close = (): void => backdrop.remove();
  cancel.addEventListener("click", close);
  confirm.addEventListener("click", () => {
    void clearUsage();
  });

  async function clearUsage(): Promise<void> {
    setButtonBusy(confirm, true, "正在清除");
    try {
      await sendRequest({ type: "CLEAR_USAGE" });
      close();
      toast("所有使用数据已清除");
      await loadDashboard(currentPeriod);
    } catch (error) {
      setButtonBusy(confirm, false);
      toast(describeError(error), "error");
    }
  }
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.append(
    element("section", {
      className: "dialog",
      attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
      children: [
        element("header", {
          className: "dialog__header",
          children: [
            element("div", {
              children: [
                element("h2", { text: "清除所有使用数据？", attrs: { id: titleId } }),
                element("p", {
                  className: "muted",
                  text: "此操作无法撤销。专注设置和计划不会受到影响。"
                })
              ]
            })
          ]
        }),
        element("footer", { className: "dialog__footer", children: [cancel, confirm] })
      ]
    })
  );
  document.body.append(backdrop);
  cancel.focus();
}

function getTopSection(usage: UsageSummary): SectionId | null {
  return SECTION_IDS.reduce<SectionId | null>((top, section) => {
    if (usage.bySection[section] <= 0) return top;
    return top === null || usage.bySection[section] > usage.bySection[top] ? section : top;
  }, null);
}

function totalForDay(day: DailyUsage): number {
  return SECTION_IDS.reduce((total, section) => total + day.bySection[section], 0);
}

function parseDate(value: string): Date {
  const [year = "1970", month = "01", day = "01"] = value.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function formatDateRange(usage: UsageSummary): string {
  if (usage.startDate === usage.endDate) return formatFullDate(usage.startDate);
  const formatter = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" });
  return `${formatter.format(parseDate(usage.startDate))} – ${formatter.format(parseDate(usage.endDate))}`;
}

function formatFullDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(parseDate(value));
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(
    parseDate(value)
  );
}

function chartLabel(value: string, period: UsagePeriod, index: number): string {
  const date = parseDate(value);
  if (period === "week") return ["日", "一", "二", "三", "四", "五", "六"][date.getDay()] ?? "";
  if (period === "month")
    return index % 5 === 0 || index === date.getDate() - 1 ? String(date.getDate()) : "";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
