import { sendRequest } from "../shared/messages";
import { getPrimaryDomain } from "../shared/domain";
import { configureLocale, getResolvedLocale, localizeDocumentTitle, t } from "../shared/i18n";
import {
  SECTION_IDS,
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

function periodLabel(period: UsagePeriod): string {
  return t(
    period === "day" ? "dashboard.today" : period === "week" ? "dashboard.week" : "dashboard.month"
  );
}

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
configureLocale("system");
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
    configureLocale((settings as FocusSettings & { locale?: string }).locale);
    localizeDocumentTitle("dashboard");
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
      attrs: { "aria-busy": "true", "aria-label": t("dashboard.loading") },
      children: [
        element("div", {
          children: [
            element("div", { className: "state-view__icon", children: [icon("bar-chart")] }),
            element("h2", { text: t("dashboard.loadingPeriod", { period: periodLabel(period) }) })
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
    text: t("options.reload"),
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
          element("h2", { text: t("dashboard.loadFailed") }),
          element("p", { text: message }),
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
                  element("h2", {
                    text: t("dashboard.general"),
                    attrs: { id: "general-statistics-title" }
                  }),
                  element("p", { text: t("dashboard.generalDescription") })
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
            children: [element("h1", { className: "page-title", text: t("nav.dashboard") })]
          }),
          createPeriodControl(period)
        ]
      }),
      content
    ]
  });
}

function createPeriodControl(selected: UsagePeriod): HTMLElement {
  const buttons = (["day", "week", "month"] satisfies UsagePeriod[]).map((period) => {
    const button = element("button", {
      className: "segmented__item",
      text: periodLabel(period),
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
    attrs: { role: "group", "aria-label": t("dashboard.rangeLabel") },
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
    attrs: { "aria-label": t("dashboard.periodOverview", { period: periodLabel(usage.period) }) },
    children: [
      createMetricCard(
        t("dashboard.total", { period: periodLabel(usage.period) }),
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
        t("dashboard.topWebsite"),
        topSite?.domain ?? t("dashboard.noRecords"),
        topSite ? formatDuration(topSite.seconds, true) : t("dashboard.noUsage")
      ),
      createMetricCard(
        t("dashboard.pendingTime"),
        planStats ? formatDuration(planStats.pendingSeconds, true) : t("dashboard.noData"),
        planStats
          ? planStats.pending > 0
            ? t("dashboard.pendingEstimate", {
                count: planStats.pending,
                minutes: Math.round(planStats.pendingSeconds / 60)
              })
            : t("dashboard.noPending")
          : t("dashboard.planUnavailable")
      ),
      createMetricCard(
        t("dashboard.completed"),
        planStats ? `${planStats.completed} / ${planStats.total}` : t("dashboard.noData"),
        planStats
          ? planStats.total > 0
            ? t("dashboard.completion", { percent: planStats.completionPercentage })
            : t("dashboard.planEmpty")
          : t("dashboard.planUnavailable")
      )
    ]
  });
}

function liveTrackingLabel(tracking: TrackingStatus): string {
  if (tracking.isTracking) {
    return `${t("popup.tracking")} · ${tracking.section ? t(`section.${tracking.section}`) : t("dashboard.managedWebsite")}`;
  }
  if (tracking.section === null) return t("popup.notTracking");
  if (tracking.idleState === "idle" || tracking.idleState === "locked") return t("dashboard.away");
  return t("popup.notTracking");
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
        "aria-label": t("dashboard.usageAria", {
          label: formatFullDate(day.date),
          duration: formatDuration(total, true)
        })
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
              element("h2", { text: t("dashboard.trend"), attrs: { id: "trend-title" } }),
              element("p", { text: t("dashboard.trendDescription") })
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
          "aria-label": `${periodLabel(usage.period)} ${t("dashboard.trend")}`,
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
            "aria-label": t("dashboard.domainDetailsAria", {
              domain: group.domain,
              duration: formatDuration(group.seconds, true)
            })
          },
          children: [
            element("span", {
              className: "site-group__domain",
              children: [
                element("strong", { text: group.domain }),
                element("span", { text: t("dashboard.sources", { count: group.sites.length }) })
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
              element("h2", {
                text: t("dashboard.websiteTime"),
                attrs: { id: "website-breakdown-title" }
              }),
              element("p", { text: t("dashboard.websiteTimeDescription") })
            ]
          }),
          element("span", {
            className: "badge",
            text: t("dashboard.domains", { count: groups.length })
          })
        ]
      }),
      groupRows.length > 0
        ? element("div", { className: "site-groups", children: groupRows })
        : element("div", {
            className: "site-breakdown__empty",
            children: [
              element("div", { className: "state-view__icon", children: [icon("clock")] }),
              element("p", { text: t("dashboard.noWebsites") })
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
              element("p", {
                className: "module-statistics__eyebrow",
                text: t("dashboard.moduleEnabled")
              }),
              element("h2", {
                text: t("dashboard.moduleStats", { module: moduleName }),
                attrs: { id: `module-statistics-${safeDomId(manifest.id)}` }
              }),
              element("p", { text: t("dashboard.moduleDescription") })
            ]
          }),
          element("div", {
            className: "module-statistics__total",
            children: [
              element("span", { text: t("dashboard.sum") }),
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
        : element("p", {
            className: "module-statistics__empty",
            text: t("dashboard.noModuleStats")
          })
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
          "aria-label": t("dashboard.durationAria", { label }),
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
    children: [icon("shield"), element("p", { text: t("dashboard.footer") })]
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
  completionPercentage: number;
} | null {
  if (!planState) return null;
  const completed = planState.queue.items.filter((item) => item.status === "completed").length;
  const total = planState.queue.items.length;
  const pending = total - completed;
  const pendingItems = planState.queue.items.filter((item) => item.status === "pending");
  const pendingMinutes = pendingItems.reduce(
    (total, item) =>
      total +
      ("scheduledDurationMinutes" in item
        ? item.scheduledDurationMinutes
        : planState.settings.watchDurationMinutes),
    0
  );
  return {
    pending,
    completed,
    total,
    pendingSeconds: pendingMinutes * 60,
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
  const formatter = new Intl.DateTimeFormat(getResolvedLocale(), {
    month: "short",
    day: "numeric"
  });
  return `${formatter.format(parseDate(usage.startDate))} – ${formatter.format(parseDate(usage.endDate))}`;
}

function formatFullDate(value: string): string {
  return new Intl.DateTimeFormat(getResolvedLocale(), {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(parseDate(value));
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat(getResolvedLocale(), { month: "numeric", day: "numeric" }).format(
    parseDate(value)
  );
}

function chartLabel(value: string, period: UsagePeriod, index: number): string {
  const date = parseDate(value);
  if (period === "week") {
    return new Intl.DateTimeFormat(getResolvedLocale(), { weekday: "narrow" }).format(date);
  }
  if (period === "month")
    return index % 5 === 0 || index === date.getDate() - 1 ? String(date.getDate()) : "";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
