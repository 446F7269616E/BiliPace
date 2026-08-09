import { sendRequest } from "../shared/messages";
import { BilibiliOpenPlatformProvider, parseManualBilibiliImport } from "../integrations";
import type { BilibiliProviderStatus } from "../integrations";
import { MAX_PLAN_IMPORT_ITEMS, MAX_PLAN_TITLE_LENGTH } from "../shared/plan";
import type { PlanItem, PlanItemInput, PlanItemSource, PlanState } from "../shared/types";
import { assertAppRoot, describeError, element, icon, setButtonBusy, toast } from "../styles/dom";

const SOURCE_LABELS: Readonly<Record<PlanItemSource, string>> = {
  manual: "手动添加",
  "watch-later": "稍后再看",
  favorite: "收藏夹"
};

const WATCH_DURATIONS = [15, 30, 45, 60, 90, 120] as const;

const app = assertAppRoot();
const importProvider = new BilibiliOpenPlatformProvider();
let state: PlanState | null = null;
let importStatus: BilibiliProviderStatus | null = null;
let editingItemId: string | null = null;

document.body.classList.add("plan-page");
void loadPlan();

async function loadPlan(): Promise<void> {
  renderLoading();
  try {
    const [planState, providerStatus] = await Promise.all([
      sendRequest({ type: "GET_PLAN_STATE" }),
      importProvider.getStatus()
    ]);
    state = planState;
    importStatus = providerStatus;
    renderPlan();
  } catch (error) {
    renderError(describeError(error));
  }
}

function renderLoading(): void {
  app.replaceChildren(
    createShell(
      element("section", {
        className: "card plan-card plan-state",
        attrs: { "aria-busy": "true", "aria-label": "正在加载观看计划" },
        children: [
          element("div", {
            className: "plan-state__inner",
            children: [
              element("div", { className: "plan-state__icon", children: [icon("calendar")] }),
              element("h2", { text: "正在整理你的观看计划" }),
              element("p", { text: "读取待办、完成记录与计划模式状态…" }),
              element("div", {
                className: "plan-skeleton",
                attrs: { "aria-hidden": "true" },
                children: [
                  element("span", { className: "plan-skeleton__item" }),
                  element("span", { className: "plan-skeleton__item" })
                ]
              })
            ]
          })
        ]
      })
    )
  );
}

function renderError(message: string): void {
  const retry = element("button", {
    className: "btn btn--primary",
    text: "重新加载",
    attrs: { type: "button" }
  });
  retry.addEventListener("click", () => void loadPlan());
  app.replaceChildren(
    createShell(
      element("section", {
        className: "card plan-card plan-state",
        attrs: { role: "alert" },
        children: [
          element("div", {
            className: "plan-state__inner",
            children: [
              element("div", { className: "plan-state__icon", children: [icon("warning")] }),
              element("h2", { text: "计划暂时无法加载" }),
              element("p", { text: message }),
              retry
            ]
          })
        ]
      })
    )
  );
}

function renderPlan(options: { focusItemId?: string; focusAddForm?: boolean } = {}): void {
  if (!state) return;
  const content = element("div", {
    children: [
      createModeCard(state),
      element("div", {
        className: "plan-grid",
        children: [createQueueCard(state), createAside()]
      }),
      createFooter()
    ]
  });
  app.replaceChildren(createShell(content));

  if (options.focusAddForm) {
    document.querySelector<HTMLInputElement>("#plan-video-url")?.focus();
  } else if (options.focusItemId) {
    document
      .querySelector<HTMLElement>(`[data-plan-item-id="${cssEscape(options.focusItemId)}"]`)
      ?.focus();
  }
}

function createShell(content: HTMLElement): HTMLElement {
  return element("div", {
    className: "plan-shell app-shell",
    children: [
      element("header", {
        className: "plan-topbar",
        children: [
          element("a", {
            className: "brand",
            attrs: { href: "plan.html", "aria-label": "BiliPace 哔哩节拍观看计划" },
            children: [
              element("span", { className: "brand__mark", children: [icon("focus")] }),
              element("span", {
                className: "brand__meta",
                children: [
                  element("span", { text: "BiliPace" }),
                  element("small", { text: "观看计划" })
                ]
              })
            ]
          }),
          element("nav", {
            className: "plan-topbar__actions",
            attrs: { "aria-label": "扩展页面" },
            children: [
              element("a", {
                className: "btn",
                attrs: { href: "dashboard.html", title: "使用洞察" },
                children: [icon("bar-chart"), element("span", { text: "使用洞察" })]
              }),
              element("a", {
                className: "btn",
                attrs: { href: "options.html", title: "专注设置" },
                children: [icon("settings"), element("span", { text: "专注设置" })]
              })
            ]
          })
        ]
      }),
      element("header", {
        className: "plan-heading",
        children: [
          element("div", {
            className: "plan-heading__copy",
            children: [
              element("p", {
                className: "plan-heading__eyebrow",
                children: [icon("sparkles"), "按计划观看"]
              }),
              element("h1", { className: "page-title", text: "先决定看什么，再打开 Bilibili" }),
              element("p", {
                className: "page-description",
                text: "把真正想看的视频排成待办。计划模式开启后，访问 Bilibili 会先回到这里。"
              })
            ]
          }),
          element("p", {
            className: "plan-heading__aside",
            text: "队列与打卡记录只保存在当前浏览器。你可以随时暂停计划模式，待办不会丢失。"
          })
        ]
      }),
      content
    ]
  });
}

function createModeCard(planState: PlanState): HTMLElement {
  const toggle = element("input", {
    attrs: {
      type: "checkbox",
      checked: planState.settings.enabled,
      "aria-label": "计划模式",
      "data-testid": "plan-mode-toggle"
    }
  });
  const switchLabel = element("label", {
    className: "switch",
    attrs: { title: planState.settings.enabled ? "暂停计划模式" : "开启计划模式" },
    children: [toggle]
  });
  toggle.addEventListener("change", () => {
    void updatePlanSettings({ enabled: toggle.checked }, toggle);
  });

  const durationOptions = Array.from(
    new Set<number>([...WATCH_DURATIONS, planState.settings.watchDurationMinutes])
  ).sort((first, second) => first - second);
  const durationSelect = element("select", {
    className: "plan-select plan-mode-card__duration",
    attrs: {
      "aria-label": "每次开始观看的放行时长",
      "data-testid": "plan-watch-duration"
    },
    children: durationOptions.map((minutes) =>
      element("option", {
        text: `${minutes} 分钟`,
        attrs: { value: minutes, selected: minutes === planState.settings.watchDurationMinutes }
      })
    )
  });
  durationSelect.addEventListener("change", () => {
    void updatePlanSettings({ watchDurationMinutes: Number(durationSelect.value) }, durationSelect);
  });

  return element("section", {
    className: `plan-mode-card card${planState.settings.enabled ? " plan-mode-card--enabled" : ""}`,
    attrs: { "aria-labelledby": "plan-mode-title" },
    children: [
      element("div", {
        className: "plan-mode-card__body",
        children: [
          element("span", {
            className: "plan-mode-card__icon",
            children: [icon(planState.settings.enabled ? "lock" : "unlock")]
          }),
          element("div", {
            children: [
              element("h2", {
                text: planState.settings.enabled ? "计划模式正在守护入口" : "计划模式已暂停",
                attrs: { id: "plan-mode-title" }
              }),
              element("p", {
                text: planState.settings.enabled
                  ? "打开任意 Bilibili 链接都会先进入计划页；只有点击计划中的“开始观看”，对应视频才会限时放行。"
                  : "开启后会先拦住无目的浏览。已有队列与完成记录在暂停期间仍会保留。"
              })
            ]
          })
        ]
      }),
      element("div", {
        className: "plan-mode-card__control",
        children: [
          element("label", {
            className: "plan-field plan-mode-card__duration-field",
            children: [element("span", { text: "单次观看窗口" }), durationSelect]
          }),
          element("span", {
            className: "plan-mode-card__state",
            text: planState.settings.enabled ? "已开启" : "已暂停",
            attrs: { "aria-hidden": "true" }
          }),
          switchLabel
        ]
      })
    ]
  });
}

async function updatePlanSettings(
  patch: { enabled?: boolean; watchDurationMinutes?: number },
  control: HTMLInputElement | HTMLSelectElement
): Promise<void> {
  if (!state) return;
  const previous = state.settings;
  control.disabled = true;
  try {
    state =
      patch.enabled !== undefined
        ? await sendRequest({ type: "SET_PLAN_MODE", enabled: patch.enabled })
        : await sendRequest({
            type: "SET_PLAN_MODE",
            watchDurationMinutes: patch.watchDurationMinutes
          });
    toast(state.settings.enabled ? "计划模式设置已更新" : "计划模式已暂停");
    renderPlan();
  } catch (error) {
    control.disabled = false;
    if (control instanceof HTMLInputElement && patch.enabled !== undefined) {
      control.checked = previous.enabled;
    }
    if (control instanceof HTMLSelectElement) control.value = String(previous.watchDurationMinutes);
    toast(describeError(error), "error");
  }
}

function createQueueCard(planState: PlanState): HTMLElement {
  const pending = sortedItems(planState, "pending");
  const completed = sortedItems(planState, "completed");
  const total = pending.length + completed.length;
  const completion = total > 0 ? Math.round((completed.length / total) * 100) : 0;

  return element("div", {
    className: "plan-main",
    children: [
      element("section", {
        className: "card plan-card",
        attrs: { "aria-labelledby": "plan-queue-title" },
        children: [
          element("div", {
            className: "plan-card__header",
            children: [
              element("div", {
                children: [
                  element("h2", { text: "观看队列", attrs: { id: "plan-queue-title" } }),
                  element("p", { text: "按顺序完成，一次只为真正要看的内容放行。" })
                ]
              }),
              createProgress(pending.length, completed.length, completion)
            ]
          }),
          createItemSection(
            "待办",
            "从第一项开始，也可以用上移、下移重新安排顺序。",
            pending,
            false
          ),
          createItemSection("已完成", "完成记录留在本机，可以恢复到待办或删除。", completed, true)
        ]
      })
    ]
  });
}

function createProgress(pending: number, completed: number, percentage: number): HTMLElement {
  const total = pending + completed;
  return element("div", {
    className: "plan-progress",
    attrs: {
      role: "progressbar",
      "aria-label": "观看计划完成进度",
      "aria-valuemin": "0",
      "aria-valuemax": String(total),
      "aria-valuenow": String(completed),
      "aria-valuetext": total > 0 ? `已完成 ${completed} 项，共 ${total} 项` : "还没有计划项"
    },
    children: [
      element("div", {
        className: "plan-progress__meta",
        children: [
          element("span", { className: "plan-progress__value", text: `${completed}/${total}` }),
          element("span", {
            className: "plan-progress__label",
            text: pending > 0 ? `还剩 ${pending} 项` : "全部完成"
          })
        ]
      }),
      element("div", {
        className: "plan-progress__track",
        attrs: { "aria-hidden": "true" },
        children: [
          element("div", {
            className: "plan-progress__bar",
            attrs: { style: `width: ${percentage}%` }
          })
        ]
      })
    ]
  });
}

function createItemSection(
  title: string,
  description: string,
  items: PlanItem[],
  completed: boolean
): HTMLElement {
  return element("section", {
    className: "plan-section",
    attrs: { "aria-labelledby": `plan-${completed ? "completed" : "pending"}-title` },
    children: [
      element("div", {
        className: "plan-section__header",
        children: [
          element("div", {
            children: [
              element("h2", {
                text: title,
                attrs: { id: `plan-${completed ? "completed" : "pending"}-title` }
              }),
              element("p", { text: description })
            ]
          }),
          element("span", {
            className: `plan-status-pill ${completed ? "plan-status-pill--success" : "plan-status-pill--neutral"}`,
            text: `${items.length} 项`
          })
        ]
      }),
      items.length > 0
        ? element("ol", {
            className: "plan-list",
            attrs: { "aria-label": completed ? "已完成视频" : "待观看视频" },
            children: items.map((item, index) => createPlanItem(item, index, items.length))
          })
        : createEmpty(completed)
    ]
  });
}

function createEmpty(completed: boolean): HTMLElement {
  return element("div", {
    className: "plan-empty",
    children: [
      element("div", {
        className: "plan-empty__inner",
        children: [
          element("span", {
            className: "plan-state__icon",
            children: [icon(completed ? "check" : "plus")]
          }),
          element("h3", { text: completed ? "还没有完成记录" : "队列还是空的" }),
          element("p", {
            text: completed
              ? "完成一个计划视频后，它会在这里留下打卡记录。"
              : "在右侧粘贴一个视频链接，给下一次打开 Bilibili 一个明确目标。"
          })
        ]
      })
    ]
  });
}

function createPlanItem(item: PlanItem, index: number, siblingCount: number): HTMLElement {
  const complete = item.status === "completed";
  const content =
    editingItemId === item.id
      ? createEditForm(item)
      : element("div", {
          className: "plan-item__content",
          children: [
            element("div", {
              className: "plan-item__topline",
              children: [
                element("div", {
                  children: [
                    element("h3", { className: "plan-item__title", text: item.title }),
                    element("span", {
                      className: "plan-item__url",
                      text: item.url,
                      attrs: { title: item.url }
                    })
                  ]
                }),
                element("span", {
                  className: "plan-item__position",
                  text: complete ? "已打卡" : `#${index + 1}`
                })
              ]
            }),
            element("div", {
              className: "plan-item__meta",
              children: [
                element("span", {
                  className: "plan-source-pill",
                  text: SOURCE_LABELS[item.source]
                }),
                element("span", { text: item.bvid }),
                element("span", {
                  text:
                    complete && item.completedAt
                      ? `${formatDateTime(item.completedAt)} 完成`
                      : `${formatDateTime(item.addedAt)} 添加`
                })
              ]
            }),
            createItemActions(item, index, siblingCount)
          ]
        });

  const completeButton = element("button", {
    className: "plan-item__check",
    attrs: {
      type: "button",
      title: complete ? "恢复到待办" : "标记为已完成",
      "aria-label": complete ? `将“${item.title}”恢复到待办` : `将“${item.title}”标记为已完成`,
      "aria-pressed": complete
    },
    children: [icon(complete ? "check" : "plus")]
  });
  completeButton.addEventListener("click", () => {
    void setCompleted(item, !complete, completeButton);
  });

  return element("li", {
    className: `plan-item${complete ? " plan-item--complete" : ""}`,
    attrs: { tabindex: "-1" },
    dataset: { planItemId: item.id },
    children: [completeButton, content]
  });
}

function createItemActions(item: PlanItem, index: number, siblingCount: number): HTMLElement {
  const complete = item.status === "completed";
  const actions: HTMLElement[] = [];

  if (!complete) {
    const start = element("button", {
      className: "btn btn--primary",
      attrs: { type: "button", "data-testid": `plan-start-${item.id}` },
      children: [icon("play"), "开始观看"]
    });
    start.addEventListener("click", () => void startWatching(item, start));
    actions.push(
      start,
      createMoveButton(item, "up", index === 0),
      createMoveButton(item, "down", index === siblingCount - 1)
    );
  } else {
    const restore = element("button", {
      className: "btn btn--soft",
      attrs: { type: "button" },
      children: [icon("refresh"), "恢复到待办"]
    });
    restore.addEventListener("click", () => void setCompleted(item, false, restore));
    actions.push(restore);
  }

  const edit = element("button", {
    className: "btn btn--icon",
    attrs: { type: "button", title: "编辑", "aria-label": `编辑“${item.title}”` },
    children: [icon("edit")]
  });
  edit.addEventListener("click", () => {
    editingItemId = item.id;
    renderPlan({ focusItemId: item.id });
    document.querySelector<HTMLInputElement>(`#plan-title-${cssEscape(item.id)}`)?.focus();
  });

  const remove = element("button", {
    className: "btn btn--icon btn--danger",
    attrs: { type: "button", title: "删除", "aria-label": `删除“${item.title}”` },
    children: [icon("trash")]
  });
  remove.addEventListener("click", () => void deleteItem(item, remove));
  actions.push(edit, remove);

  return element("div", { className: "plan-item__actions", children: actions });
}

function createMoveButton(
  item: PlanItem,
  direction: "up" | "down",
  disabled: boolean
): HTMLButtonElement {
  const label = direction === "up" ? "上移" : "下移";
  const button = element("button", {
    className: "btn btn--icon plan-move-button",
    attrs: {
      type: "button",
      title: label,
      "aria-label": `${label}“${item.title}”`,
      disabled,
      "data-direction": direction
    },
    children: [icon("chevron")]
  });
  button.addEventListener("click", () => void moveItem(item, direction, button));
  return button;
}

function createEditForm(item: PlanItem): HTMLElement {
  const title = element("input", {
    className: "plan-input",
    attrs: {
      id: `plan-title-${item.id}`,
      type: "text",
      value: item.title,
      maxlength: MAX_PLAN_TITLE_LENGTH,
      required: true
    }
  });
  const url = element("input", {
    className: "plan-input",
    attrs: { type: "url", value: item.url, maxlength: "500", required: true, inputmode: "url" }
  });
  const save = element("button", {
    className: "btn btn--primary",
    text: "保存",
    attrs: { type: "submit" }
  });
  const cancel = element("button", { className: "btn", text: "取消", attrs: { type: "button" } });
  cancel.addEventListener("click", () => {
    editingItemId = null;
    renderPlan({ focusItemId: item.id });
  });

  const form = element("form", {
    className: "plan-edit-form",
    attrs: { "aria-label": `编辑“${item.title}”` },
    children: [
      element("label", {
        className: "plan-field",
        children: [element("span", { text: "标题" }), title]
      }),
      element("label", {
        className: "plan-field",
        children: [element("span", { text: "视频链接" }), url]
      }),
      element("div", { className: "plan-form__actions", children: [save, cancel] })
    ]
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void updateItem(item, title.value, url.value, save);
  });
  return form;
}

async function startWatching(item: PlanItem, button: HTMLButtonElement): Promise<void> {
  setButtonBusy(button, true, "准备中…");
  try {
    const result = await sendRequest({ type: "START_PLAN_ITEM", id: item.id });
    state = result.state;
    window.location.assign(result.url);
  } catch (error) {
    setButtonBusy(button, false);
    toast(describeError(error), "error");
  }
}

async function setCompleted(
  item: PlanItem,
  completed: boolean,
  control: HTMLButtonElement
): Promise<void> {
  control.disabled = true;
  try {
    state = await sendRequest({ type: "SET_PLAN_ITEM_COMPLETED", id: item.id, completed });
    editingItemId = null;
    toast(completed ? "已完成打卡" : "已恢复到待办");
    renderPlan({ focusItemId: item.id });
  } catch (error) {
    control.disabled = false;
    toast(describeError(error), "error");
  }
}

async function moveItem(
  item: PlanItem,
  direction: "up" | "down",
  control: HTMLButtonElement
): Promise<void> {
  control.disabled = true;
  try {
    state = await sendRequest({ type: "MOVE_PLAN_ITEM", id: item.id, direction });
    toast(direction === "up" ? "已上移" : "已下移");
    renderPlan({ focusItemId: item.id });
  } catch (error) {
    control.disabled = false;
    toast(describeError(error), "error");
  }
}

async function updateItem(
  item: PlanItem,
  titleValue: string,
  urlValue: string,
  button: HTMLButtonElement
): Promise<void> {
  const title = titleValue.trim();
  const url = urlValue.trim();
  if (!title || !url) {
    toast("请填写标题和视频链接", "error");
    return;
  }
  setButtonBusy(button, true, "保存中…");
  try {
    state = await sendRequest({ type: "UPDATE_PLAN_ITEM", id: item.id, patch: { title, url } });
    editingItemId = null;
    toast("计划项已更新");
    renderPlan({ focusItemId: item.id });
  } catch (error) {
    setButtonBusy(button, false);
    toast(describeError(error), "error");
  }
}

async function deleteItem(item: PlanItem, button: HTMLButtonElement): Promise<void> {
  if (!window.confirm(`确定删除“${item.title}”吗？此操作不会影响 Bilibili 上的视频。`)) return;
  button.disabled = true;
  try {
    state = await sendRequest({ type: "DELETE_PLAN_ITEM", id: item.id });
    editingItemId = null;
    toast("已从计划中删除");
    renderPlan({ focusAddForm: true });
  } catch (error) {
    button.disabled = false;
    toast(describeError(error), "error");
  }
}

function createAside(): HTMLElement {
  return element("aside", {
    className: "plan-aside",
    attrs: { "aria-label": "添加与导入视频" },
    children: [createAddCard(), createImportCard()]
  });
}

function createAddCard(): HTMLElement {
  const url = element("input", {
    className: "plan-input",
    attrs: {
      id: "plan-video-url",
      type: "url",
      inputmode: "url",
      autocomplete: "off",
      maxlength: "500",
      placeholder: "https://www.bilibili.com/video/BV…",
      required: true,
      "aria-describedby": "plan-url-hint plan-url-error",
      "data-testid": "plan-add-url"
    }
  });
  const title = element("input", {
    className: "plan-input",
    attrs: {
      id: "plan-video-title",
      type: "text",
      autocomplete: "off",
      maxlength: MAX_PLAN_TITLE_LENGTH,
      placeholder: "可选；留空会使用 BV 号",
      "data-testid": "plan-add-title"
    }
  });
  const error = element("p", {
    className: "plan-field__error",
    attrs: { id: "plan-url-error", role: "alert", hidden: true }
  });
  const submit = element("button", {
    className: "btn btn--primary",
    attrs: { type: "submit", "data-testid": "plan-add-submit" },
    children: [icon("plus"), "加入待办"]
  });
  const form = element("form", {
    className: "plan-form",
    attrs: { novalidate: true },
    children: [
      element("div", {
        className: "plan-card__header",
        children: [
          element("div", {
            children: [
              element("h2", { text: "添加一个视频" }),
              element("p", { text: "只接受 Bilibili 视频链接。" })
            ]
          }),
          element("span", { className: "plan-status-pill", text: "本地保存" })
        ]
      }),
      element("div", {
        className: "plan-field",
        children: [
          element("label", { text: "视频链接", attrs: { for: "plan-video-url" } }),
          url,
          element("p", {
            className: "plan-field__hint",
            text: "支持 bilibili.com/video/BV… 链接",
            attrs: { id: "plan-url-hint" }
          }),
          error
        ]
      }),
      element("div", {
        className: "plan-field",
        children: [
          element("label", { text: "自定义标题", attrs: { for: "plan-video-title" } }),
          title
        ]
      }),
      element("div", { className: "plan-form__actions", children: [submit] }),
      element("p", {
        className: "plan-form__note",
        text: "添加后可编辑、排序或删除，不会修改你的 Bilibili 数据。"
      })
    ]
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.hidden = true;
    url.removeAttribute("aria-invalid");
    void addItem(url, title, error, submit);
  });

  return element("section", { className: "card plan-card", children: [form] });
}

async function addItem(
  urlInput: HTMLInputElement,
  titleInput: HTMLInputElement,
  error: HTMLElement,
  submit: HTMLButtonElement
): Promise<void> {
  const url = urlInput.value.trim();
  const title = titleInput.value.trim();
  if (!url) {
    showFieldError(urlInput, error, "请粘贴一个 Bilibili 视频链接");
    return;
  }
  setButtonBusy(submit, true, "正在添加…");
  try {
    state = await sendRequest({ type: "ADD_PLAN_ITEM", url, ...(title ? { title } : {}) });
    editingItemId = null;
    toast("已加入观看待办");
    renderPlan({ focusAddForm: true });
  } catch (caught) {
    setButtonBusy(submit, false);
    showFieldError(urlInput, error, describeError(caught));
  }
}

function showFieldError(input: HTMLInputElement, output: HTMLElement, message: string): void {
  input.setAttribute("aria-invalid", "true");
  output.textContent = message;
  output.hidden = false;
  input.focus();
}

function createImportCard(): HTMLElement {
  const bulk = element("button", {
    className: "btn btn--primary btn--block",
    attrs: { type: "button", "data-testid": "plan-bulk-import" },
    children: [icon("plus"), "批量粘贴视频链接"]
  });
  bulk.addEventListener("click", openBulkImportDialog);

  const unavailableMessage = "需要由维护者配置 Bilibili 官方开放平台授权后才能使用";
  const connectionLabel =
    importStatus?.state === "authorization-required"
      ? "等待官方授权"
      : importStatus?.state === "ready"
        ? "官方服务已就绪"
        : "官方接入待配置";
  const connectionMessage =
    importStatus?.state === "not-configured"
      ? importStatus.message
      : "稍后再看与收藏夹同步需要 Bilibili 官方开放平台应用资质、用户授权与服务端支持。当前版本不会读取 Cookie 或网页登录状态。";
  const providerActionUrl =
    importStatus?.state === "not-configured"
      ? importStatus.setupUrl
      : importStatus?.state === "authorization-required"
        ? importStatus.authorizationUrl
        : null;
  const watchLater = element("button", {
    className: "btn",
    text: "从稍后再看导入",
    attrs: {
      type: "button",
      disabled: true,
      title: unavailableMessage,
      "aria-describedby": "official-import-note"
    }
  });
  const favorite = element("button", {
    className: "btn",
    text: "从收藏夹导入",
    attrs: {
      type: "button",
      disabled: true,
      title: unavailableMessage,
      "aria-describedby": "official-import-note"
    }
  });

  return element("section", {
    className: "card plan-card plan-import-card",
    attrs: { "aria-labelledby": "plan-import-title" },
    children: [
      element("div", {
        className: "plan-import-card__intro",
        children: [
          element("span", { className: "plan-import-card__icon", children: [icon("refresh")] }),
          element("div", {
            children: [
              element("h2", { text: "批量建立计划", attrs: { id: "plan-import-title" } }),
              element("p", { text: "先用本地批量粘贴；官方授权接入配置完成后可扩展账号来源。" })
            ]
          })
        ]
      }),
      element("div", {
        className: "plan-connection plan-connection--error",
        children: [
          element("div", {
            className: "plan-connection__status",
            children: [
              element("span", { className: "plan-connection__dot" }),
              element("strong", { text: connectionLabel })
            ]
          }),
          element("p", {
            text: connectionMessage,
            attrs: { id: "official-import-note" }
          }),
          providerActionUrl
            ? element("a", {
                className: "plan-connection__link",
                attrs: {
                  href: providerActionUrl,
                  target: "_blank",
                  rel: "noreferrer"
                },
                children: ["了解官方接入要求", icon("external")]
              })
            : null
        ]
      }),
      bulk,
      element("div", { className: "plan-import-actions", children: [watchLater, favorite] }),
      element("div", {
        className: "plan-privacy-note",
        children: [
          icon("shield"),
          element("span", {
            text: "BiliPace 不会要求或保存 Bilibili 密码。未来官方接入也必须通过明确授权，且不会把应用密钥打包进扩展。"
          })
        ]
      })
    ]
  });
}

function openBulkImportDialog(): void {
  const textarea = element("textarea", {
    className: "plan-input plan-bulk-textarea",
    attrs: {
      rows: "8",
      maxlength: "100000",
      placeholder: "每行一个链接，或：\n视频标题 | https://www.bilibili.com/video/BV…",
      "aria-label": "批量视频链接",
      "aria-describedby": "plan-bulk-hint plan-bulk-error"
    }
  });
  const error = element("p", {
    className: "plan-field__error",
    attrs: { id: "plan-bulk-error", role: "alert", hidden: true }
  });
  const preview = element("div", { className: "plan-import-preview" });
  const parse = element("button", {
    className: "btn btn--soft",
    attrs: { type: "button" },
    children: [icon("refresh"), "检查链接"]
  });
  const importButton = element("button", {
    className: "btn btn--primary",
    text: "导入所选",
    attrs: { type: "button", disabled: true }
  });
  const close = element("button", { className: "btn", text: "取消", attrs: { type: "button" } });
  const iconClose = element("button", {
    className: "btn btn--icon",
    attrs: { type: "button", title: "关闭", "aria-label": "关闭批量导入" },
    children: [icon("close")]
  });

  const dialog = element("dialog", {
    className: "plan-dialog",
    attrs: { "aria-labelledby": "plan-bulk-title" },
    children: [
      element("div", {
        className: "plan-dialog__surface",
        children: [
          element("header", {
            className: "plan-dialog__header",
            children: [
              element("div", {
                children: [
                  element("h2", { text: "批量粘贴视频", attrs: { id: "plan-bulk-title" } }),
                  element("p", { text: "链接只在本机解析；确认勾选后才会加入计划。" })
                ]
              }),
              iconClose
            ]
          }),
          element("div", {
            className: "plan-dialog__body",
            children: [
              element("div", {
                className: "plan-field",
                children: [
                  element("label", { text: "视频清单", attrs: { for: "plan-bulk-input" } }),
                  textarea,
                  element("p", {
                    className: "plan-field__hint",
                    text: "支持“链接”或“标题 | 链接”，每行一项；重复 BV 号会自动合并。",
                    attrs: { id: "plan-bulk-hint" }
                  }),
                  error
                ]
              }),
              element("div", {
                className: "plan-form__actions plan-bulk-parse",
                children: [parse]
              }),
              preview
            ]
          }),
          element("footer", { className: "plan-dialog__footer", children: [close, importButton] })
        ]
      })
    ]
  });
  textarea.id = "plan-bulk-input";

  let parsedItems: PlanItemInput[] = [];
  parse.addEventListener("click", () => {
    const result = parseManualBilibiliImport(textarea.value);
    parsedItems = result.items;
    renderImportPreview(
      preview,
      parsedItems,
      result.rejected.length,
      result.duplicateCount,
      importButton
    );
    error.hidden = parsedItems.length > 0;
    error.textContent =
      parsedItems.length > 0
        ? ""
        : result.truncated
          ? "输入过长，且没有找到有效的 Bilibili 视频链接"
          : "没有找到有效的 Bilibili 视频链接";
  });
  importButton.addEventListener("click", () => {
    const selectedIds = new Set(
      Array.from(preview.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map(
        (input) => input.value
      )
    );
    const selected = parsedItems.filter((item) => item.bvid && selectedIds.has(item.bvid));
    void importItems(selected, importButton, dialog);
  });
  const closeDialog = () => dialog.close();
  close.addEventListener("click", closeDialog);
  iconClose.addEventListener("click", closeDialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  textarea.focus();
}

function renderImportPreview(
  container: HTMLElement,
  items: PlanItemInput[],
  invalidCount: number,
  duplicateCount: number,
  importButton: HTMLButtonElement
): void {
  if (items.length === 0) {
    container.replaceChildren();
    importButton.disabled = true;
    return;
  }

  const selectionCount = element("span", { text: `已选择 ${items.length} 项` });
  const selectAll = element("button", {
    className: "btn",
    text: "取消全选",
    attrs: { type: "button" }
  });
  const checkboxes = items.map((item) =>
    element("input", {
      attrs: {
        type: "checkbox",
        value: item.bvid,
        checked: true,
        "aria-label": `选择${item.title ?? item.bvid ?? "视频"}`
      }
    })
  );
  const refreshCount = () => {
    const selected = checkboxes.filter((checkbox) => checkbox.checked).length;
    selectionCount.textContent = `已选择 ${selected} 项`;
    importButton.disabled = selected === 0;
    selectAll.textContent = selected === checkboxes.length ? "取消全选" : "全选";
  };
  checkboxes.forEach((checkbox) => checkbox.addEventListener("change", refreshCount));
  selectAll.addEventListener("click", () => {
    const shouldSelect = checkboxes.some((checkbox) => !checkbox.checked);
    checkboxes.forEach((checkbox) => {
      checkbox.checked = shouldSelect;
    });
    refreshCount();
  });

  const notes: string[] = [];
  if (duplicateCount > 0) notes.push(`已合并 ${duplicateCount} 个重复项`);
  if (invalidCount > 0) notes.push(`${invalidCount} 行未识别`);
  const list = element("ul", {
    className: "plan-selection-list",
    children: items.map((item, index) =>
      element("li", {
        children: [
          element("label", {
            className: "plan-selection-item",
            children: [
              checkboxes[index],
              element("span", {
                children: [
                  element("span", {
                    className: "plan-selection-item__title",
                    text: item.title || item.bvid || "Bilibili 视频"
                  }),
                  element("span", { className: "plan-selection-item__meta", text: item.url })
                ]
              })
            ]
          })
        ]
      })
    )
  });
  container.replaceChildren(
    element("div", {
      className: "plan-selection-bar",
      children: [
        element("span", {
          children: [
            selectionCount,
            ...(notes.length > 0 ? [element("small", { text: ` · ${notes.join(" · ")}` })] : [])
          ]
        }),
        selectAll
      ]
    }),
    list
  );
  refreshCount();
}

async function importItems(
  items: PlanItemInput[],
  button: HTMLButtonElement,
  dialog: HTMLDialogElement
): Promise<void> {
  if (items.length === 0) return;
  setButtonBusy(button, true, "正在导入…");
  let addedCount = 0;
  let skippedCount = 0;
  try {
    for (let offset = 0; offset < items.length; offset += MAX_PLAN_IMPORT_ITEMS) {
      const batch = items.slice(offset, offset + MAX_PLAN_IMPORT_ITEMS);
      const result = await sendRequest({
        type: "IMPORT_PLAN_ITEMS",
        items: batch,
        source: "manual"
      });
      state = result.state;
      addedCount += result.addedCount;
      skippedCount += result.skippedCount;
    }
    dialog.close();
    toast(
      skippedCount > 0
        ? `已导入 ${addedCount} 项，跳过 ${skippedCount} 个重复项`
        : `已导入 ${addedCount} 项`
    );
    renderPlan();
  } catch (error) {
    setButtonBusy(button, false);
    toast(
      addedCount > 0
        ? `已导入 ${addedCount} 项；后续导入中断。${describeError(error)}`
        : describeError(error),
      "error"
    );
    if (addedCount > 0) {
      dialog.close();
      renderPlan();
    }
  }
}

function sortedItems(planState: PlanState, status: "pending" | "completed"): PlanItem[] {
  return planState.queue.items
    .filter((item) => item.status === status)
    .sort((first, second) =>
      status === "completed"
        ? (second.completedAt ?? 0) - (first.completedAt ?? 0)
        : first.order - second.order
    );
}

function formatDateTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(timestamp));
  } catch {
    return "本地时间";
  }
}

function createFooter(): HTMLElement {
  return element("footer", {
    className: "plan-footer",
    children: [
      element("span", { text: "BiliPace 非哔哩哔哩官方产品" }),
      element("span", { text: "计划与标题仅保存在当前浏览器" })
    ]
  });
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/gu, "\\$&");
}
