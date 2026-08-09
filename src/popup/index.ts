import { sendRequest } from "../shared/messages";
import { tabsQuery } from "../shared/browser";
import {
  SECTION_IDS,
  SECTION_LABELS,
  type FocusSettings,
  type PageDecision,
  type SectionId,
  type TrackingStatus,
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

interface PopupData {
  settings: FocusSettings;
  usage: UsageSummary;
  pageDecision: PageDecision | null;
  pageUrl: string | null;
  trackingStatus: TrackingStatus;
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
    const [usage, trackingStatus] = await Promise.all([
      sendRequest({ type: "GET_USAGE", period: "day" }),
      sendRequest({ type: "GET_TRACKING_STATUS" })
    ]);
    renderPopup({ ...currentData, usage, trackingStatus });
  } catch {
    // Keep the last confirmed values. The next refresh can recover without
    // replacing the whole popup with a transient background-wakeup error.
  }
}

function renderLoading(): void {
  const shell = element("div", { className: "popup-shell", attrs: { "aria-busy": "true" } });
  shell.append(
    createHeader(),
    element("div", { className: "today-card card skeleton", text: "正在加载今日使用时间" }),
    element("div", { className: "focus-control card skeleton", text: "正在加载专注状态" }),
    element("div", { className: "plan-control card skeleton", text: "正在加载计划模式" }),
    element("div", { className: "page-policy card skeleton", text: "正在确认当前页面" })
  );
  app.replaceChildren(shell);
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
                element("h2", { text: "专注状态加载失败" }),
                element("p", { text: message }),
                retry
              ]
            })
          ]
        })
      ]
    })
  );
}

function renderPopup(data: PopupData): void {
  currentData = data;
  const shell = element("div", { className: "popup-shell" });
  const totalBlocked = Object.values(data.settings.targets).filter(
    (target) => target.enabled
  ).length;
  const focusActive = data.settings.enabled;
  const focusToggle = createToggle("专注保护", focusActive, "popup-focus-toggle");
  const focusControl = element("section", {
    className: "focus-control card",
    dataset: { active: String(focusActive) },
    attrs: { "aria-label": "专注保护状态" },
    children: [
      element("div", {
        className: "focus-control__title",
        children: [
          element("span", { className: "focus-control__icon", children: [icon("shield")] }),
          element("span", {
            children: [
              element("strong", { text: focusActive ? "专注保护已开启" : "专注保护已暂停" }),
              element("small", {
                text: focusActive ? `已启用 ${totalBlocked} 个板块` : "已关闭"
              })
            ]
          })
        ]
      }),
      focusToggle.label
    ]
  });

  focusToggle.input.addEventListener("change", () => {
    void updateFocusState();
  });

  async function updateFocusState(): Promise<void> {
    const target = focusToggle.input.checked;
    focusToggle.input.disabled = true;
    try {
      const settings = await sendRequest({ type: "UPDATE_SETTINGS", patch: { enabled: target } });
      toast(target ? "专注保护已开启" : "专注保护已暂停");
      renderPopup({ ...data, settings });
    } catch (error) {
      focusToggle.input.checked = !target;
      focusToggle.input.disabled = false;
      toast(describeError(error), "error");
    }
  }

  shell.append(
    createHeader(),
    createTodayCard(data.usage, data.trackingStatus, data.settings),
    focusControl,
    createPlanModeControl(data),
    createPagePolicy(data),
    createActions(),
    element("p", {
      className: "popup-footer",
      text: "数据仅保存在当前浏览器 · Hourleaf"
    })
  );
  app.replaceChildren(shell);
}

function createPlanModeControl(data: PopupData): HTMLElement {
  const active = data.settings.planMode.enabled;
  const planToggle = createToggle("计划模式", active, "popup-plan-mode-toggle");
  planToggle.input.addEventListener("change", () => {
    void updatePlanMode();
  });

  async function updatePlanMode(): Promise<void> {
    const enabled = planToggle.input.checked;
    planToggle.input.disabled = true;
    try {
      const planState = await sendRequest({ type: "SET_PLAN_MODE", enabled });
      toast(enabled ? "计划模式已开启" : "计划模式已关闭");
      renderPopup({
        ...data,
        settings: { ...data.settings, planMode: planState.settings }
      });
    } catch (error) {
      planToggle.input.checked = !enabled;
      planToggle.input.disabled = false;
      toast(describeError(error), "error");
    }
  }

  return element("section", {
    className: "plan-control card",
    dataset: { active: String(active) },
    attrs: { "aria-label": "计划模式快速开关" },
    children: [
      element("div", {
        className: "plan-control__row",
        children: [
          element("div", {
            className: "plan-control__title",
            children: [
              element("span", {
                className: "plan-control__icon",
                children: [icon("calendar")]
              }),
              element("span", {
                children: [
                  element("strong", { text: active ? "计划模式已开启" : "计划模式未开启" }),
                  element("small", {
                    text: active ? "当前生效" : "已关闭"
                  })
                ]
              })
            ]
          }),
          planToggle.label
        ]
      })
    ]
  });
}

function createHeader(): HTMLElement {
  const logo = element("span", { className: "brand__mark", children: [icon("leaf")] });
  const brand = element("div", {
    className: "brand",
    attrs: { "aria-label": "Hourleaf" },
    children: [
      logo,
      element("span", {
        className: "brand__meta",
        children: [element("span", { text: "Hourleaf" }), element("small", { text: "专注每一刻" })]
      })
    ]
  });
  const settingsLink = element("a", {
    className: "btn btn--icon",
    attrs: {
      href: "home.html",
      target: "_blank",
      rel: "noreferrer",
      title: "打开设置",
      "aria-label": "打开设置",
      "data-testid": "popup-open-settings"
    },
    children: [icon("settings")]
  });
  return element("header", { className: "popup-header", children: [brand, settingsLink] });
}

function createTodayCard(
  usage: UsageSummary,
  tracking: TrackingStatus,
  settings: FocusSettings
): HTMLElement {
  const topTarget = Object.entries(usage.byTarget).reduce<{ id: string; seconds: number } | null>(
    (top, [id, seconds]) => {
      if (seconds <= 0) return top;
      return !top || seconds > top.seconds ? { id, seconds } : top;
    },
    null
  );
  const topSection = SECTION_IDS.reduce<SectionId | null>((top, section) => {
    if (usage.bySection[section] <= 0) return top;
    return top === null || usage.bySection[section] > usage.bySection[top] ? section : top;
  }, null);
  const detail = topTarget
    ? `最多用于${settings.targets[topTarget.id]?.label ?? "受管页面"} · ${formatDuration(topTarget.seconds, true)}`
    : topSection
      ? `最多用于${SECTION_LABELS[topSection]} · ${formatDuration(usage.bySection[topSection], true)}`
      : "暂无使用记录";
  const trackingLabel = tracking.targetId
    ? settings.targets[tracking.targetId]?.label
    : tracking.section
      ? SECTION_LABELS[tracking.section]
      : undefined;
  const liveLabel = tracking.isTracking
    ? `正在计时 · ${trackingLabel ?? "受管网站"}`
    : tracking.section === null
      ? "当前页面尚未由模块管理"
      : tracking.idleState === "idle" || tracking.idleState === "locked"
        ? "你已离开，计时自动暂停"
        : "当前未计时";

  return element("section", {
    className: "today-card card",
    attrs: { "aria-labelledby": "today-title" },
    children: [
      element("p", {
        className: "today-card__label",
        text: "今日受管网站使用时间",
        attrs: { id: "today-title" }
      }),
      element("p", {
        className: "today-card__time",
        text: formatDuration(usage.totalSeconds),
        attrs: {
          "data-testid": "popup-today-time",
          "aria-label": formatDuration(usage.totalSeconds, true)
        }
      }),
      element("p", { className: "today-card__meta", children: [icon("bar-chart"), detail] }),
      element("p", {
        className: "today-card__live",
        dataset: { active: String(tracking.isTracking) },
        attrs: { role: "status", "aria-live": "polite" },
        children: [element("span", { className: "today-card__live-dot" }), liveLabel]
      })
    ]
  });
}

function createPagePolicy(data: PopupData): HTMLElement {
  const decision = data.pageDecision;
  const sectionLabel = decision?.targetId
    ? (data.settings.targets[decision.targetId]?.label ?? "当前规则")
    : decision?.section
      ? SECTION_LABELS[decision.section]
      : "当前页面";
  const managed = Boolean(decision?.targetId || decision?.section);
  const status = decision?.blocked ? "blocked" : managed ? "allowed" : "unmanaged";
  const statusTitle = decision?.blocked
    ? `${sectionLabel}已进入专注拦截`
    : managed
      ? `${sectionLabel}当前可访问`
      : "这个页面不受专注规则影响";
  const statusDetail = describeDecision(decision);
  const action =
    decision?.blocked && decision.canRequestTemporaryAccess
      ? element("button", {
          className: "btn btn--soft page-policy__action",
          text: `临时访问 ${data.settings.temporaryAccess.durationMinutes} 分钟`,
          attrs: {
            type: "button",
            "aria-label": `临时访问 ${data.settings.temporaryAccess.durationMinutes} 分钟`,
            "data-testid": "popup-temp-access"
          }
        })
      : null;

  if (action && data.pageUrl) {
    const actionButton = action;
    const pageUrl = data.pageUrl;
    actionButton.addEventListener("click", () => {
      void grantTemporaryAccess();
    });

    async function grantTemporaryAccess(): Promise<void> {
      setButtonBusy(actionButton, true, "正在开启");
      try {
        const pageDecision = await sendRequest({
          type: "GRANT_TEMPORARY_ACCESS",
          url: pageUrl
        });
        toast(`接下来 ${data.settings.temporaryAccess.durationMinutes} 分钟可以访问`);
        renderPopup({ ...data, pageDecision });
      } catch (error) {
        setButtonBusy(actionButton, false);
        toast(describeError(error), "error");
      }
    }
  }

  const children: HTMLElement[] = [
    element("div", {
      className: "page-policy__body",
      children: [
        element("span", {
          className: "page-policy__icon",
          children: [icon(decision?.blocked ? "lock" : decision?.section ? "unlock" : "eye")]
        }),
        element("div", {
          className: "page-policy__copy",
          children: [
            element("strong", { text: statusTitle }),
            element("span", { text: statusDetail })
          ]
        }),
        action
      ]
    })
  ];

  if (decision?.blocked && !decision.canRequestTemporaryAccess) {
    children.push(
      element("p", {
        className: "page-policy__notice",
        text: data.settings.temporaryAccess.enabled
          ? "今天的临时访问次数已用完"
          : "临时访问已在设置中关闭"
      })
    );
  }

  return element("section", {
    className: "page-policy card",
    dataset: { status },
    attrs: { "aria-label": "当前页面" },
    children
  });
}

function createActions(): HTMLElement {
  const dashboardLink = element("a", {
    className: "btn btn--primary popup-actions__home",
    attrs: {
      href: "dashboard.html",
      target: "_blank",
      rel: "noreferrer",
      "data-testid": "popup-open-dashboard"
    },
    children: [icon("bar-chart"), "仪表盘"]
  });
  const planLink = element("a", {
    className: "btn",
    attrs: {
      href: "plan.html",
      target: "_blank",
      rel: "noreferrer",
      "data-testid": "popup-open-plan"
    },
    children: [icon("calendar"), "计划"]
  });
  const configLink = element("a", {
    className: "btn",
    attrs: {
      href: "options.html",
      target: "_blank",
      rel: "noreferrer",
      "data-testid": "popup-open-config"
    },
    children: [icon("settings"), "配置"]
  });
  return element("nav", {
    className: "popup-actions",
    attrs: { "aria-label": "扩展页面" },
    children: [dashboardLink, planLink, configLink]
  });
}

function createToggle(
  labelText: string,
  checked: boolean,
  testId: string
): {
  label: HTMLLabelElement;
  input: HTMLInputElement;
} {
  const input = element("input", {
    attrs: {
      type: "checkbox",
      checked,
      "aria-label": checked ? `暂停${labelText}` : `开启${labelText}`,
      "data-testid": testId
    }
  });
  const label = element("label", {
    className: "switch",
    attrs: { title: checked ? `暂停${labelText}` : `开启${labelText}` },
    children: [input, element("span", { className: "sr-only", text: labelText })]
  });
  return { label, input };
}

function describeDecision(decision: PageDecision | null): string {
  if (!decision) return "未检测到受管网站页面";
  switch (decision.reason) {
    case "not-managed":
      return "当前页面尚未配置规则";
    case "focus-disabled":
      return "专注保护已关闭";
    case "rule-disabled":
      return "未启用此板块";
    case "outside-schedule":
      return "当前时段可用";
    case "daily-limit":
      return "今日限额已用完";
    case "temporary-access": {
      if (!decision.temporaryAccessExpiresAt) return "临时访问已开启";
      const time = new Date(decision.temporaryAccessExpiresAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit"
      });
      return `可以访问到 ${time}`;
    }
    case "blocked":
      return "当前时段不可用";
  }
}
