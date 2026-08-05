import { sendRequest } from "../shared/messages";
import {
  SECTION_IDS,
  SECTION_LABELS,
  type DailyUsage,
  type SectionId,
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

document.body.classList.add("dashboard-page");
void loadDashboard(currentPeriod);

async function loadDashboard(period: UsagePeriod): Promise<void> {
  currentPeriod = period;
  const sequence = ++loadSequence;
  renderLoading(period);
  try {
    const usage = await sendRequest({ type: "GET_USAGE", period });
    if (sequence !== loadSequence) return;
    renderDashboard(usage);
  } catch (error) {
    if (sequence !== loadSequence) return;
    renderError(period, describeError(error));
  }
}

function renderLoading(period: UsagePeriod): void {
  const content = createShell(
    period,
    element("section", {
      className: "card state-view",
      attrs: { "aria-busy": "true", "aria-label": "正在加载使用洞察" },
      children: [
        element("div", {
          children: [
            element("div", { className: "state-view__icon", children: [icon("bar-chart")] }),
            element("h2", { text: `正在整理${PERIOD_LABELS[period]}数据` }),
            element("p", { text: "汇总各板块时长与每日趋势…" })
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
          element("h2", { text: "使用洞察加载失败" }),
          element("p", { text: message }),
          retry
        ]
      })
    ]
  });
  app.replaceChildren(createShell(period, state));
}

function renderDashboard(usage: UsageSummary): void {
  const content = element("div", {
    children: [
      createOverview(usage),
      element("div", {
        className: "dashboard-grid",
        children: [
          createTrendCard(usage),
          element("aside", {
            className: "dashboard-aside",
            attrs: { "aria-label": "板块统计与洞察" },
            children: [createSectionBreakdown(usage), createInsights(usage)]
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
      element("header", {
        className: "dashboard-topbar",
        children: [
          createBrand(),
          element("a", {
            className: "btn",
            attrs: { href: "options.html", target: "_blank", rel: "noreferrer" },
            children: [icon("settings"), element("span", { text: "专注设置" })]
          })
        ]
      }),
      element("section", {
        className: "dashboard-heading",
        children: [
          element("div", {
            children: [
              element("h1", { className: "page-title", text: "使用洞察" }),
              element("p", {
                className: "page-description",
                text: "看见时间流向，温和地调整下一次选择。统计只保存在当前浏览器。"
              })
            ]
          }),
          createPeriodControl(period)
        ]
      }),
      content
    ]
  });
}

function createBrand(): HTMLElement {
  return element("a", {
    className: "brand",
    attrs: { href: "dashboard.html", "aria-label": "BiliFocus 哔哩专注使用洞察" },
    children: [
      element("span", { className: "brand__mark", children: [icon("focus")] }),
      element("span", {
        className: "brand__meta",
        children: [element("span", { text: "BiliFocus" }), element("small", { text: "使用洞察" })]
      })
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

function createOverview(usage: UsageSummary): HTMLElement {
  const dayCount = Math.max(1, usage.byDay.length);
  const activeDays = usage.byDay.filter((day) => totalForDay(day) > 0).length;
  const topSection = getTopSection(usage);
  const average = usage.totalSeconds / dayCount;
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
        usage.period === "day" ? "今日记录" : "日均使用",
        usage.period === "day"
          ? `${activeDays > 0 ? "已记录" : "未记录"}`
          : formatDuration(average, true),
        usage.period === "day" ? "只计前台且窗口活跃的时间" : `按 ${dayCount} 个自然日计算`
      ),
      createMetricCard(
        "最多使用",
        topSection ? SECTION_LABELS[topSection] : "暂无",
        topSection ? formatDuration(usage.bySection[topSection], true) : "还没有产生使用记录"
      )
    ]
  });
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

function createInsights(usage: UsageSummary): HTMLElement {
  const insights = generateInsights(usage);
  return element("section", {
    className: "insights-card card",
    attrs: { "aria-labelledby": "insights-title" },
    children: [
      element("h2", { text: "温和洞察", attrs: { id: "insights-title" } }),
      element("p", { text: "依据当前范围自动生成，不做价值判断" }),
      element("ul", {
        className: "insight-list",
        children: insights.map((insight) =>
          element("li", {
            className: "insight-item",
            children: [
              element("span", { className: "insight-item__icon", children: [icon(insight.icon)] }),
              element("div", {
                children: [
                  element("strong", { text: insight.title }),
                  element("p", { text: insight.copy })
                ]
              })
            ]
          })
        )
      })
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
      element("p", { text: "BiliFocus 仅保存日期、板块与时长，不记录视频、搜索词或账号信息。" }),
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

interface Insight {
  icon: "clock" | "sparkles" | "calendar";
  title: string;
  copy: string;
}

function generateInsights(usage: UsageSummary): Insight[] {
  if (usage.totalSeconds <= 0) {
    return [
      {
        icon: "sparkles",
        title: "从此刻开始就好",
        copy: "当前范围还没有使用记录。打开 Bilibili 后，活跃时间会自动出现在这里。"
      },
      {
        icon: "clock",
        title: "只计有效使用",
        copy: "后台标签页、失焦窗口和长时间无活动不会计入使用时长。"
      }
    ];
  }

  const topSection = getTopSection(usage);
  const peakDay = [...usage.byDay].sort((a, b) => totalForDay(b) - totalForDay(a))[0];
  const activeDays = usage.byDay.filter((day) => totalForDay(day) > 0).length;
  const insights: Insight[] = [];

  if (topSection) {
    const share = Math.round((usage.bySection[topSection] / usage.totalSeconds) * 100);
    insights.push({
      icon: "sparkles",
      title: `${SECTION_LABELS[topSection]}占比最高`,
      copy: `${PERIOD_LABELS[usage.period]}有 ${share}% 的时间用于${SECTION_LABELS[topSection]}，可优先从这个板块调整规则。`
    });
  }
  if (peakDay) {
    insights.push({
      icon: "clock",
      title: usage.period === "day" ? "今日使用节奏" : `${formatShortDate(peakDay.date)}用时最多`,
      copy: `${formatDuration(totalForDay(peakDay), true)}，约占当前范围总时长的 ${Math.round((totalForDay(peakDay) / usage.totalSeconds) * 100)}%。`
    });
  }
  if (usage.period !== "day") {
    insights.push({
      icon: "calendar",
      title: `${activeDays} 天有使用记录`,
      copy: `当前范围共 ${usage.byDay.length} 天。稳定的小幅调整，通常比一次性完全戒断更容易坚持。`
    });
  }
  return insights;
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
