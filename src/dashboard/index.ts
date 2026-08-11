import { sendRequest } from "../shared/messages";
import { getPrimaryDomain } from "../shared/domain";
import {
  SECTION_IDS,
  SECTION_LABELS,
  type DailyUsage,
  type FocusSettings,
  type ManagedSite,
  type PlanState,
  type SectionId,
  type SiteModuleInstallation,
  type SiteModuleStore,
  type TrackingStatus,
  type UsagePeriod,
  type UsageSummary
} from "../shared/types";
import { assertAppRoot, describeError, element, formatDuration, icon } from "../styles/dom";
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

interface SiteUsageStat {
  id: string;
  label: string;
  hostname: string;
  origin: string;
  seconds: number;
}

interface DomainUsageGroup {
  domain: string;
  seconds: number;
  sites: SiteUsageStat[];
}

document.body.classList.add("dashboard-page");
void loadDashboard(currentPeriod);
window.setInterval(() => void refreshLiveDashboard(), 5_000);

async function loadDashboard(period: UsagePeriod): Promise<void> {
  currentPeriod = period;
  const sequence = ++loadSequence;
  renderLoading(period);
  try {
    const [usage, tracking, settings, planState, moduleStore] = await Promise.all([
      sendRequest({ type: "GET_USAGE", period }),
      sendRequest({ type: "GET_TRACKING_STATUS" }),
      sendRequest({ type: "GET_SETTINGS" }),
      sendRequest({ type: "GET_PLAN_STATE" }).catch(() => null),
      sendRequest({ type: "GET_SITE_MODULES" }).catch(() => null)
    ]);
    if (sequence !== loadSequence) return;
    currentUsage = usage;
    renderDashboard(usage, tracking, settings, planState, moduleStore);
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

function renderDashboard(
  usage: UsageSummary,
  tracking: TrackingStatus,
  settings: FocusSettings,
  planState: PlanState | null,
  moduleStore: SiteModuleStore | null
): void {
  const siteGroups = buildDomainUsageGroups(usage, settings);
  const enabledModules = Object.values(moduleStore?.installations ?? {}).filter(
    (installation) =>
      installation.enabled && installation.manifest.capabilities.includes("usage-tracking")
  );
  const content = element("div", {
    children: [
      element("section", {
        className: "dashboard-general",
        attrs: { "aria-labelledby": "general-statistics-title" },
        children: [
          element("header", {
            className: "dashboard-section-heading",
            children: [
              element("div", {
                children: [
                  element("h2", { text: "总统计", attrs: { id: "general-statistics-title" } }),
                  element("p", { text: "所有已添加网站的时间与计划概览" })
                ]
              })
            ]
          }),
          createOverview(usage, tracking, siteGroups, planState),
          element("div", {
            className: "dashboard-grid",
            children: [createTrendCard(usage), createWebsiteBreakdown(siteGroups)]
          })
        ]
      }),
      ...enabledModules.map((installation) => createModuleBreakdown(installation, usage, settings)),
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

function createOverview(
  usage: UsageSummary,
  tracking: TrackingStatus,
  siteGroups: readonly DomainUsageGroup[],
  planState: PlanState | null
): HTMLElement {
  const topSite = siteGroups.find((group) => group.seconds > 0);
  const planStats = summarizePlan(planState);
  return element("section", {
    className: "overview-grid",
    attrs: { "aria-label": `${PERIOD_LABELS[usage.period]}概览` },
    children: [
      createMetricCard(
        `${PERIOD_LABELS[usage.period]}总时长`,
        formatDuration(usage.totalSeconds, true),
        element("span", {
          className: "metric-card__note-row",
          children: [
            element("span", { text: formatDateRange(usage) }),
            element("span", {
              className: "metric-card__live",
              text: liveTrackingLabel(tracking),
              attrs: { "data-testid": "dashboard-live-status" }
            })
          ]
        }),
        true,
        "dashboard-total-time"
      ),
      createMetricCard(
        "最多使用的网站",
        topSite?.domain ?? "暂无记录",
        topSite ? formatDuration(topSite.seconds, true) : "当前范围内还没有使用记录"
      ),
      createMetricCard(
        "待办计划用时",
        planStats ? formatDuration(planStats.pendingSeconds, true) : "暂无数据",
        planStats
          ? planStats.pending > 0
            ? `${planStats.pending} 项 × 每项 ${planStats.minutesPerItem} 分钟`
            : "当前没有待办事项"
          : "计划数据暂不可用"
      ),
      createMetricCard(
        "计划完成数",
        planStats ? `${planStats.completed} / ${planStats.total}` : "暂无数据",
        planStats
          ? planStats.total > 0
            ? `当前计划清单完成率 ${planStats.completionPercentage}%`
            : "当前计划清单为空"
          : "计划数据暂不可用"
      )
    ]
  });
}

function liveTrackingLabel(tracking: TrackingStatus): string {
  if (tracking.isTracking) {
    return `正在计时 · ${tracking.section ? SECTION_LABELS[tracking.section] : "受管网站"}`;
  }
  if (tracking.section === null) return "当前未计时";
  if (tracking.idleState === "idle" || tracking.idleState === "locked") return "离开设备，已暂停";
  return "当前未计时";
}

function createMetricCard(
  label: string,
  value: string,
  note: string | Node,
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
      element("p", {
        className: "metric-card__note",
        ...(typeof note === "string" ? { text: note } : { children: [note] })
      })
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
              element("p", { text: "只统计已添加网站处于前台且浏览器窗口活跃的时间" })
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

function createWebsiteBreakdown(groups: readonly DomainUsageGroup[]): HTMLElement {
  const groupRows = groups.map((group) => {
    const siteRows = group.sites.map((site) =>
      element("div", {
        className: "site-group__site",
        dataset: { siteId: site.id },
        children: [
          element("div", {
            className: "site-group__identity",
            children: [
              element("strong", { text: site.label || site.hostname }),
              element("span", { text: site.origin })
            ]
          }),
          element("span", {
            className: "site-group__time",
            text: formatDuration(site.seconds, true)
          })
        ]
      })
    );
    return element("details", {
      className: "site-group",
      dataset: { domain: group.domain },
      children: [
        element("summary", {
          className: "site-group__summary",
          attrs: {
            "aria-label": `${group.domain}，${formatDuration(group.seconds, true)}，查看各来源统计`
          },
          children: [
            element("span", {
              className: "site-group__domain",
              children: [
                element("strong", { text: group.domain }),
                element("span", { text: `${group.sites.length} 个来源` })
              ]
            }),
            element("span", {
              className: "site-group__summary-value",
              children: [formatDuration(group.seconds, true), icon("chevron")]
            })
          ]
        }),
        element("div", { className: "site-group__sites", children: siteRows })
      ]
    });
  });

  return element("section", {
    className: "site-breakdown card",
    attrs: {
      "aria-labelledby": "website-breakdown-title",
      "data-testid": "dashboard-section-list"
    },
    children: [
      element("header", {
        className: "site-breakdown__header",
        children: [
          element("div", {
            children: [
              element("h2", { text: "网站使用时间", attrs: { id: "website-breakdown-title" } }),
              element("p", { text: "同一主域名已合并，展开可查看各来源" })
            ]
          }),
          element("span", { className: "badge", text: `${groups.length} 个主域名` })
        ]
      }),
      groupRows.length > 0
        ? element("div", { className: "site-groups", children: groupRows })
        : element("div", {
            className: "site-breakdown__empty",
            children: [
              element("div", { className: "state-view__icon", children: [icon("clock")] }),
              element("p", { text: "暂无已添加网站" })
            ]
          })
    ]
  });
}

function createModuleBreakdown(
  installation: SiteModuleInstallation,
  usage: UsageSummary,
  settings: FocusSettings
): HTMLElement {
  const manifest = installation.manifest;
  const rows = manifest.sections.map((section, index) => {
    const matchingTargets = Object.values(settings.targets).filter(
      (target) => target.moduleId === manifest.id && target.moduleSectionId === section.id
    );
    const targetSeconds = matchingTargets.reduce(
      (total, target) => total + (usage.byTarget[target.id] ?? 0),
      0
    );
    const seconds = targetSeconds;
    return {
      id: section.id,
      label: section.label,
      seconds,
      color:
        SECTION_COLORS[section.id as SectionId] ??
        Object.values(SECTION_COLORS)[index % SECTION_IDS.length] ??
        "#63738f"
    };
  });
  const maximum = Math.max(1, ...rows.map((row) => row.seconds));
  const total = rows.reduce((sum, row) => sum + row.seconds, 0);
  const moduleName = manifest.name;

  return element("section", {
    className: "module-statistics card",
    attrs: { "aria-labelledby": `module-statistics-${safeDomId(manifest.id)}` },
    children: [
      element("header", {
        className: "module-statistics__header",
        children: [
          element("div", {
            children: [
              element("p", { className: "module-statistics__eyebrow", text: "已启用站点模块" }),
              element("h2", {
                text: `${moduleName}统计`,
                attrs: { id: `module-statistics-${safeDomId(manifest.id)}` }
              }),
              element("p", { text: "按模块支持的板块统计使用时间" })
            ]
          }),
          element("div", {
            className: "module-statistics__total",
            children: [
              element("span", { text: "合计" }),
              element("strong", { text: formatDuration(total, true) })
            ]
          })
        ]
      }),
      rows.length > 0
        ? element("div", {
            className: "module-statistics__rows",
            children: rows
              .sort((left, right) => right.seconds - left.seconds)
              .map((row) => createUsageBar(row.label, row.seconds, maximum, row.color))
          })
        : element("p", { className: "module-statistics__empty", text: "此模块暂无分类统计" })
    ]
  });
}

function createUsageBar(label: string, value: number, maximum: number, color: string): HTMLElement {
  const percentage = Math.max(0, Math.min(100, (value / maximum) * 100));
  return element("div", {
    className: "section-total",
    attrs: { style: `--section-color: ${color}` },
    children: [
      element("div", {
        className: "section-total__header",
        children: [
          element("span", {
            className: "section-total__name",
            children: [element("span", { className: "section-total__dot" }), label]
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
          "aria-label": `${label}使用时长`,
          "aria-valuemin": "0",
          "aria-valuemax": maximum,
          "aria-valuenow": value,
          "aria-valuetext": formatDuration(value, true)
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
}

function createFooter(): HTMLElement {
  return element("footer", {
    className: "dashboard-footer",
    children: [icon("shield"), element("p", { text: "统计仅包含已添加网站、模块分类与聚合时长。" })]
  });
}

function buildDomainUsageGroups(usage: UsageSummary, settings: FocusSettings): DomainUsageGroup[] {
  const groups = new Map<string, DomainUsageGroup>();
  for (const site of Object.values(settings.sites)) {
    const stat = createSiteUsageStat(site, usage);
    const domain = getPrimaryDomain(site.hostname);
    const existing = groups.get(domain);
    if (existing) {
      existing.seconds += stat.seconds;
      existing.sites.push(stat);
    } else {
      groups.set(domain, { domain, seconds: stat.seconds, sites: [stat] });
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      sites: group.sites.sort(
        (left, right) => right.seconds - left.seconds || left.hostname.localeCompare(right.hostname)
      )
    }))
    .sort((left, right) => right.seconds - left.seconds || left.domain.localeCompare(right.domain));
}

function createSiteUsageStat(site: ManagedSite, usage: UsageSummary): SiteUsageStat {
  const seconds = site.targetIds.reduce(
    (total, targetId) => total + (usage.byTarget[targetId] ?? 0),
    0
  );
  return {
    id: site.id,
    label: site.label,
    hostname: site.hostname,
    origin: site.origin,
    seconds
  };
}

function summarizePlan(planState: PlanState | null): {
  pending: number;
  completed: number;
  total: number;
  pendingSeconds: number;
  minutesPerItem: number;
  completionPercentage: number;
} | null {
  if (!planState) return null;
  const completed = planState.queue.items.filter((item) => item.status === "completed").length;
  const total = planState.queue.items.length;
  const pending = total - completed;
  const minutesPerItem = planState.settings.watchDurationMinutes;
  return {
    pending,
    completed,
    total,
    pendingSeconds: pending * minutesPerItem * 60,
    minutesPerItem,
    completionPercentage: total > 0 ? Math.round((completed / total) * 100) : 0
  };
}

function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function totalForDay(day: DailyUsage): number {
  const targetTotal = Object.values(day.byTarget).reduce((total, seconds) => total + seconds, 0);
  return targetTotal > 0
    ? targetTotal
    : SECTION_IDS.reduce((total, section) => total + day.bySection[section], 0);
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
