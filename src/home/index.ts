import { sendRequest } from "../shared/messages";
import type { DeepPartial, FocusSettings } from "../shared/types";
import { assertAppRoot, describeError, element, setButtonBusy, toast } from "../styles/dom";
import { createPageNavigation } from "../ui/page-navigation";

const app = assertAppRoot();
let settings: FocusSettings | null = null;

document.body.classList.add("home-page");
void loadSettings();

async function loadSettings(): Promise<void> {
  renderLoading();
  try {
    settings = await sendRequest({ type: "GET_SETTINGS" });
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
    "单次观看分钟数"
  );
  watchDuration.disabled = !settings.planMode.enabled;
  planToggle.input.addEventListener("change", () => {
    void updatePlanMode({ enabled: planToggle.input.checked }, planToggle.input);
  });
  watchDuration.addEventListener("change", () => {
    const value = clampInput(watchDuration, 1, 360);
    void updatePlanMode({ watchDurationMinutes: value }, watchDuration);
  });

  const accessToggle = createToggle(
    "临时访问",
    settings.temporaryAccess.enabled,
    "settings-access-toggle"
  );
  const accessDuration = createNumberInput(
    settings.temporaryAccess.durationMinutes,
    1,
    60,
    "每次临时访问分钟数"
  );
  const accessUses = createNumberInput(
    settings.temporaryAccess.maxUsesPerDay,
    0,
    50,
    "每天临时访问次数"
  );
  accessDuration.disabled = !settings.temporaryAccess.enabled;
  accessUses.disabled = !settings.temporaryAccess.enabled;
  accessToggle.input.addEventListener("change", () => {
    void updateSettings(
      { temporaryAccess: { enabled: accessToggle.input.checked } },
      accessToggle.input
    );
  });
  accessDuration.addEventListener("change", () => {
    void updateSettings(
      { temporaryAccess: { durationMinutes: clampInput(accessDuration, 1, 60) } },
      accessDuration
    );
  });
  accessUses.addEventListener("change", () => {
    void updateSettings(
      { temporaryAccess: { maxUsesPerDay: clampInput(accessUses, 0, 50) } },
      accessUses
    );
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
          createSettingsCard("专注", [createSettingRow("专注保护", focusToggle.label)]),
          createSettingsCard("计划", [
            createSettingRow("计划模式", planToggle.label),
            createNumberRow("单次观看", watchDuration, "分钟")
          ]),
          createSettingsCard("临时访问", [
            createSettingRow("允许临时访问", accessToggle.label),
            createNumberRow("每次时长", accessDuration, "分钟"),
            createNumberRow("每日次数", accessUses, "次")
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
