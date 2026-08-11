import { parseLocalModuleFiles } from "../modules/local/importer";
import type {
  LocalModuleDefinition,
  LocalModuleFile,
  LocalModuleSnapshot
} from "../modules/local/types";
import { originsFromLocalModule } from "../modules/local/validation";
import { sendRequest } from "../shared/messages";
import type { DeepPartial, FocusSettings } from "../shared/types";
import { assertAppRoot, describeError, element, setButtonBusy, toast } from "../styles/dom";
import { createPageNavigation } from "../ui/page-navigation";
import { addManagedSite, requestLocalModulePermissions } from "../ui/site-management";

const MODULE_CATALOG_URL = "https://github.com/446F7269616E/Hourleaf/tree/main/optional-modules";
const app = assertAppRoot();
let settings: FocusSettings | null = null;
let localModules: LocalModuleSnapshot | null = null;

document.body.classList.add("home-page");
void loadSettings();

async function loadSettings(): Promise<void> {
  renderLoading();
  try {
    [settings, localModules] = await Promise.all([
      sendRequest({ type: "GET_SETTINGS" }),
      sendRequest({ type: "GET_LOCAL_MODULES" })
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
  if (!settings || !localModules) return;
  const content = element("div", {
    className: "home-content",
    children: [
      element("header", {
        className: "home-heading",
        children: [
          element("h1", { className: "page-title", text: "设置" }),
          element("p", { text: "管理本地模块与插件级选项。网站时间规则请前往配置页。" })
        ]
      }),
      element("div", {
        className: "home-settings",
        children: [createModuleSettingsPanel(), createPluginSettingsPanel()]
      })
    ]
  });
  app.replaceChildren(createShell(content));
}

function createModuleSettingsPanel(): HTMLElement {
  if (!localModules) return element("section");
  const importButton = element("button", {
    className: "btn btn--primary",
    text: "导入本地模块",
    attrs: { type: "button", "data-testid": "module-import-open" }
  });
  importButton.addEventListener("click", openImportDialog);
  const installations = Object.values(localModules.store.installations).sort((left, right) =>
    left.definition.name.localeCompare(right.definition.name, "zh-CN")
  );
  const warningItems = localModules.runtime.warnings.map((warning) =>
    element("li", { text: warning })
  );

  return element("section", {
    className: "home-settings__panel",
    attrs: { "aria-labelledby": "module-settings-title" },
    children: [
      element("header", {
        className: "home-settings__panel-heading home-settings__panel-heading--actions",
        children: [
          element("div", {
            children: [
              element("h2", { text: "模块设置", attrs: { id: "module-settings-title" } }),
              element("p", {
                text: "模块只从你明确选择的本地文件导入，不会从 GitHub 或其他地址自动下载代码。"
              })
            ]
          }),
          importButton
        ]
      }),
      createModuleBoundaryNotice(),
      ...(warningItems.length > 0
        ? [
            element("ul", {
              className: "home-module-warnings",
              attrs: { role: "status" },
              children: warningItems
            })
          ]
        : []),
      installations.length > 0
        ? element("div", {
            className: "home-module-list",
            children: installations.map(createLocalModuleCard)
          })
        : element("section", {
            className: "card home-module-empty",
            children: [
              element("h3", { text: "还没有本地模块" }),
              element("p", {
                text: "可以从模块目录下载 .json、.css 或 .user.js 文件，再由你手动检查并导入。"
              })
            ]
          })
    ]
  });
}

function createModuleBoundaryNotice(): HTMLElement {
  const catalogLink = element("a", {
    className: "btn",
    text: "打开 GitHub 模块目录",
    attrs: { href: MODULE_CATALOG_URL, target: "_blank", rel: "noopener noreferrer" }
  });
  return element("aside", {
    className: "card home-module-boundary",
    attrs: { "aria-label": "本地模块安全边界" },
    children: [
      element("div", {
        children: [
          element("strong", { text: "商店核心与本地模块相互隔离" }),
          element("p", {
            text: "核心只执行经过校验的域名策略、元素隐藏、CSS 和声明式网络规则；用户脚本只能进入浏览器提供的隔离 User Scripts 环境。"
          })
        ]
      }),
      catalogLink
    ]
  });
}

function createLocalModuleCard(
  installation: LocalModuleSnapshot["store"]["installations"][string]
): HTMLElement {
  const { definition, enabled } = installation;
  const toggle = createToggle(`启用 ${definition.name}`, enabled, `local-module-${definition.id}`);
  toggle.input.addEventListener("change", () => {
    void setLocalModuleEnabled(definition.id, toggle.input.checked, toggle.input);
  });
  const remove = element("button", {
    className: "btn btn--danger",
    text: "删除",
    attrs: { type: "button" }
  });
  remove.addEventListener("click", () => {
    openConfirmation({
      title: `删除“${definition.name}”？`,
      detail: "该模块的 CSS、网络规则和用户脚本注册都会从本机移除。网站时间配置不会删除。",
      actionLabel: "删除",
      onConfirm: async () => {
        localModules = await sendRequest({ type: "REMOVE_LOCAL_MODULE", moduleId: definition.id });
        toast("本地模块已删除");
        renderSettings();
      }
    });
  });
  return element("article", {
    className: "home-module card",
    attrs: { "aria-labelledby": `module-title-${definition.id}` },
    children: [
      element("header", {
        className: "home-module__header",
        children: [
          element("span", { className: "home-module__icon", text: "M" }),
          element("div", {
            className: "home-module__copy",
            children: [
              element("h3", {
                text: definition.name,
                attrs: { id: `module-title-${definition.id}` }
              }),
              element("p", {
                text: definition.description || `${definition.id} · ${definition.version}`
              })
            ]
          }),
          element("span", {
            className: `status-chip${enabled ? " status-chip--success" : ""}`,
            text: enabled ? "已启用" : "已停用"
          }),
          element("div", { className: "home-module__actions", children: [toggle.label, remove] })
        ]
      }),
      element("div", {
        className: "home-module__details",
        children: [
          createModuleDetail("适用网站", definition.matches.join("、")),
          createModuleDetail(
            "能力",
            definition.capabilities.length > 0 ? definition.capabilities.join("、") : "仅元数据"
          ),
          createModuleDetail("来源", "用户手动选择的本地文件")
        ]
      })
    ]
  });
}

function createModuleDetail(label: string, value: string): HTMLElement {
  return element("p", {
    children: [element("strong", { text: `${label}：` }), document.createTextNode(value)]
  });
}

function openImportDialog(): void {
  let candidate: LocalModuleDefinition | null = null;
  const fileInput = element("input", {
    className: "input",
    attrs: {
      type: "file",
      multiple: true,
      accept: ".json,.css,.js,.user.js,application/json,text/css,text/javascript",
      "data-testid": "module-import-files"
    }
  });
  const preview = element("div", {
    className: "home-import-preview",
    attrs: { role: "status", "aria-live": "polite" },
    text: "请选择模块清单及其引用的 CSS/脚本文件。"
  });
  const confirm = element("button", {
    className: "btn btn--primary",
    text: "确认导入并授权",
    attrs: { type: "button", "data-testid": "module-import-confirm" }
  });
  confirm.disabled = true;
  const cancel = element("button", { className: "btn", text: "取消", attrs: { type: "button" } });
  const dialog = element("dialog", {
    className: "dialog home-import-dialog",
    attrs: { "aria-labelledby": "module-import-title" },
    children: [
      element("h2", { text: "导入本地模块", attrs: { id: "module-import-title" } }),
      element("p", {
        text: "导入前请自行查看文件内容。Hourleaf 不会联网补齐清单引用，也不会使用 eval 执行脚本。"
      }),
      element("label", {
        className: "field",
        children: [element("span", { text: "本地模块文件" }), fileInput]
      }),
      preview,
      element("div", { className: "dialog__actions", children: [cancel, confirm] })
    ]
  });
  fileInput.addEventListener("change", () => {
    void (async () => {
      candidate = null;
      confirm.disabled = true;
      try {
        const files = await Promise.all(
          [...(fileInput.files ?? [])].map(async (file): Promise<LocalModuleFile> => ({
            name: file.name,
            text: await file.text()
          }))
        );
        candidate = parseLocalModuleFiles(files);
        preview.replaceChildren(
          element("strong", { text: `${candidate.name} ${candidate.version}` }),
          element("p", { text: `网站：${candidate.matches.join("、")}` }),
          element("p", {
            text: `能力：${candidate.capabilities.join("、") || "仅元数据"}`
          })
        );
        confirm.disabled = false;
      } catch (error) {
        preview.textContent = describeError(error);
      }
    })();
  });
  cancel.addEventListener("click", () => dialog.close());
  confirm.addEventListener("click", () => {
    if (!candidate) return;
    void importLocalModule(candidate, confirm, dialog);
  });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

async function importLocalModule(
  definition: LocalModuleDefinition,
  button: HTMLButtonElement,
  dialog: HTMLDialogElement
): Promise<void> {
  setButtonBusy(button, true);
  try {
    if (
      definition.userScript.trim() &&
      localModules?.runtime.userScripts === "disabled-by-platform"
    ) {
      throw new Error("Safari 商店版不导入或执行用户脚本；请移除 .user.js 后再导入");
    }
    const granted = await requestLocalModulePermissions(
      definition.matches,
      definition.userScript.trim().length > 0
    );
    if (!granted) throw new Error("未获得模块所需的网站权限");
    for (const origin of originsFromLocalModule(definition)) await addManagedSite(origin);
    localModules = await sendRequest({ type: "IMPORT_LOCAL_MODULE", module: definition });
    localModules = await sendRequest({
      type: "SET_LOCAL_MODULE_ENABLED",
      moduleId: definition.id,
      enabled: true
    });
    dialog.close();
    toast(localModules.runtime.warnings[0] ?? "本地模块已导入并启用");
    renderSettings();
  } catch (error) {
    toast(describeError(error), "error");
  } finally {
    setButtonBusy(button, false);
  }
}

async function setLocalModuleEnabled(
  moduleId: string,
  enabled: boolean,
  control: HTMLInputElement
): Promise<void> {
  control.disabled = true;
  try {
    localModules = await sendRequest({ type: "SET_LOCAL_MODULE_ENABLED", moduleId, enabled });
    toast(localModules.runtime.warnings[0] ?? (enabled ? "模块已启用" : "模块已停用"));
    renderSettings();
  } catch (error) {
    toast(describeError(error), "error");
    await loadSettings();
  }
}

function createPluginSettingsPanel(): HTMLElement {
  if (!settings) return element("section");
  const focusToggle = createToggle("启用时间管理", settings.enabled, "settings-focus-toggle");
  focusToggle.input.addEventListener("change", () => {
    void updateSettings({ enabled: focusToggle.input.checked }, focusToggle.input);
  });
  const watchDuration = element("input", {
    className: "input",
    attrs: {
      type: "number",
      min: "1",
      max: "360",
      step: "1",
      value: settings.planMode.watchDurationMinutes,
      "aria-label": "计划单次访问分钟数"
    }
  });
  watchDuration.addEventListener("change", () => {
    void updatePlanDuration(clampNumberInput(watchDuration, 1, 360), watchDuration);
  });
  const clearUsage = element("button", {
    className: "btn btn--danger",
    text: "清空使用时间",
    attrs: { type: "button" }
  });
  clearUsage.addEventListener("click", () => {
    openConfirmation({
      title: "清空使用时间？",
      detail: "已记录的本地使用时间会被删除。",
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
      detail: "时间设置将恢复默认值；本地模块仍会保留。",
      actionLabel: "恢复",
      onConfirm: async () => {
        settings = await sendRequest({ type: "RESET_SETTINGS" });
        toast("已恢复默认设置");
        renderSettings();
      }
    });
  });

  return element("section", {
    className: "home-settings__panel",
    attrs: { "aria-labelledby": "plugin-settings-title" },
    children: [
      createPanelHeading(
        "plugin-settings-title",
        "插件其他设置",
        "这里的总开关影响所有时间规则，因此只在完整设置页提供。"
      ),
      element("div", {
        className: "home-plugin-card card",
        children: [
          createSettingRow("启用时间管理", "关闭后暂停所有计时、名单与时间规则", focusToggle.label),
          createSettingRow(
            "计划单次访问",
            "开始一个计划项目后允许访问的时长",
            element("label", {
              className: "home-number-control",
              children: [watchDuration, element("span", { text: "分钟" })]
            })
          ),
          element("div", {
            className: "home-settings__actions",
            children: [resetSettings, clearUsage]
          })
        ]
      })
    ]
  });
}

function createPanelHeading(id: string, title: string, description: string): HTMLElement {
  return element("header", {
    className: "home-settings__panel-heading",
    children: [element("h2", { text: title, attrs: { id } }), element("p", { text: description })]
  });
}

function createSettingRow(title: string, description: string, control: HTMLElement): HTMLElement {
  return element("div", {
    className: "home-setting-row",
    children: [
      element("div", {
        children: [element("strong", { text: title }), element("p", { text: description })]
      }),
      control
    ]
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
    toast(describeError(error), "error");
    await loadSettings();
  }
}

async function updatePlanDuration(
  watchDurationMinutes: number,
  control: HTMLInputElement
): Promise<void> {
  control.disabled = true;
  try {
    const state = await sendRequest({ type: "SET_PLAN_MODE", watchDurationMinutes });
    if (settings) settings = { ...settings, planMode: state.settings };
    toast("已保存");
    renderSettings();
  } catch (error) {
    toast(describeError(error), "error");
    await loadSettings();
  }
}

function createShell(content: HTMLElement): HTMLElement {
  return element("div", {
    className: "home-shell app-shell",
    children: [createPageNavigation({ currentPage: "home" }), content]
  });
}

function createToggle(
  labelText: string,
  checked: boolean,
  testId: string
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const input = element("input", {
    attrs: { type: "checkbox", checked, "aria-label": labelText, "data-testid": testId }
  });
  const label = element("label", {
    className: "switch",
    children: [input, element("span", { className: "sr-only", text: labelText })]
  });
  return { label, input };
}

interface ConfirmationOptions {
  title: string;
  detail: string;
  actionLabel: string;
  onConfirm(): Promise<void>;
}

function openConfirmation(options: ConfirmationOptions): void {
  const dialog = element("dialog", {
    className: "dialog home-confirmation",
    attrs: { "aria-labelledby": "home-confirmation-title" },
    children: [
      element("h2", { text: options.title, attrs: { id: "home-confirmation-title" } }),
      element("p", { text: options.detail }),
      element("div", {
        className: "dialog__actions",
        children: [
          element("button", { className: "btn", text: "取消", attrs: { type: "button" } }),
          element("button", {
            className: "btn btn--danger",
            text: options.actionLabel,
            attrs: { type: "button" }
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

function clampNumberInput(input: HTMLInputElement, min: number, max: number): number {
  const parsed = Math.round(Number(input.value));
  const value = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : min;
  input.value = String(value);
  return value;
}
