import { sendRequest } from "../shared/messages";
import { MAX_TIME_ACCESS_RULES } from "../shared/config";
import { createPresetRules, TIME_ACCESS_PRESETS, type TimeAccessPreset } from "../shared/schedule";
import {
  type FocusSettings,
  type ManagedSite,
  type SiteTargetSettings,
  type TimeAccessEffect,
  type TimeAccessRule,
  type Weekday
} from "../shared/types";
import {
  assertAppRoot,
  describeError,
  element,
  formatClockTime,
  icon,
  setButtonBusy,
  toast
} from "../styles/dom";
import { createPageNavigation } from "../ui/page-navigation";
import {
  addManagedSite,
  normalizeWebsiteInput,
  removeManagedSite,
  requestWebsitePermission,
  updateManagedSite
} from "../ui/site-management";

const WEEKDAYS: ReadonlyArray<{ value: Weekday; short: string; label: string }> = [
  { value: 1, short: "一", label: "星期一" },
  { value: 2, short: "二", label: "星期二" },
  { value: 3, short: "三", label: "星期三" },
  { value: 4, short: "四", label: "星期四" },
  { value: 5, short: "五", label: "星期五" },
  { value: 6, short: "六", label: "星期六" },
  { value: 0, short: "日", label: "星期日" }
];

const app = assertAppRoot();
let draft: FocusSettings | null = null;
let savedSnapshot = "";
let topSaveButton: HTMLButtonElement | null = null;
let savebarButton: HTMLButtonElement | null = null;
let saveState: HTMLElement | null = null;
let savebar: HTMLElement | null = null;
let selectedSiteId: string | null = null;

type RuleOwner = { kind: "target"; id: string; label: string };

window.addEventListener("beforeunload", (event) => {
  if (!isDirty()) return;
  event.preventDefault();
});

void loadOptions();

async function loadOptions(preferredOrigin?: string): Promise<void> {
  renderLoading();
  try {
    draft = cloneSettings(await sendRequest({ type: "GET_SETTINGS" }));
    selectedSiteId =
      (preferredOrigin
        ? Object.values(draft.sites).find((site) => site.origin === preferredOrigin)?.id
        : selectedSiteId && draft.sites[selectedSiteId]
          ? selectedSiteId
          : null) ?? selectInitialSite(draft);
    savedSnapshot = snapshot(draft);
    renderOptions();
  } catch (error) {
    renderError(describeError(error));
  }
}

function renderLoading(): void {
  app.replaceChildren(
    element("section", {
      className: "state-view",
      attrs: { "aria-busy": "true", "aria-label": "正在加载配置" },
      children: [
        element("div", {
          children: [
            element("div", { className: "state-view__icon", children: [icon("settings")] }),
            element("h2", { text: "正在加载配置" })
          ]
        })
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
  retry.addEventListener("click", () => void loadOptions());
  app.replaceChildren(
    element("section", {
      className: "state-view",
      attrs: { role: "alert" },
      children: [
        element("div", {
          children: [
            element("div", { className: "state-view__icon", children: [icon("warning")] }),
            element("h2", { text: "配置加载失败" }),
            element("p", { text: message }),
            retry
          ]
        })
      ]
    })
  );
}

function renderOptions(): void {
  if (!draft) return;
  document.body.classList.add("options-page");
  const shell = element("div", { className: "options-shell" });
  const topbar = createTopbar();
  const content = element("div", {
    className: "app-shell",
    children: [topbar, createPageHeader(), createSettingsContent()]
  });
  savebar = createSavebar();
  shell.append(content, savebar);
  app.replaceChildren(shell);
  updateDirtyState();
}

function createTopbar(): HTMLElement {
  topSaveButton = element("button", {
    className: "btn btn--primary",
    attrs: { type: "button", "data-testid": "settings-save" },
    children: [icon("check"), element("span", { text: "保存设置" })]
  });
  topSaveButton.addEventListener(
    "click",
    () => void saveSettings(topSaveButton as HTMLButtonElement)
  );
  saveState = element("span", {
    className: "save-state",
    text: "已保存",
    dataset: { dirty: "false" }
  });

  return createPageNavigation({ currentPage: "options", actions: [saveState, topSaveButton] });
}

function createPageHeader(): HTMLElement {
  return element("header", {
    className: "options-header",
    children: [
      element("div", {
        children: [
          element("h1", { className: "page-title", text: "配置" }),
          element("p", { text: "为每个网站分别设置每日限额、可用时段和临时访问。" })
        ]
      }),
      createAddSiteButton()
    ]
  });
}

function createSettingsContent(): HTMLElement {
  if (!draft) return element("div");
  const sites = sortedSites(draft);
  const site = getSelectedSite();
  if (!site) {
    return element("div", {
      className: "settings-content",
      children: [
        element("section", {
          className: "card options-empty-site",
          children: [
            icon("plus"),
            element("h2", { text: "还没有可配置的网站" }),
            element("p", { text: "使用页面右上角的“添加网站”设置每日限额和使用时段。" })
          ]
        })
      ]
    });
  }
  return element("div", {
    className: "settings-content options-workspace",
    children: [
      createSiteDirectory(sites),
      element("div", {
        className: "options-site-editor",
        children: [createSiteContextArea(site), createGenericTargetsArea(site)]
      })
    ]
  });
}

function createAddSiteButton(): HTMLButtonElement {
  const button = element("button", {
    className: "btn btn--primary",
    attrs: { type: "button", "data-testid": "site-add-button" },
    children: [icon("plus"), "添加网站"]
  });
  button.addEventListener("click", openAddSiteDialog);
  return button;
}

function createSiteDirectory(sites: ManagedSite[]): HTMLElement {
  return element("aside", {
    className: "options-site-directory card",
    attrs: { "aria-label": "网站时间配置" },
    children: [
      element("header", {
        children: [
          element("h2", { text: "网站" }),
          element("span", { className: "status-chip", text: `${sites.length} 个` })
        ]
      }),
      element("div", {
        className: "options-site-directory__list",
        children: sites.map((site) => {
          const selected = site.id === selectedSiteId;
          const button = element("button", {
            className: "options-site-directory__item",
            attrs: {
              type: "button",
              "aria-current": selected ? "page" : undefined
            },
            dataset: { selected: String(selected) },
            children: [
              element("span", {
                className: "options-site-directory__mark",
                text: (site.label || site.hostname).slice(0, 1).toUpperCase()
              }),
              element("span", {
                className: "options-site-directory__copy",
                children: [
                  element("strong", { text: site.label || site.hostname }),
                  element("small", { text: site.hostname })
                ]
              }),
              element("span", {
                className: `options-site-directory__state${site.enabled ? " is-enabled" : ""}`,
                text: site.enabled ? "启用" : "暂停"
              })
            ]
          });
          button.addEventListener("click", () => {
            selectedSiteId = site.id;
            renderOptions();
          });
          return button;
        })
      })
    ]
  });
}

function createSiteContextArea(site: ManagedSite): HTMLElement {
  const targets = targetsForSite(site);
  const moduleIds = [
    ...new Set(targets.map((target) => target.moduleId).filter(Boolean))
  ] as string[];
  const enabledToggle = createToggle(
    `${site.label || site.hostname}时间规则`,
    site.enabled,
    `site-enabled-${site.id}`
  );
  enabledToggle.input.addEventListener("change", () => {
    if (!draft) return;
    const current = draft.sites[site.id];
    if (!current) return;
    current.enabled = enabledToggle.input.checked;
    current.updatedAt = Date.now();
    renderOptionsPreservingScroll();
    updateDirtyState();
  });
  const removeButton = element("button", {
    className: "btn btn--danger",
    text: "删除网站",
    attrs: { type: "button", "aria-label": `删除${site.label || site.hostname}` }
  });
  removeButton.addEventListener("click", () => openRemoveSiteDialog(site));

  return element("section", {
    className: "site-context card",
    attrs: { "aria-label": "当前网站配置范围" },
    children: [
      element("div", {
        children: [
          element("span", { className: "site-context__eyebrow", text: "当前网站" }),
          element("h2", { text: site.label || site.hostname }),
          element("p", { text: site.origin })
        ]
      }),
      element("div", {
        className: "site-context__meta",
        children: [
          element("span", {
            className: "status-chip",
            text: moduleIds.length > 0 ? moduleIds.join(" · ") : "通用网站规则"
          }),
          element("label", {
            className: "site-context__toggle",
            children: [element("span", { text: "应用时间规则" }), enabledToggle.label]
          }),
          removeButton
        ]
      })
    ]
  });
}

function createGenericTargetsArea(site: ManagedSite): HTMLElement {
  const targets = targetsForSite(site);
  return element("section", {
    attrs: { "aria-labelledby": "generic-targets-title" },
    children: [
      createSectionHeading(
        "generic-targets-title",
        "时间配置",
        targets.length > 1 ? "每个站内子项使用独立限额和时段。" : "设置整站限额和时段。"
      ),
      element("div", {
        className: "generic-target-list",
        children:
          targets.length > 0
            ? targets.map(createGenericTargetCard)
            : [
                element("div", {
                  className: "card generic-target-empty",
                  text: "此网站还没有可配置规则"
                })
              ]
      })
    ]
  });
}

function createGenericTargetCard(target: SiteTargetSettings): HTMLElement {
  const owner = targetRuleOwner(target);
  const accessPolicy = element("select", {
    className: "input",
    attrs: { "aria-label": `${target.label}域名访问策略` },
    children: [
      element("option", { text: "按时间规则", attrs: { value: "timed" } }),
      element("option", { text: "白名单：始终允许", attrs: { value: "always-allow" } }),
      element("option", { text: "黑名单：始终阻止", attrs: { value: "always-block" } })
    ]
  });
  accessPolicy.value = target.accessPolicy ?? "timed";
  accessPolicy.addEventListener("change", () => {
    const current = draft?.targets[target.id];
    if (!current) return;
    current.accessPolicy = accessPolicy.value as NonNullable<SiteTargetSettings["accessPolicy"]>;
    renderOptionsPreservingScroll();
    updateDirtyState();
  });
  const usesTimedRules = (target.accessPolicy ?? "timed") === "timed";
  const toggle = createToggle(
    `${target.label}规则`,
    target.enabled,
    target.moduleSectionId
      ? `section-toggle-${target.moduleSectionId}`
      : `target-toggle-${target.id}`
  );
  toggle.input.addEventListener("change", () => {
    if (!draft) return;
    const current = draft.targets[target.id];
    if (!current) return;
    current.enabled = toggle.input.checked;
    updateDirtyState();
  });
  const limit = element("input", {
    className: "input",
    attrs: {
      type: "number",
      min: 1,
      max: 1440,
      step: 5,
      value: target.dailyLimitMinutes ?? "",
      placeholder: "不限额",
      "aria-label": `${target.label}每日限额（分钟）`
    }
  });
  limit.addEventListener("input", () => {
    if (!draft) return;
    const current = draft.targets[target.id];
    if (!current) return;
    current.dailyLimitMinutes = limit.value
      ? Math.min(1440, Math.max(1, Math.round(Number(limit.value))))
      : null;
    updateDirtyState();
  });
  limit.disabled = !usesTimedRules;
  const scheduleItems = target.schedules.length
    ? target.schedules.map((rule) => createScheduleItem(owner, rule))
    : [element("li", { className: "schedule-empty", text: "未设置时间规则" })];
  const addRule = element("button", {
    className: "btn",
    attrs: {
      type: "button",
      "aria-label": `为${target.label}添加时间规则`,
      "data-testid": target.moduleSectionId
        ? target.moduleSectionId === "home"
          ? "schedule-add"
          : `schedule-add-${target.moduleSectionId}`
        : `schedule-add-${target.id}`
    },
    children: [icon("plus"), "自定义"]
  });
  addRule.addEventListener("click", () => openScheduleDialog(owner));
  addRule.disabled = !usesTimedRules;
  const addPreset = element("button", {
    className: "btn",
    attrs: { type: "button", "aria-label": `为${target.label}添加常用时段` },
    children: [icon("clock"), "常用时段"]
  });
  addPreset.addEventListener("click", () => openPresetDialog(owner));
  addPreset.disabled = !usesTimedRules;
  const accessToggle = createToggle(
    `${target.label}临时访问`,
    target.temporaryAccess.enabled,
    `temporary-access-${target.id}`
  );
  const accessDuration = element("input", {
    className: "input",
    attrs: {
      type: "number",
      min: 1,
      max: 60,
      value: target.temporaryAccess.durationMinutes,
      "aria-label": `${target.label}每次临时访问分钟数`
    }
  });
  const accessUses = element("input", {
    className: "input",
    attrs: {
      type: "number",
      min: 0,
      max: 50,
      value: target.temporaryAccess.maxUsesPerDay,
      "aria-label": `${target.label}每日临时访问次数`
    }
  });
  accessToggle.input.disabled = !usesTimedRules;
  accessDuration.disabled = !usesTimedRules;
  accessUses.disabled = !usesTimedRules;
  accessToggle.input.addEventListener("change", () => {
    const current = draft?.targets[target.id];
    if (!current) return;
    current.temporaryAccess.enabled = accessToggle.input.checked;
    updateDirtyState();
  });
  accessDuration.addEventListener("input", () => {
    const current = draft?.targets[target.id];
    if (!current) return;
    current.temporaryAccess.durationMinutes = clampNumber(accessDuration.value, 1, 60, 5);
    updateDirtyState();
  });
  accessUses.addEventListener("input", () => {
    const current = draft?.targets[target.id];
    if (!current) return;
    current.temporaryAccess.maxUsesPerDay = clampNumber(accessUses.value, 0, 50, 3);
    updateDirtyState();
  });
  return element("article", {
    className: "card generic-target-card",
    children: [
      element("header", {
        children: [
          element("div", {
            children: [
              element("h3", { text: target.label }),
              element("p", { text: target.moduleSectionId ? "站内子项" : "整站时间配置" })
            ]
          }),
          toggle.label
        ]
      }),
      element("label", {
        className: "generic-target-card__policy",
        children: [
          element("span", { text: "域名名单" }),
          accessPolicy,
          element("small", {
            text: usesTimedRules
              ? "按下方额度和时段决定"
              : target.accessPolicy === "always-block"
                ? "无临时访问，始终阻止"
                : "绕过额度和时段，始终允许"
          })
        ]
      }),
      element("div", {
        className: "generic-target-card__limit",
        children: [element("span", { text: "每日限额" }), limit, element("span", { text: "分钟" })]
      }),
      element("div", {
        className: "schedule-heading",
        children: [
          element("h4", { text: "时间规则" }),
          element("div", { className: "schedule-heading__actions", children: [addPreset, addRule] })
        ]
      }),
      element("ul", { className: "schedule-list", children: scheduleItems }),
      element("div", {
        className: "generic-target-card__temporary",
        children: [
          createSettingInline("临时访问", accessToggle.label),
          createSettingInline("每次分钟", accessDuration),
          createSettingInline("每日次数", accessUses)
        ]
      })
    ]
  });
}

function createSettingInline(label: string, control: HTMLElement): HTMLElement {
  return element("label", {
    className: "generic-target-card__temporary-field",
    children: [element("span", { text: label }), control]
  });
}

function clampNumber(value: string, min: number, max: number, fallback: number): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function selectInitialSite(settings: FocusSettings): string | null {
  return sortedSites(settings)[0]?.id ?? null;
}

function sortedSites(settings: FocusSettings): ManagedSite[] {
  return Object.values(settings.sites).sort(
    (left, right) =>
      Number(right.enabled) - Number(left.enabled) ||
      (left.label || left.hostname).localeCompare(right.label || right.hostname)
  );
}

function getSelectedSite(): ManagedSite | null {
  if (!draft || !selectedSiteId) return null;
  return draft.sites[selectedSiteId] ?? null;
}

function targetsForSite(site: ManagedSite): SiteTargetSettings[] {
  if (!draft) return [];
  return site.targetIds
    .map((id) => draft?.targets[id])
    .filter((target): target is SiteTargetSettings => Boolean(target));
}

function targetRuleOwner(target: SiteTargetSettings): RuleOwner {
  return { kind: "target", id: target.id, label: target.label };
}

function scheduleRulesFor(owner: RuleOwner): TimeAccessRule[] {
  return draft?.targets[owner.id]?.schedules ?? [];
}

function replaceScheduleRules(owner: RuleOwner, rules: TimeAccessRule[]): void {
  const target = draft?.targets[owner.id];
  if (target) target.schedules = rules;
}

function openAddSiteDialog(): void {
  if (isDirty()) {
    toast("请先保存当前网站的更改", "error");
    return;
  }
  const titleId = "add-site-dialog-title";
  const input = element("input", {
    className: "input",
    attrs: {
      type: "text",
      inputmode: "url",
      autocomplete: "url",
      placeholder: "example.com",
      required: true,
      "aria-label": "网站域名或网址",
      "data-testid": "site-add-input"
    }
  });
  const note = element("p", {
    className: "schedule-note",
    text: "只会申请此网站的精确访问权限。",
    attrs: { "aria-live": "polite" }
  });
  const cancelButton = element("button", {
    className: "btn",
    text: "取消",
    attrs: { type: "button" }
  });
  const submitButton = element("button", {
    className: "btn btn--primary",
    text: "添加网站",
    attrs: { type: "submit" }
  });
  const dialog = element("dialog", {
    className: "dialog options-site-dialog",
    attrs: { "aria-labelledby": titleId },
    children: [
      element("form", {
        attrs: { method: "dialog" },
        children: [
          element("header", {
            className: "dialog__header",
            children: [element("h2", { text: "添加网站", attrs: { id: titleId } })]
          }),
          element("label", {
            className: "field",
            children: [element("span", { text: "域名或网址" }), input]
          }),
          note,
          element("footer", {
            className: "dialog__footer",
            children: [cancelButton, submitButton]
          })
        ]
      })
    ]
  });
  const form = dialog.querySelector("form");
  cancelButton.addEventListener("click", () => dialog.close());
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      try {
        const website = normalizeWebsiteInput(input.value);
        setButtonBusy(submitButton, true, "请求权限");
        const granted = await requestWebsitePermission(website.permissionPattern);
        if (!granted) {
          note.textContent = "未获得网站权限";
          return;
        }
        setButtonBusy(submitButton, true, "正在添加");
        await addManagedSite(website.origin);
        dialog.close();
        toast("网站已添加");
        await loadOptions(website.origin);
      } catch (error) {
        note.textContent = error instanceof Error ? error.message : describeError(error);
      } finally {
        setButtonBusy(submitButton, false);
      }
    })();
  });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
}

function openRemoveSiteDialog(site: ManagedSite): void {
  if (isDirty()) {
    toast("请先保存当前网站的更改", "error");
    return;
  }
  const cancelButton = element("button", {
    className: "btn",
    text: "取消",
    attrs: { type: "button" }
  });
  const confirmButton = element("button", {
    className: "btn btn--danger",
    text: "删除",
    attrs: { type: "button" }
  });
  const dialog = element("dialog", {
    className: "dialog options-site-dialog",
    attrs: { "aria-labelledby": "remove-site-dialog-title" },
    children: [
      element("h2", {
        text: `删除 ${site.label || site.hostname}？`,
        attrs: { id: "remove-site-dialog-title" }
      }),
      element("p", { text: "该网站的时间配置会被删除，并撤销对应的网站权限。" }),
      element("div", {
        className: "dialog__actions",
        children: [cancelButton, confirmButton]
      })
    ]
  });
  cancelButton.addEventListener("click", () => dialog.close());
  confirmButton.addEventListener("click", () => {
    void (async () => {
      setButtonBusy(confirmButton, true, "正在删除");
      try {
        await removeManagedSite(site.id);
        selectedSiteId = null;
        dialog.close();
        toast("网站已删除");
        await loadOptions();
      } catch (error) {
        setButtonBusy(confirmButton, false);
        toast(describeError(error), "error");
      }
    })();
  });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

function createScheduleItem(owner: RuleOwner, schedule: TimeAccessRule): HTMLLIElement {
  const editButton = element("button", {
    className: "btn btn--icon",
    attrs: { type: "button", title: "编辑时段", "aria-label": `编辑${schedule.name}` },
    children: [icon("edit")]
  });
  editButton.addEventListener("click", () => openScheduleDialog(owner, schedule));
  const deleteButton = element("button", {
    className: "btn btn--icon btn--danger",
    attrs: { type: "button", title: "删除时段", "aria-label": `删除${schedule.name}` },
    children: [icon("trash")]
  });
  deleteButton.addEventListener("click", () => {
    if (!draft) return;
    replaceScheduleRules(
      owner,
      scheduleRulesFor(owner).filter((candidate) => candidate.id !== schedule.id)
    );
    renderOptionsPreservingScroll();
    toast(`已从草稿删除“${schedule.name}”`);
  });

  return element("li", {
    className: "schedule-item",
    dataset: { enabled: String(schedule.enabled), effect: schedule.effect },
    children: [
      element("div", {
        className: "schedule-item__main",
        children: [
          element("span", { className: "schedule-item__status", attrs: { "aria-hidden": "true" } }),
          element("span", {
            className: "schedule-item__copy",
            children: [
              element("strong", {
                text: `${schedule.name}${schedule.enabled ? "" : "（已暂停）"}`
              }),
              element("span", {
                text: `${formatDays(schedule.days)} · ${formatClockTime(schedule.startTime)}–${formatClockTime(schedule.endTime)}${crossesMidnight(schedule) ? "（次日）" : ""}`
              })
            ]
          }),
          element("span", {
            className: "schedule-item__effect",
            text: schedule.effect === "allow" ? "可用" : "不可用"
          })
        ]
      }),
      element("div", { className: "schedule-item__actions", children: [editButton, deleteButton] })
    ]
  });
}

function createSectionHeading(id: string, title: string, description: string): HTMLElement {
  return element("header", {
    className: "section-heading",
    children: [
      element("div", {
        children: [
          element("h2", { text: title, attrs: { id } }),
          element("p", { text: description })
        ]
      })
    ]
  });
}

function createSavebar(): HTMLElement {
  savebarButton = element("button", {
    className: "btn btn--primary",
    text: "保存全部更改",
    attrs: { type: "button" }
  });
  savebarButton.addEventListener(
    "click",
    () => void saveSettings(savebarButton as HTMLButtonElement)
  );
  return element("div", {
    className: "options-savebar",
    dataset: { visible: "false" },
    children: [
      element("div", {
        className: "options-savebar__inner",
        children: [
          element("div", {
            className: "options-savebar__copy",
            children: [element("strong", { text: "未保存" })]
          }),
          savebarButton
        ]
      })
    ]
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
    attrs: { type: "checkbox", checked, "aria-label": labelText, "data-testid": testId }
  });
  return {
    input,
    label: element("label", {
      className: "switch",
      attrs: { title: labelText },
      children: [input, element("span", { className: "sr-only", text: labelText })]
    })
  };
}

function openScheduleDialog(owner: RuleOwner, existing?: TimeAccessRule): void {
  if (!draft) return;
  const schedule: TimeAccessRule = existing
    ? { ...existing, days: [...existing.days] }
    : {
        id: createId(),
        name: "时间规则",
        enabled: true,
        effect: "block",
        days: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "18:00"
      };

  const titleId = `schedule-dialog-${schedule.id}`;
  const nameInput = element("input", {
    className: "input",
    attrs: {
      type: "text",
      maxlength: "60",
      value: schedule.name,
      required: true,
      "aria-label": "规则名称"
    }
  });
  const enabledToggle = createToggle("启用这条规则", schedule.enabled, "schedule-enabled");
  const effectInputs = (
    [
      { value: "allow", label: "始终可用（白名单）" },
      { value: "block", label: "始终不可用（黑名单）" }
    ] satisfies ReadonlyArray<{ value: TimeAccessEffect; label: string }>
  ).map((option) => {
    const input = element("input", {
      attrs: {
        type: "radio",
        name: `effect-${schedule.id}`,
        value: option.value,
        checked: schedule.effect === option.value
      }
    });
    return { ...option, input };
  });
  const startInput = element("input", {
    className: "input",
    attrs: { type: "time", value: schedule.startTime, required: true, "aria-label": "开始时间" }
  });
  const endInput = element("input", {
    className: "input",
    attrs: { type: "time", value: schedule.endTime, required: true, "aria-label": "结束时间" }
  });
  const note = element("p", { className: "schedule-note", attrs: { "aria-live": "polite" } });
  const dayInputs = WEEKDAYS.map((day) => {
    const input = element("input", {
      attrs: {
        type: "checkbox",
        value: day.value,
        checked: schedule.days.includes(day.value),
        "aria-label": day.label
      }
    });
    return { input, day };
  });

  const backdrop = element("div", { className: "dialog-backdrop" });
  const closeButton = element("button", {
    className: "btn btn--icon",
    attrs: { type: "button", title: "关闭", "aria-label": "关闭时段编辑" },
    children: [icon("close")]
  });
  const cancelButton = element("button", {
    className: "btn",
    text: "取消",
    attrs: { type: "button" }
  });
  const saveButton = element("button", {
    className: "btn btn--primary",
    text: existing ? "保存" : "添加",
    attrs: { type: "submit", "data-testid": "schedule-save" }
  });
  const form = element("form", {
    className: "dialog",
    attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    children: [
      element("header", {
        className: "dialog__header",
        children: [
          element("div", {
            children: [
              element("h2", {
                text: existing ? "编辑时间规则" : `为${owner.label}添加时间规则`,
                attrs: { id: titleId }
              })
            ]
          }),
          closeButton
        ]
      }),
      element("div", {
        className: "stack",
        children: [
          element("label", {
            className: "field",
            children: [element("span", { text: "名称" }), nameInput]
          }),
          element("fieldset", {
            className: "field",
            children: [
              element("legend", { text: "这段时间" }),
              element("div", {
                className: "rule-effect-picker",
                children: effectInputs.map((option) =>
                  element("label", { children: [option.input, option.label] })
                )
              })
            ]
          }),
          element("div", {
            className: "access-toggle-row",
            children: [
              element("div", {
                children: [
                  element("strong", { text: "启用规则" }),
                  element("p", { text: "关闭后仍保留设置" })
                ]
              }),
              enabledToggle.label
            ]
          }),
          element("fieldset", {
            className: "field schedule-weekdays",
            children: [
              element("legend", { text: "星期" }),
              element("div", {
                className: "day-picker",
                children: dayInputs.map(({ input, day }) =>
                  element("label", { attrs: { title: day.label }, children: [input, day.short] })
                )
              })
            ]
          }),
          element("div", {
            className: "time-fields",
            children: [
              element("label", {
                className: "field",
                children: [element("span", { text: "开始" }), startInput]
              }),
              element("span", { className: "time-fields__dash", text: "至" }),
              element("label", {
                className: "field",
                children: [element("span", { text: "结束" }), endInput]
              })
            ]
          }),
          note
        ]
      }),
      element("footer", { className: "dialog__footer", children: [cancelButton, saveButton] })
    ]
  });

  function close(): void {
    document.removeEventListener("keydown", onKeydown);
    backdrop.remove();
  }
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }
  function updateNote(): void {
    note.textContent =
      startInput.value === endInput.value
        ? "在所选星期全天生效"
        : startInput.value > endInput.value
          ? "将延续到次日结束时间"
          : "";
  }
  closeButton.addEventListener("click", close);
  cancelButton.addEventListener("click", close);
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) close();
  });
  startInput.addEventListener("input", updateNote);
  endInput.addEventListener("input", updateNote);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!draft) return;
    const days = dayInputs.filter(({ input }) => input.checked).map(({ day }) => day.value);
    if (days.length === 0) {
      note.textContent = "请至少选择一天。";
      dayInputs[0]?.input.focus();
      return;
    }
    if (!nameInput.value.trim() || !startInput.value || !endInput.value) return;
    const updated: TimeAccessRule = {
      ...schedule,
      name: nameInput.value.trim(),
      enabled: enabledToggle.input.checked,
      effect: effectInputs.find(({ input }) => input.checked)?.value ?? "block",
      days,
      startTime: startInput.value,
      endTime: endInput.value
    };
    const schedules = scheduleRulesFor(owner);
    const index = schedules.findIndex((candidate) => candidate.id === updated.id);
    if (index >= 0) schedules[index] = updated;
    else if (schedules.length < MAX_TIME_ACCESS_RULES) schedules.push(updated);
    else {
      note.textContent = "时段已达上限";
      return;
    }
    close();
    renderOptionsPreservingScroll();
    toast(existing ? "时段已更新" : "时段已添加");
  });

  backdrop.append(form);
  document.body.append(backdrop);
  document.addEventListener("keydown", onKeydown);
  updateNote();
  window.setTimeout(() => nameInput.focus(), 0);
}

function openPresetDialog(owner: RuleOwner): void {
  if (!draft) return;
  const titleId = `preset-dialog-${owner.kind}-${owner.id.replace(/[^A-Za-z0-9_-]/gu, "-")}`;
  const dayInputs = WEEKDAYS.map((day) => {
    const input = element("input", {
      attrs: { type: "checkbox", value: day.value, checked: true, "aria-label": day.label }
    });
    return { input, day };
  });
  const note = element("p", { className: "schedule-note", attrs: { "aria-live": "polite" } });
  const backdrop = element("div", { className: "dialog-backdrop" });
  const closeButton = element("button", {
    className: "btn btn--icon",
    attrs: { type: "button", title: "关闭", "aria-label": "关闭常用时段" },
    children: [icon("close")]
  });

  const presetRows = TIME_ACCESS_PRESETS.map((preset) =>
    element("li", {
      className: "preset-rule",
      children: [
        element("div", {
          children: [
            element("strong", { text: preset.label }),
            element("span", { text: formatPresetRanges(preset) })
          ]
        }),
        element("div", {
          className: "preset-rule__actions",
          children: (["allow", "block"] satisfies TimeAccessEffect[]).map((effect) => {
            const button = element("button", {
              className: effect === "allow" ? "btn btn--allow" : "btn",
              text: effect === "allow" ? "设为可用" : "设为不可用",
              attrs: { type: "button" }
            });
            button.addEventListener("click", () =>
              addPreset(owner, preset, effect, dayInputs, note)
            );
            return button;
          })
        })
      ]
    })
  );

  const dialog = element("section", {
    className: "dialog",
    attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    children: [
      element("header", {
        className: "dialog__header",
        children: [element("h2", { text: "添加常用时段", attrs: { id: titleId } }), closeButton]
      }),
      element("fieldset", {
        className: "field schedule-weekdays",
        children: [
          element("legend", { text: "星期" }),
          element("div", {
            className: "day-picker",
            children: dayInputs.map(({ input, day }) =>
              element("label", { attrs: { title: day.label }, children: [input, day.short] })
            )
          })
        ]
      }),
      element("ul", { className: "preset-rule-list", children: presetRows }),
      note
    ]
  });

  const close = (): void => {
    document.removeEventListener("keydown", onKeydown);
    backdrop.remove();
    renderOptionsPreservingScroll();
  };
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };
  closeButton.addEventListener("click", close);
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.append(dialog);
  document.body.append(backdrop);
  document.addEventListener("keydown", onKeydown);
  closeButton.focus();
}

function addPreset(
  owner: RuleOwner,
  preset: TimeAccessPreset,
  effect: TimeAccessEffect,
  dayInputs: ReadonlyArray<{ input: HTMLInputElement; day: (typeof WEEKDAYS)[number] }>,
  note: HTMLElement
): void {
  if (!draft) return;
  const days = dayInputs.filter(({ input }) => input.checked).map(({ day }) => day.value);
  if (days.length === 0) {
    note.textContent = "请至少选择一天";
    return;
  }

  const rules = scheduleRulesFor(owner);
  const signatures = new Set(rules.map(timeRuleSignature));
  const candidates = createPresetRules(preset, effect, days, createId).filter(
    (candidate) => !signatures.has(timeRuleSignature(candidate))
  );
  const added = candidates.slice(0, Math.max(0, MAX_TIME_ACCESS_RULES - rules.length));
  if (added.length === 0) {
    note.textContent = rules.length >= MAX_TIME_ACCESS_RULES ? "时段已达上限" : "这些时段已经添加";
    return;
  }
  rules.push(...added);
  note.textContent = `已添加 ${added.length} 个${effect === "allow" ? "可用" : "不可用"}时段`;
  updateDirtyState();
}

function formatPresetRanges(preset: TimeAccessPreset): string {
  return preset.ranges
    .map((range) => `${formatClockTime(range.startTime)}–${formatClockTime(range.endTime)}`)
    .join(" · ");
}

function timeRuleSignature(rule: TimeAccessRule): string {
  return [rule.effect, [...rule.days].sort().join(","), rule.startTime, rule.endTime].join("|");
}

async function saveSettings(button: HTMLButtonElement): Promise<void> {
  if (!draft || !isDirty()) return;
  const siteStateChanges = getSiteStateChanges(draft, savedSnapshot);
  setButtonBusy(button, true, "保存中");
  if (button !== topSaveButton && topSaveButton) topSaveButton.disabled = true;
  if (button !== savebarButton && savebarButton) savebarButton.disabled = true;
  try {
    await sendRequest({ type: "UPDATE_SETTINGS", patch: draft });
    for (const { siteId, enabled } of siteStateChanges) {
      await updateManagedSite(siteId, enabled);
    }
    draft = cloneSettings(await sendRequest({ type: "GET_SETTINGS" }));
    savedSnapshot = snapshot(draft);
    updateDirtyState();
    toast("已保存");
  } catch (error) {
    toast(describeError(error), "error");
  } finally {
    setButtonBusy(button, false);
    updateDirtyState();
  }
}

function getSiteStateChanges(
  next: FocusSettings,
  previousSnapshot: string
): Array<{ siteId: string; enabled: boolean }> {
  let previous: FocusSettings | null = null;
  try {
    previous = JSON.parse(previousSnapshot) as FocusSettings;
  } catch {
    // A malformed in-memory snapshot simply falls back to reconciling every site.
  }
  return Object.values(next.sites)
    .filter((site) => previous?.sites[site.id]?.enabled !== site.enabled)
    .map((site) => ({ siteId: site.id, enabled: site.enabled }));
}

function updateDirtyState(): void {
  const dirty = isDirty();
  if (saveState) {
    saveState.dataset.dirty = String(dirty);
    saveState.textContent = dirty ? "未保存" : "已保存";
  }
  if (savebar) savebar.dataset.visible = String(dirty);
  if (topSaveButton) topSaveButton.disabled = !dirty;
  if (savebarButton) savebarButton.disabled = !dirty;
}

function isDirty(): boolean {
  return draft !== null && snapshot(draft) !== savedSnapshot;
}

function renderOptionsPreservingScroll(): void {
  const scrollY = window.scrollY;
  renderOptions();
  window.scrollTo({ top: scrollY });
}

function formatDays(days: Weekday[]): string {
  const sorted = WEEKDAYS.filter(({ value }) => days.includes(value)).map(({ short }) => short);
  if (sorted.length === 7) return "每天";
  const weekdays = [1, 2, 3, 4, 5] satisfies Weekday[];
  if (weekdays.every((day) => days.includes(day)) && days.length === 5) return "工作日";
  if (days.length === 2 && days.includes(0) && days.includes(6)) return "周末";
  return `周${sorted.join("、")}`;
}

function crossesMidnight(schedule: TimeAccessRule): boolean {
  return schedule.startTime > schedule.endTime;
}

function cloneSettings(settings: FocusSettings): FocusSettings {
  return JSON.parse(JSON.stringify(settings)) as FocusSettings;
}

function snapshot(settings: FocusSettings): string {
  return JSON.stringify(settings);
}

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `schedule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
