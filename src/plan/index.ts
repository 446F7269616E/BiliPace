import { sendRequest } from "../shared/messages";
import { MAX_PLAN_IMPORT_ITEMS, MAX_PLAN_TITLE_LENGTH } from "../shared/plan";
import type { PlanItem, PlanItemInput, PlanItemSource, PlanState } from "../shared/types";
import { assertAppRoot, describeError, element, icon, setButtonBusy, toast } from "../styles/dom";
import { createPageNavigation } from "../ui/page-navigation";

const SOURCE_LABELS: Readonly<Record<PlanItemSource, string>> = {
  manual: "手动添加",
  "watch-later": "稍后再看",
  favorite: "收藏夹"
};

const WATCH_DURATIONS = [15, 30, 45, 60, 90, 120] as const;
const PLAN_VIEW_STORAGE_KEY = "hourleaf.plan.view";
type PlanView = "list" | "mindmap";

const app = assertAppRoot();
let state: PlanState | null = null;
let editingItemId: string | null = null;
let planView: PlanView = readPlanView();

document.body.classList.add("plan-page");
void loadPlan();

async function loadPlan(): Promise<void> {
  renderLoading();
  try {
    state = await sendRequest({ type: "GET_PLAN_STATE" });
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
        attrs: { "aria-busy": "true", "aria-label": "正在加载计划" },
        children: [
          element("div", {
            className: "plan-state__inner",
            children: [
              element("div", { className: "plan-state__icon", children: [icon("calendar")] }),
              element("h2", { text: "正在加载计划" }),
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
              element("h2", { text: "计划加载失败" }),
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
      })
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
      createPageNavigation({ currentPage: "plan" }),
      element("header", {
        className: "plan-heading",
        children: [
          element("div", {
            children: [element("h1", { className: "page-title", text: "计划" })]
          }),
          createViewControl()
        ]
      }),
      content
    ]
  });
}

function createViewControl(): HTMLElement {
  const views: ReadonlyArray<{ id: PlanView; label: string }> = [
    { id: "list", label: "列表" },
    { id: "mindmap", label: "思维导图" }
  ];
  return element("div", {
    className: "plan-view-control segmented",
    attrs: { role: "group", "aria-label": "计划视图" },
    children: views.map(({ id, label }) => {
      const button = element("button", {
        className: "segmented__item plan-view-control__button",
        text: label,
        attrs: {
          type: "button",
          "aria-pressed": id === planView,
          "data-plan-view": id
        }
      });
      button.addEventListener("click", () => {
        if (planView === id) return;
        planView = id;
        writePlanView(id);
        renderPlan();
      });
      return button;
    })
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
      "aria-label": "每次可观看时长",
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
                text: "计划模式",
                attrs: { id: "plan-mode-title" }
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
            children: [element("span", { text: "每次可看多久" }), durationSelect]
          }),
          element("span", {
            className: "plan-mode-card__state",
            text: planState.settings.enabled ? "已开启" : "已关闭",
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
  const timeSortedPending = [...pending].sort(
    (first, second) => first.addedAt - second.addedAt || first.order - second.order
  );
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
                children: [element("h2", { text: "待办", attrs: { id: "plan-queue-title" } })]
              }),
              createProgress(pending.length, completed.length, completion)
            ]
          }),
          planView === "list"
            ? createItemSection("待办", timeSortedPending, false, "list")
            : createMindmap(pending),
          createItemSection("已完成", completed, true, "list")
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
      "aria-label": "计划完成进度",
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
            text: pending > 0 ? `待办 ${pending} 项` : "全部完成"
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
  items: PlanItem[],
  completed: boolean,
  variant: PlanView
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
              })
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
            attrs: { "aria-label": completed ? "已完成内容" : "待办内容" },
            children: items.map((item, index) => createPlanItem(item, index, items.length, variant))
          })
        : createEmpty(completed)
    ]
  });
}

function createMindmap(items: PlanItem[]): HTMLElement {
  return element("section", {
    className: "plan-section plan-mindmap",
    attrs: { "aria-labelledby": "plan-pending-title" },
    children: [
      items.length > 0
        ? element("div", {
            className: "plan-mindmap__canvas",
            children: [
              element("div", {
                className: "plan-mindmap__root",
                text: "待办",
                attrs: { id: "plan-pending-title" }
              }),
              element("ol", {
                className: "plan-mindmap__track",
                attrs: { "aria-label": "可排序的计划节点" },
                children: items.map((item, index) =>
                  createPlanItem(item, index, items.length, "mindmap")
                )
              })
            ]
          })
        : createEmpty(false)
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
          element("h3", { text: completed ? "暂无完成记录" : "暂无待办" })
        ]
      })
    ]
  });
}

function createPlanItem(
  item: PlanItem,
  index: number,
  siblingCount: number,
  variant: PlanView
): HTMLElement {
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
                ...(item.bvid ? [element("span", { text: item.bvid })] : []),
                element("span", {
                  text:
                    complete && item.completedAt
                      ? `${formatDateTime(item.completedAt)} 完成`
                      : `${formatDateTime(item.addedAt)} 添加`
                })
              ]
            }),
            createItemActions(item, index, siblingCount, variant)
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

  const itemElement = element("li", {
    className: `plan-item${complete ? " plan-item--complete" : ""}${variant === "mindmap" ? " plan-item--mindmap" : ""}`,
    attrs: {
      tabindex: "-1",
      draggable: variant === "mindmap" && !complete ? "true" : undefined,
      ...(variant === "mindmap" && !complete ? { "aria-grabbed": "false" } : {})
    },
    dataset: { planItemId: item.id },
    children: [completeButton, content]
  });
  if (variant === "mindmap" && !complete) enableMindmapDrag(itemElement, item);
  return itemElement;
}

function createItemActions(
  item: PlanItem,
  index: number,
  siblingCount: number,
  variant: PlanView
): HTMLElement {
  const complete = item.status === "completed";
  const actions: HTMLElement[] = [];

  if (!complete) {
    const start = element("button", {
      className: "btn btn--primary",
      attrs: { type: "button", "data-testid": `plan-start-${item.id}` },
      children: [icon("play"), "开始"]
    });
    start.addEventListener("click", () => void startWatching(item, start));
    actions.push(start);
    if (variant === "mindmap") {
      actions.push(
        createMoveButton(item, "up", index === 0),
        createMoveButton(item, "down", index === siblingCount - 1)
      );
    }
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
  const label = direction === "up" ? "前移" : "后移";
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
  button.addEventListener("click", () => void moveMindmapItem(item, direction, button));
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
        children: [element("span", { text: "内容链接" }), url]
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
    toast(completed ? "已完成" : "已恢复到待办");
    renderPlan({ focusItemId: item.id });
  } catch (error) {
    control.disabled = false;
    toast(describeError(error), "error");
  }
}

async function moveMindmapItem(
  item: PlanItem,
  direction: "up" | "down",
  control: HTMLButtonElement
): Promise<void> {
  if (!state) return;
  const pending = sortedItems(state, "pending");
  const index = pending.findIndex((candidate) => candidate.id === item.id);
  const target = pending[index + (direction === "up" ? -1 : 1)];
  if (!target) return;
  control.disabled = true;
  await reorderMindmapItems(item.id, target.id, direction === "up" ? "before" : "after");
  control.disabled = false;
}

function enableMindmapDrag(itemElement: HTMLLIElement, item: PlanItem): void {
  itemElement.addEventListener("dragstart", (event) => {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
    itemElement.classList.add("plan-item--dragging");
    itemElement.setAttribute("aria-grabbed", "true");
  });
  itemElement.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (!event.dataTransfer) return;
    event.dataTransfer.dropEffect = "move";
    const position = getDropPosition(itemElement, event.clientX);
    itemElement.classList.toggle("plan-item--drop-before", position === "before");
    itemElement.classList.toggle("plan-item--drop-after", position === "after");
  });
  itemElement.addEventListener("dragleave", (event) => {
    if (event.relatedTarget instanceof Node && itemElement.contains(event.relatedTarget)) return;
    clearDropState(itemElement);
  });
  itemElement.addEventListener("drop", (event) => {
    event.preventDefault();
    const sourceId = event.dataTransfer?.getData("text/plain");
    const position = getDropPosition(itemElement, event.clientX);
    clearDropState(itemElement);
    if (!sourceId || sourceId === item.id) return;
    void reorderMindmapItems(sourceId, item.id, position);
  });
  itemElement.addEventListener("dragend", () => {
    itemElement.classList.remove("plan-item--dragging");
    itemElement.setAttribute("aria-grabbed", "false");
    document
      .querySelectorAll<HTMLElement>(".plan-item--drop-before, .plan-item--drop-after")
      .forEach(clearDropState);
  });
}

function getDropPosition(element: HTMLElement, pointerX: number): "before" | "after" {
  const bounds = element.getBoundingClientRect();
  return pointerX < bounds.left + bounds.width / 2 ? "before" : "after";
}

function clearDropState(element: HTMLElement): void {
  element.classList.remove("plan-item--drop-before", "plan-item--drop-after");
}

async function reorderMindmapItems(
  sourceId: string,
  targetId: string,
  position: "before" | "after"
): Promise<void> {
  if (!state) return;
  const orderedItems = [...state.queue.items].sort((first, second) => first.order - second.order);
  const pending = orderedItems.filter((item) => item.status === "pending");
  const source = pending.find((item) => item.id === sourceId);
  if (!source || !pending.some((item) => item.id === targetId)) return;

  const reorderedPending = pending.filter((item) => item.id !== sourceId);
  const targetIndex = reorderedPending.findIndex((item) => item.id === targetId);
  reorderedPending.splice(targetIndex + (position === "after" ? 1 : 0), 0, source);

  let pendingIndex = 0;
  const orderedIds = orderedItems.map((item) =>
    item.status === "pending" ? (reorderedPending[pendingIndex++]?.id ?? item.id) : item.id
  );
  try {
    state = await sendRequest({ type: "REORDER_PLAN_ITEMS", orderedIds });
    toast("顺序已更新");
    renderPlan({ focusItemId: sourceId });
  } catch (error) {
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
    toast("请填写标题和内容链接", "error");
    return;
  }
  setButtonBusy(button, true, "保存中…");
  try {
    state = await sendRequest({ type: "UPDATE_PLAN_ITEM", id: item.id, patch: { title, url } });
    editingItemId = null;
    toast("更改已保存");
    renderPlan({ focusItemId: item.id });
  } catch (error) {
    setButtonBusy(button, false);
    toast(describeError(error), "error");
  }
}

async function deleteItem(item: PlanItem, button: HTMLButtonElement): Promise<void> {
  if (!window.confirm(`确定删除“${item.title}”吗？此操作不会影响原网站上的内容。`)) return;
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
    attrs: { "aria-label": "添加与导入计划内容" },
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
      placeholder: "粘贴内容链接",
      required: true,
      "aria-describedby": "plan-url-error",
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
      placeholder: "可选；留空使用内容 ID",
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
            children: [element("h2", { text: "添加待办" })]
          }),
          element("span", { className: "plan-status-pill", text: "本地保存" })
        ]
      }),
      element("div", {
        className: "plan-field",
        children: [
          element("label", { text: "内容链接", attrs: { for: "plan-video-url" } }),
          url,
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
      element("div", { className: "plan-form__actions", children: [submit] })
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
    showFieldError(urlInput, error, "当前站点模块不支持此链接");
    return;
  }
  setButtonBusy(submit, true, "正在添加…");
  try {
    state = await sendRequest({ type: "ADD_PLAN_ITEM", url, ...(title ? { title } : {}) });
    editingItemId = null;
    toast("已加入待办");
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
    children: [icon("plus"), "批量粘贴内容链接"]
  });
  bulk.addEventListener("click", openBulkImportDialog);

  return element("section", {
    className: "card plan-card plan-import-card",
    attrs: { "aria-labelledby": "plan-import-title" },
    children: [
      element("div", {
        className: "plan-import-card__intro",
        children: [
          element("span", { className: "plan-import-card__icon", children: [icon("refresh")] }),
          element("div", {
            children: [element("h2", { text: "批量添加", attrs: { id: "plan-import-title" } })]
          })
        ]
      }),
      bulk
    ]
  });
}

function openBulkImportDialog(): void {
  const textarea = element("textarea", {
    className: "plan-input plan-bulk-textarea",
    attrs: {
      rows: "8",
      maxlength: "100000",
      placeholder: "每行一个链接，或：\n标题 | 内容链接",
      "aria-label": "批量内容链接",
      "aria-describedby": "plan-bulk-error"
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
                  element("h2", { text: "批量粘贴内容", attrs: { id: "plan-bulk-title" } })
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
                  element("label", { text: "内容清单", attrs: { for: "plan-bulk-input" } }),
                  textarea,
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
    const result = parsePlanImport(textarea.value);
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
          ? "输入过长，且没有找到有效链接"
          : "没有找到有效链接";
  });
  importButton.addEventListener("click", () => {
    const selectedIds = new Set(
      Array.from(preview.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map(
        (input) => input.value
      )
    );
    const selected = parsedItems.filter((item) => item.url && selectedIds.has(item.url));
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
        value: item.url,
        checked: true,
        "aria-label": `选择${item.title ?? item.url ?? "计划内容"}`
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
                    text: item.title || item.url || "计划内容"
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

function parsePlanImport(value: string): {
  items: PlanItemInput[];
  rejected: string[];
  duplicateCount: number;
  truncated: boolean;
} {
  const maxInputLength = 100_000;
  const truncated = value.length > maxInputLength;
  const lines = value.slice(0, maxInputLength).split(/\r?\n/u);
  const items: PlanItemInput[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = parsePlanImportLine(line);
    if (!parsed) {
      rejected.push(line);
      continue;
    }
    if (seen.has(parsed.url)) {
      duplicateCount += 1;
      continue;
    }
    if (items.length >= MAX_PLAN_IMPORT_ITEMS) {
      rejected.push(line);
      continue;
    }
    seen.add(parsed.url);
    items.push(parsed);
  }
  return { items, rejected, duplicateCount, truncated };
}

function parsePlanImportLine(
  line: string
): (PlanItemInput & { url: string; source: "manual" }) | null {
  const markdown = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/iu.exec(line);
  let title = markdown?.[1]?.trim() ?? "";
  let rawUrl = markdown?.[2] ?? "";

  if (!rawUrl) {
    const separator = line.lastIndexOf("|");
    if (separator >= 0) {
      title = line.slice(0, separator).trim();
      rawUrl = line.slice(separator + 1).trim();
    } else {
      rawUrl = line;
    }
  }

  try {
    const url = new URL(rawUrl);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    url.hash = "";
    const normalizedTitle = title.slice(0, MAX_PLAN_TITLE_LENGTH) || url.hostname;
    return { url: url.href, title: normalizedTitle, source: "manual" };
  } catch {
    return null;
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

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/gu, "\\$&");
}

function readPlanView(): PlanView {
  try {
    return window.localStorage.getItem(PLAN_VIEW_STORAGE_KEY) === "mindmap" ? "mindmap" : "list";
  } catch {
    return "list";
  }
}

function writePlanView(view: PlanView): void {
  try {
    window.localStorage.setItem(PLAN_VIEW_STORAGE_KEY, view);
  } catch {
    // The selected view remains active for this page session.
  }
}
