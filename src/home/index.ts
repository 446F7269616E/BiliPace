import { sendRequest } from "../shared/messages";
import type { DeepPartial, FocusSettings, ManagedSite, SiteModuleStore } from "../shared/types";
import { assertAppRoot, describeError, element, setButtonBusy, toast } from "../styles/dom";
import { createPageNavigation } from "../ui/page-navigation";
import {
  addBilibiliModuleSites,
  addManagedSite,
  getSiteModules,
  hasWebsitePermission,
  normalizeWebsiteInput,
  removeSiteModule,
  removeManagedSite,
  requestBilibiliModulePermissions,
  requestWebsitePermission,
  setSiteModuleState,
  updateManagedSite
} from "../ui/site-management";

const app = assertAppRoot();
let settings: FocusSettings | null = null;
let modules: SiteModuleStore | null = null;
const BILIBILI_MODULE_ID = "hourleaf.site.bilibili";

document.body.classList.add("home-page");
void loadSettings();

async function loadSettings(): Promise<void> {
  renderLoading();
  try {
    [settings, modules] = await Promise.all([
      sendRequest({ type: "GET_SETTINGS" }),
      getSiteModules()
    ]);
    renderSettings();
  } catch (error) {
    renderError(describeError(error));
  }
}

function renderLoading(): void {
  app.replaceChildren(
    createShell(
      element("section", {
        className: "card state-view home-state",
        attrs: { "aria-busy": "true", "aria-label": "正在加载设置" },
        children: [element("h2", { text: "正在加载设置" })]
      })
    )
  );
}

function renderError(message: string): void {
  const retry = element("button", {
    className: "btn btn--primary",
    text: "重试",
    attrs: { type: "button" }
  });
  retry.addEventListener("click", () => void loadSettings());
  app.replaceChildren(
    createShell(
      element("section", {
        className: "card state-view home-state",
        attrs: { role: "alert" },
        children: [element("h2", { text: "设置加载失败" }), element("p", { text: message }), retry]
      })
    )
  );
}

function renderSettings(): void {
  if (!settings) return;

  const focusToggle = createToggle("专注保护", settings.enabled, "settings-focus-toggle");
  focusToggle.input.addEventListener("change", () => {
    void updateSettings({ enabled: focusToggle.input.checked }, focusToggle.input);
  });

  const planToggle = createToggle("计划模式", settings.planMode.enabled, "settings-plan-toggle");
  const watchDuration = createNumberInput(
    settings.planMode.watchDurationMinutes,
    1,
    360,
    "单次访问分钟数"
  );
  watchDuration.disabled = !settings.planMode.enabled;
  planToggle.input.addEventListener("change", () => {
    void updatePlanMode({ enabled: planToggle.input.checked }, planToggle.input);
  });
  watchDuration.addEventListener("change", () => {
    const value = clampInput(watchDuration, 1, 360);
    void updatePlanMode({ watchDurationMinutes: value }, watchDuration);
  });

  const clearUsage = element("button", {
    className: "btn btn--danger",
    text: "清空使用时间",
    attrs: { type: "button" }
  });
  clearUsage.addEventListener("click", () => {
    openConfirmation({
      title: "清空使用时间？",
      actionLabel: "清空",
      onConfirm: async () => {
        await sendRequest({ type: "CLEAR_USAGE" });
        toast("使用时间已清空");
      }
    });
  });

  const resetSettings = element("button", {
    className: "btn",
    text: "恢复默认设置",
    attrs: { type: "button" }
  });
  resetSettings.addEventListener("click", () => {
    openConfirmation({
      title: "恢复默认设置？",
      actionLabel: "恢复",
      onConfirm: async () => {
        settings = await sendRequest({ type: "RESET_SETTINGS" });
        toast("已恢复默认设置");
        renderSettings();
      }
    });
  });

  const content = element("div", {
    className: "home-content",
    children: [
      element("header", {
        className: "home-heading",
        children: [element("h1", { className: "page-title", text: "设置" })]
      }),
      element("div", {
        className: "home-settings",
        children: [
          createWebsitesCard(),
          createModulesCard(),
          createSettingsCard("专注", [createSettingRow("专注保护", focusToggle.label)]),
          createSettingsCard("计划", [
            createSettingRow("计划模式", planToggle.label),
            createNumberRow("单次访问", watchDuration, "分钟")
          ]),
          createSettingsCard("数据", [
            element("div", {
              className: "home-settings__actions",
              children: [resetSettings, clearUsage]
            })
          ])
        ]
      })
    ]
  });

  app.replaceChildren(createShell(content));
  void refreshPermissionBadges();
}

function createWebsitesCard(): HTMLElement {
  const sites = settings
    ? Object.values(settings.sites).sort((left, right) => left.label.localeCompare(right.label))
    : [];
  const input = element("input", {
    className: "input home-site-add__input",
    attrs: {
      type: "text",
      inputmode: "url",
      autocomplete: "url",
      placeholder: "example.com",
      "aria-label": "网站域名或网址",
      "data-testid": "site-add-input"
    }
  });
  const addButton = element("button", {
    className: "btn btn--primary",
    text: "添加网站",
    attrs: { type: "button", "data-testid": "site-add-button" }
  });
  addButton.addEventListener("click", () => {
    void addSiteFromInput(input, addButton);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addButton.click();
    }
  });
  return element("section", {
    className: "home-settings__card card home-sites",
    attrs: { "aria-labelledby": "managed-sites-title" },
    children: [
      element("div", {
        className: "home-settings__card-heading",
        children: [
          element("h2", { text: "网站", attrs: { id: "managed-sites-title" } }),
          element("span", { className: "status-chip", text: `${sites.length} 个` })
        ]
      }),
      element("div", {
        className: "home-site-add",
        children: [input, addButton]
      }),
      element("div", {
        className: "home-site-list",
        children:
          sites.length > 0
            ? sites.map(createSiteRow)
            : [element("p", { className: "home-empty", text: "暂无网站" })]
      })
    ]
  });
}

function createSiteRow(site: ManagedSite): HTMLElement {
  const toggle = createToggle(
    `${site.label || site.hostname}网站`,
    site.enabled,
    `site-${site.id}`
  );
  toggle.input.addEventListener("change", () => {
    void setSiteEnabled(site, toggle.input.checked, toggle.input);
  });
  const remove = element("button", {
    className: "btn btn--danger",
    attrs: { type: "button", title: "删除", "aria-label": `删除${site.label || site.hostname}` },
    children: [element("span", { text: "删除" })]
  });
  remove.addEventListener("click", () => {
    openConfirmation({
      title: `删除 ${site.label || site.hostname}？`,
      actionLabel: "删除",
      onConfirm: async () => {
        await removeManagedSite(site.id);
        toast("网站已删除");
        await loadSettings();
      }
    });
  });
  return element("article", {
    className: "home-site-row",
    dataset: { siteId: site.id },
    children: [
      element("div", {
        className: "home-site-row__identity",
        children: [
          element("strong", { text: site.label || site.hostname }),
          element("span", { text: site.origin })
        ]
      }),
      element("span", {
        className: "status-chip home-site-row__permission",
        text: "检查权限",
        dataset: { permissionOrigin: `${site.origin}/*` }
      }),
      toggle.label,
      remove
    ]
  });
}

function createModulesCard(): HTMLElement {
  const installation = modules?.installations[BILIBILI_MODULE_ID];
  const installed = Boolean(installation);
  const enabled = Boolean(installation?.enabled);
  const action = !installed ? "restore" : enabled ? "disable" : "enable";
  const button = element("button", {
    className: `btn${action === "restore" || action === "enable" ? " btn--primary" : ""}`,
    text: action === "restore" ? "恢复" : action === "enable" ? "启用" : "停用",
    attrs: { type: "button", "data-testid": "bilibili-module-action" }
  });
  button.addEventListener("click", () => {
    void updateModule(action, button);
  });
  const removeButton = element("button", {
    className: "btn btn--danger",
    text: "删除",
    attrs: { type: "button", "data-testid": "bilibili-module-remove" }
  });
  removeButton.disabled = !installed;
  removeButton.addEventListener("click", () => {
    openConfirmation({
      title: "删除哔哩哔哩模块？",
      actionLabel: "删除",
      onConfirm: async () => {
        await removeSiteModule(BILIBILI_MODULE_ID);
        toast("模块已删除");
        await loadSettings();
      }
    });
  });
  return element("section", {
    className: "home-settings__card card home-modules",
    attrs: { "aria-labelledby": "modules-title" },
    children: [
      element("div", {
        className: "home-settings__card-heading",
        children: [
          element("h2", { text: "模块", attrs: { id: "modules-title" } }),
          element("span", { className: "status-chip", text: installed ? "已预装" : "已删除" })
        ]
      }),
      element("article", {
        className: "home-module-row",
        children: [
          element("div", {
            className: "home-module-row__icon",
            children: [element("span", { text: "哔" })]
          }),
          element("div", {
            className: "home-module-row__copy",
            children: [
              element("strong", { text: "哔哩哔哩" }),
              element("p", { text: "视频、动态、直播与站内内容管理" }),
              element("div", {
                className: "home-module-row__capabilities",
                children: ["分类", "内容过滤", "计划", "使用统计"].map((label) =>
                  element("span", { text: label })
                )
              })
            ]
          }),
          element("span", {
            className: `status-chip${enabled ? " status-chip--success" : ""}`,
            text: enabled ? "已启用" : installed ? "已停用" : "已删除"
          }),
          element("div", {
            className: "home-module-row__actions",
            children: [button, removeButton]
          })
        ]
      })
    ]
  });
}

async function addSiteFromInput(input: HTMLInputElement, button: HTMLButtonElement): Promise<void> {
  try {
    const website = normalizeWebsiteInput(input.value);
    setButtonBusy(button, true, "请求权限");
    const granted = await requestWebsitePermission(website.permissionPattern);
    if (!granted) {
      toast("未获得网站权限", "error");
      return;
    }
    setButtonBusy(button, true, "正在添加");
    await addManagedSite(website.origin);
    input.value = "";
    toast("网站已添加");
    await loadSettings();
  } catch (error) {
    toast(error instanceof Error ? error.message : describeError(error), "error");
  } finally {
    setButtonBusy(button, false);
  }
}

async function setSiteEnabled(
  site: ManagedSite,
  enabled: boolean,
  control: HTMLInputElement
): Promise<void> {
  control.disabled = true;
  try {
    await updateManagedSite(site.id, enabled);
    toast(enabled ? "网站已启用" : "网站已暂停");
    await loadSettings();
  } catch (error) {
    control.checked = !enabled;
    control.disabled = false;
    toast(describeError(error), "error");
  }
}

async function updateModule(
  action: "restore" | "enable" | "disable",
  button: HTMLButtonElement
): Promise<void> {
  setButtonBusy(button, true);
  try {
    if (action === "enable") {
      const granted = await requestBilibiliModulePermissions();
      if (!granted) {
        toast("未获得网站权限", "error");
        return;
      }
      await addBilibiliModuleSites();
    }
    await setSiteModuleState(BILIBILI_MODULE_ID, action);
    toast(action === "restore" ? "模块已恢复" : action === "enable" ? "模块已启用" : "模块已停用");
    await loadSettings();
  } catch (error) {
    setButtonBusy(button, false);
    toast(describeError(error), "error");
  }
}

async function refreshPermissionBadges(): Promise<void> {
  const badges = document.querySelectorAll<HTMLElement>("[data-permission-origin]");
  await Promise.all(
    [...badges].map(async (badge) => {
      const pattern = badge.dataset.permissionOrigin;
      if (!pattern) return;
      const granted = await hasWebsitePermission(pattern);
      badge.textContent = granted === null ? "权限由浏览器管理" : granted ? "已授权" : "未授权";
      badge.classList.toggle("status-chip--success", granted === true);
      badge.classList.toggle("status-chip--warning", granted === false);
    })
  );
}

function createShell(content: HTMLElement): HTMLElement {
  return element("div", {
    className: "home-shell app-shell",
    children: [createPageNavigation({ currentPage: "home" }), content]
  });
}

function createSettingsCard(title: string, children: HTMLElement[]): HTMLElement {
  return element("section", {
    className: "home-settings__card card",
    children: [element("h2", { text: title }), ...children]
  });
}

function createSettingRow(label: string, control: HTMLElement): HTMLElement {
  return element("div", {
    className: "home-settings__row",
    children: [element("span", { text: label }), control]
  });
}

function createNumberRow(label: string, input: HTMLInputElement, suffix: string): HTMLElement {
  return createSettingRow(
    label,
    element("label", {
      className: "home-settings__number",
      children: [input, element("span", { text: suffix })]
    })
  );
}

function createToggle(
  labelText: string,
  checked: boolean,
  testId: string
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const input = element("input", {
    attrs: {
      type: "checkbox",
      checked,
      "aria-label": labelText,
      "data-testid": testId
    }
  });
  const label = element("label", {
    className: "switch",
    children: [input, element("span", { className: "sr-only", text: labelText })]
  });
  return { label, input };
}

function createNumberInput(
  value: number,
  min: number,
  max: number,
  label: string
): HTMLInputElement {
  return element("input", {
    className: "input",
    attrs: { type: "number", value, min, max, step: "1", "aria-label": label }
  });
}

async function updateSettings(
  patch: DeepPartial<FocusSettings>,
  control: HTMLInputElement
): Promise<void> {
  control.disabled = true;
  try {
    settings = await sendRequest({ type: "UPDATE_SETTINGS", patch });
    toast("已保存");
    renderSettings();
  } catch (error) {
    control.disabled = false;
    toast(describeError(error), "error");
    await loadSettings();
  }
}

async function updatePlanMode(
  patch: { enabled?: boolean; watchDurationMinutes?: number },
  control: HTMLInputElement
): Promise<void> {
  control.disabled = true;
  try {
    const state = await sendRequest({ type: "SET_PLAN_MODE", ...patch });
    if (settings) settings = { ...settings, planMode: state.settings };
    toast("已保存");
    renderSettings();
  } catch (error) {
    control.disabled = false;
    toast(describeError(error), "error");
    await loadSettings();
  }
}

interface ConfirmationOptions {
  title: string;
  actionLabel: string;
  onConfirm(): Promise<void>;
}

function openConfirmation(options: ConfirmationOptions): void {
  const dialog = element("dialog", {
    className: "dialog home-confirmation",
    children: [
      element("h2", { text: options.title }),
      element("div", {
        className: "dialog__actions",
        children: [
          element("button", {
            className: "btn",
            text: "取消",
            attrs: { type: "button", value: "cancel" }
          }),
          element("button", {
            className: "btn btn--danger",
            text: options.actionLabel,
            attrs: { type: "button", value: "confirm" }
          })
        ]
      })
    ]
  });
  const buttons = dialog.querySelectorAll<HTMLButtonElement>("button");
  buttons[0]?.addEventListener("click", () => dialog.close());
  buttons[1]?.addEventListener("click", () => {
    const confirmButton = buttons[1];
    if (!confirmButton) return;
    void (async () => {
      setButtonBusy(confirmButton, true);
      try {
        await options.onConfirm();
        dialog.close();
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

function clampInput(input: HTMLInputElement, min: number, max: number): number {
  const value = Math.round(Number(input.value));
  const normalized = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  input.value = String(normalized);
  return normalized;
}
