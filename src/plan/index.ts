import { sendRequest } from "../shared/messages";
import { permissionsRequest } from "../shared/browser";
import {
  configureLocale,
  getResolvedLocale,
  localizeDocumentTitle,
  t,
  type MessageKey
} from "../shared/i18n";
import {
  MAX_PLAN_DURATION_MINUTES,
  MAX_PLAN_IMPORT_ITEMS,
  MAX_PLAN_TITLE_LENGTH,
  MIN_PLAN_DURATION_MINUTES
} from "../shared/plan";
import type {
  PlanCompletionMode,
  PlanItem,
  PlanItemInput,
  PlanItemSource,
  PlanState
} from "../shared/types";
import { assertAppRoot, describeError, element, icon, setButtonBusy, toast } from "../styles/dom";
import { createPageNavigation } from "../ui/page-navigation";
import {
  fitMindmapTransform,
  getMindmapConnectorMetrics,
  MAX_MINDMAP_SCALE,
  MIN_MINDMAP_SCALE,
  type MindmapTransform,
  zoomMindmapAt
} from "./mindmap-viewport";

const SOURCE_LABEL_KEYS: Readonly<Record<PlanItemSource, MessageKey>> = {
  manual: "plan.source.manual",
  "watch-later": "plan.source.watchLater",
  favorite: "plan.source.favorite"
};

const COMPLETION_MODE_LABEL_KEYS: Readonly<Record<PlanCompletionMode, MessageKey>> = {
  lenient: "options.mode.lenient",
  flow: "options.mode.flow",
  strict: "options.mode.strict"
} as const;

const COMPLETION_MODE_DESCRIPTION_KEYS: Readonly<Record<PlanCompletionMode, MessageKey>> = {
  lenient: "options.mode.lenientDescription",
  flow: "options.mode.flowDescription",
  strict: "options.mode.strictDescription"
} as const;

const PLAN_VIEW_STORAGE_KEY = "hourleaf.plan.view";
type PlanView = "list" | "mindmap";

const app = assertAppRoot();
let state: PlanState | null = null;
let editingItemId: string | null = null;
let planView: PlanView = readPlanView();
let completedExpanded = false;
let mindmapTransform: MindmapTransform | null = null;
let mindmapContentSignature: string | null = null;
let cleanupMindmap: (() => void) | null = null;

document.body.classList.add("plan-page");
configureLocale("system");
void loadPlan();

async function loadPlan(): Promise<void> {
  renderLoading();
  try {
    const [planState, settings] = await Promise.all([
      sendRequest({ type: "GET_PLAN_STATE" }),
      sendRequest({ type: "GET_SETTINGS" })
    ]);
    configureLocale(settings.locale);
    localizeDocumentTitle("plan");
    state = planState;
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
        attrs: { "aria-busy": "true", "aria-label": t("plan.loading") },
        children: [
          element("div", {
            className: "plan-state__inner",
            children: [
              element("div", { className: "plan-state__icon", children: [icon("calendar")] }),
              element("h2", { text: t("plan.loading") }),
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
    text: t("common.retry"),
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
              element("h2", { text: t("plan.loadFailed") }),
              element("p", { text: message }),
              retry
            ]
          })
        ]
      })
    )
  );
}

function renderPlan(options: { focusItemId?: string } = {}): void {
  if (!state) return;
  cleanupMindmap?.();
  cleanupMindmap = null;
  const content = createQueueCard(state);
  app.replaceChildren(createShell(content));

  if (options.focusItemId) {
    const item = document.querySelector<HTMLElement>(
      `[data-plan-item-id="${cssEscape(options.focusItemId)}"]`
    );
    const collapsedSection = item?.closest<HTMLDetailsElement>("details:not([open])");
    (collapsedSection?.querySelector<HTMLElement>("summary") ?? item)?.focus();
  }
}

function createShell(content: HTMLElement): HTMLElement {
  return element("div", {
    className: `plan-shell app-shell${planView === "mindmap" ? " plan-shell--mindmap" : ""}`,
    children: [
      createPageNavigation({ currentPage: "plan" }),
      element("header", {
        className: "plan-heading",
        children: [
          element("div", {
            children: [element("h1", { className: "page-title", text: t("plan.title") })]
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
    { id: "list", label: t("plan.list") },
    { id: "mindmap", label: t("plan.mindmap") }
  ];
  return element("div", {
    className: "plan-view-control segmented",
    attrs: { role: "group", "aria-label": t("plan.viewLabel") },
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

function createQueueCard(planState: PlanState): HTMLElement {
  const pending = sortedItems(planState, "pending");
  const completed = sortedItems(planState, "completed");
  const total = pending.length + completed.length;
  const completion = total > 0 ? Math.round((completed.length / total) * 100) : 0;

  const add = element("button", {
    className: "btn btn--primary",
    attrs: { type: "button", "data-testid": "plan-add-open" },
    children: [icon("plus"), t("plan.add")]
  });
  add.addEventListener("click", openAddDialog);
  const bulk = element("button", {
    className: "btn",
    attrs: { type: "button", "data-testid": "plan-bulk-import" },
    children: [icon("plus"), t("plan.bulkAdd")]
  });
  bulk.addEventListener("click", openBulkImportDialog);

  return element("section", {
    className: "card plan-card plan-workspace",
    attrs: { "aria-labelledby": "plan-workspace-title" },
    children: [
      element("div", {
        className: "plan-card__header plan-workspace__header",
        children: [
          element("div", {
            className: "plan-workspace__title",
            children: [
              element("h2", {
                text: planView === "list" ? t("plan.list") : t("plan.mindmap"),
                attrs: { id: "plan-workspace-title" }
              }),
              createProgress(pending.length, completed.length, completion)
            ]
          }),
          element("div", { className: "plan-workspace__actions", children: [bulk, add] })
        ]
      }),
      planView === "list" ? createListView(pending, completed) : createMindmap(pending, completed)
    ]
  });
}

function createListView(pending: PlanItem[], completed: PlanItem[]): HTMLElement {
  return element("div", {
    className: "plan-list-view",
    attrs: { "aria-label": t("plan.list") },
    children: [
      createItemSection(t("plan.pending"), pending, false, "list"),
      createItemSection(t("plan.completed"), completed, true, "list")
    ]
  });
}

function createProgress(pending: number, completed: number, percentage: number): HTMLElement {
  const total = pending + completed;
  return element("div", {
    className: "plan-progress",
    attrs: {
      role: "progressbar",
      "aria-label": t("plan.progress"),
      "aria-valuemin": "0",
      "aria-valuemax": String(total),
      "aria-valuenow": String(completed),
      "aria-valuetext": total > 0 ? t("plan.progressText", { completed, total }) : t("plan.noItems")
    },
    children: [
      element("div", {
        className: "plan-progress__meta",
        children: [
          element("span", { className: "plan-progress__value", text: `${completed}/${total}` }),
          element("span", {
            className: "plan-progress__label",
            text: pending > 0 ? t("plan.pendingCount", { count: pending }) : t("plan.allCompleted")
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
  const sectionId = `plan-${completed ? "completed" : "pending"}-title`;
  const header = element(completed ? "summary" : "div", {
    className: "plan-section__header",
    attrs: completed ? { tabindex: "0" } : undefined,
    children: [
      element("div", {
        children: [element("h2", { text: title, attrs: { id: sectionId } })]
      }),
      element("span", {
        className: `plan-status-pill ${completed ? "plan-status-pill--success" : "plan-status-pill--neutral"}`,
        text: t("common.itemCount", { count: items.length })
      })
    ]
  });
  const itemContent =
    items.length > 0
      ? element("ol", {
          className: "plan-list",
          attrs: { "aria-label": completed ? t("plan.completed") : t("plan.pending") },
          children: items.map((item, index) => createPlanItem(item, index, items.length, variant))
        })
      : createEmpty(completed);
  const section = element(completed ? "details" : "section", {
    className: `plan-section plan-section--${completed ? "completed" : "pending"}`,
    attrs: { "aria-labelledby": `plan-${completed ? "completed" : "pending"}-title` },
    children: [header, itemContent]
  });
  if (completed && section instanceof HTMLDetailsElement) {
    section.open = completedExpanded;
    section.addEventListener("toggle", () => {
      completedExpanded = section.open;
    });
  }
  return section;
}

function createMindmap(pending: PlanItem[], completed: PlanItem[]): HTMLElement {
  const nextContentSignature = [...pending, ...completed]
    .map((item) => `${item.id}\u0000${item.status}\u0000${item.title}\u0000${item.url}`)
    .sort()
    .join("\u0001");
  if (mindmapContentSignature !== null && mindmapContentSignature !== nextContentSignature) {
    mindmapTransform = null;
  }
  mindmapContentSignature = nextContentSignature;
  const branches = element("div", {
    className: "plan-mindmap__branches",
    children: [
      createMindmapBranch(t("plan.pending"), pending, false),
      createMindmapBranch(t("plan.completed"), completed, true)
    ]
  });
  const scene = element("div", {
    className: "plan-mindmap__canvas",
    children: [element("div", { className: "plan-mindmap__root", text: t("plan.title") }), branches]
  });
  const viewport = element("div", {
    className: "plan-mindmap__viewport",
    attrs: {
      tabindex: "0",
      "aria-label": t("plan.canvasLabel"),
      "aria-describedby": "plan-mindmap-hint"
    },
    children: [scene]
  });
  const zoomValue = element("output", {
    className: "plan-mindmap__zoom-value",
    text: "100%"
  });
  const zoomOut = createMindmapControl("−", t("plan.zoomOut"));
  const zoomIn = createMindmapControl("+", t("plan.zoomIn"));
  const fit = createMindmapControl("⌖", t("plan.fitView"));
  const toolbar = element("div", {
    className: "plan-mindmap__toolbar",
    attrs: { role: "group", "aria-label": t("plan.canvasControls") },
    children: [zoomOut, zoomValue, zoomIn, fit]
  });
  const mindmap = element("section", {
    className: "plan-mindmap",
    attrs: { "aria-label": t("plan.mindmap") },
    children: [
      element("div", {
        className: "plan-mindmap__topbar",
        children: [
          element("p", {
            className: "plan-mindmap__hint",
            text: t("plan.canvasHint"),
            attrs: { id: "plan-mindmap-hint" }
          }),
          toolbar
        ]
      }),
      viewport
    ]
  });
  window.requestAnimationFrame(() => {
    if (!viewport.isConnected) return;
    cleanupMindmap = enableMindmapViewport(viewport, scene, branches, zoomValue, {
      zoomIn,
      zoomOut,
      fit
    });
  });
  return mindmap;
}

function createMindmapBranch(title: string, items: PlanItem[], completed: boolean): HTMLElement {
  const titleId = `plan-mindmap-${completed ? "completed" : "pending"}-title`;
  const branchTitle = element(completed ? "summary" : "h2", {
    className: "plan-mindmap__branch-title",
    text: `${title} ${items.length}`,
    attrs: { id: titleId }
  });
  const branchContent =
    items.length > 0
      ? element("ol", {
          className: "plan-mindmap__track",
          attrs: { "aria-label": completed ? t("plan.completed") : t("plan.pending") },
          children: items.map((item, index) => createPlanItem(item, index, items.length, "mindmap"))
        })
      : element("div", {
          className: "plan-mindmap__empty",
          text: completed ? t("plan.noCompleted") : t("plan.noPending")
        });
  const branch = element(completed ? "details" : "section", {
    className: `plan-mindmap__branch${completed ? " plan-mindmap__branch--complete" : ""}`,
    attrs: { "aria-labelledby": titleId },
    children: [branchTitle, branchContent]
  });
  if (completed && branch instanceof HTMLDetailsElement) {
    branch.open = completedExpanded;
    branch.addEventListener("toggle", () => {
      completedExpanded = branch.open;
    });
  }
  return branch;
}

function createMindmapControl(text: string, label: string): HTMLButtonElement {
  return element("button", {
    className: "btn btn--icon plan-mindmap__control",
    text,
    attrs: { type: "button", title: label, "aria-label": label }
  });
}

function enableMindmapViewport(
  viewport: HTMLElement,
  scene: HTMLElement,
  branches: HTMLElement,
  zoomValue: HTMLOutputElement,
  controls: Readonly<{
    zoomIn: HTMLButtonElement;
    zoomOut: HTMLButtonElement;
    fit: HTMLButtonElement;
  }>
): () => void {
  const abort = new AbortController();
  let transform = mindmapTransform;
  let autoFit = transform === null;
  let activePointerId: number | null = null;
  let dragOrigin = { x: 0, y: 0 };
  let transformOrigin = { x: 0, y: 0 };
  let fitFrame = 0;

  const syncBranchConnector = (): void => {
    const branchElements = Array.from(branches.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement
    );
    const first = branchElements.at(0);
    const last = branchElements.at(-1);
    if (!first || !last) return;
    const connector = getMindmapConnectorMetrics(
      { top: first.offsetTop, height: first.offsetHeight },
      { top: last.offsetTop, height: last.offsetHeight }
    );
    branches.style.setProperty("--mindmap-connector-top", `${connector.top}px`);
    branches.style.setProperty("--mindmap-connector-height", `${connector.height}px`);
  };

  const applyTransform = (next: MindmapTransform): void => {
    transform = next;
    mindmapTransform = next;
    scene.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
    zoomValue.value = `${Math.round(next.scale * 100)}%`;
    controls.zoomOut.disabled = next.scale <= MIN_MINDMAP_SCALE;
    controls.zoomIn.disabled = next.scale >= MAX_MINDMAP_SCALE;
  };

  const fitView = (): void => {
    window.cancelAnimationFrame(fitFrame);
    fitFrame = window.requestAnimationFrame(() => {
      if (!viewport.isConnected) return;
      autoFit = true;
      applyTransform(
        fitMindmapTransform(
          { width: viewport.clientWidth, height: viewport.clientHeight },
          { width: scene.offsetWidth, height: scene.offsetHeight }
        )
      );
    });
  };

  const zoomAround = (requestedScale: number, x: number, y: number): void => {
    if (!transform) return;
    autoFit = false;
    applyTransform(zoomMindmapAt(transform, requestedScale, { x, y }));
  };

  const zoomFromCenter = (factor: number): void => {
    if (!transform) return;
    zoomAround(transform.scale * factor, viewport.clientWidth / 2, viewport.clientHeight / 2);
  };

  controls.zoomOut.addEventListener("click", () => zoomFromCenter(0.82), {
    signal: abort.signal
  });
  controls.zoomIn.addEventListener("click", () => zoomFromCenter(1.22), {
    signal: abort.signal
  });
  controls.fit.addEventListener("click", fitView, { signal: abort.signal });

  viewport.addEventListener(
    "wheel",
    (event) => {
      if (!transform || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1);
      zoomAround(
        transform.scale * Math.exp(-delta * 0.0015),
        event.clientX - bounds.left,
        event.clientY - bounds.top
      );
    },
    { passive: false, signal: abort.signal }
  );

  viewport.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 || activePointerId !== null || !transform) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          ".plan-item, .plan-mindmap__branch-title, button, a, input, select, textarea"
        )
      ) {
        return;
      }
      activePointerId = event.pointerId;
      dragOrigin = { x: event.clientX, y: event.clientY };
      transformOrigin = { x: transform.x, y: transform.y };
      autoFit = false;
      viewport.classList.add("plan-mindmap__viewport--dragging");
      viewport.setPointerCapture(event.pointerId);
    },
    { signal: abort.signal }
  );
  viewport.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerId !== activePointerId || !transform) return;
      applyTransform({
        ...transform,
        x: transformOrigin.x + event.clientX - dragOrigin.x,
        y: transformOrigin.y + event.clientY - dragOrigin.y
      });
    },
    { signal: abort.signal }
  );
  const finishDragging = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
    viewport.classList.remove("plan-mindmap__viewport--dragging");
    if (viewport.hasPointerCapture(event.pointerId))
      viewport.releasePointerCapture(event.pointerId);
  };
  viewport.addEventListener("pointerup", finishDragging, { signal: abort.signal });
  viewport.addEventListener("pointercancel", finishDragging, { signal: abort.signal });

  viewport.addEventListener(
    "keydown",
    (event) => {
      if (event.target !== viewport) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomFromCenter(1.22);
      } else if (event.key === "-") {
        event.preventDefault();
        zoomFromCenter(0.82);
      } else if (event.key === "0") {
        event.preventDefault();
        fitView();
      } else if (
        transform &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        autoFit = false;
        applyTransform({
          ...transform,
          x: transform.x + (event.key === "ArrowLeft" ? 48 : event.key === "ArrowRight" ? -48 : 0),
          y: transform.y + (event.key === "ArrowUp" ? 48 : event.key === "ArrowDown" ? -48 : 0)
        });
      }
    },
    { signal: abort.signal }
  );
  viewport.addEventListener(
    "dblclick",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".plan-item, .plan-mindmap__branch-title, button")) return;
      fitView();
    },
    { signal: abort.signal }
  );

  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          syncBranchConnector();
          if (autoFit) fitView();
        });
  resizeObserver?.observe(viewport);
  resizeObserver?.observe(scene);
  resizeObserver?.observe(branches);

  syncBranchConnector();
  if (transform) applyTransform(transform);
  else fitView();

  return () => {
    abort.abort();
    resizeObserver?.disconnect();
    window.cancelAnimationFrame(fitFrame);
  };
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
          element("h3", { text: completed ? t("plan.noCompleted") : t("plan.noPending") })
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
  const sortable = !complete && editingItemId !== item.id;
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
                  className: "plan-item__summary",
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
                  text: complete ? t("plan.completedToast") : `#${index + 1}`
                })
              ]
            }),
            element("div", {
              className: "plan-item__meta",
              children: [
                element("span", {
                  className: "plan-source-pill",
                  text: t(SOURCE_LABEL_KEYS[item.source])
                }),
                element("span", {
                  className: "plan-time-pill",
                  text: t("plan.scheduled", {
                    duration: formatDuration(item.scheduledDurationMinutes)
                  })
                }),
                element("span", {
                  text: t(COMPLETION_MODE_LABEL_KEYS[item.completionMode])
                }),
                ...(item.bvid ? [element("span", { text: item.bvid })] : []),
                element("span", {
                  text:
                    complete && item.completedAt
                      ? t("plan.completedAt", { time: formatDateTime(item.completedAt) })
                      : t("plan.addedAt", { time: formatDateTime(item.addedAt) })
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
      title: complete ? t("plan.restore") : t("plan.markCompleted"),
      "aria-label": complete ? t("plan.restore") : t("plan.markCompleted"),
      "aria-pressed": complete
    },
    children: [icon(complete ? "check" : "plus")]
  });
  completeButton.addEventListener("click", () => {
    void setCompleted(item, !complete, completeButton);
  });

  const itemElement = element("li", {
    className: `plan-item plan-item--${variant}${complete ? " plan-item--complete" : ""}`,
    attrs: {
      tabindex: "0",
      draggable: sortable ? "true" : undefined,
      ...(sortable ? { "aria-grabbed": "false" } : {})
    },
    dataset: { planItemId: item.id },
    children: [completeButton, content]
  });
  if (sortable) enableItemSorting(itemElement, item, variant);
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
      children: [icon("play"), t("plan.start")]
    });
    start.addEventListener("click", () => void startWatching(item, start));
    actions.push(
      start,
      createMoveButton(item, "up", index === 0, variant),
      createMoveButton(item, "down", index === siblingCount - 1, variant)
    );
  } else {
    const restore = element("button", {
      className: "btn btn--soft",
      attrs: { type: "button" },
      children: [icon("refresh"), t("plan.restore")]
    });
    restore.addEventListener("click", () => void setCompleted(item, false, restore));
    actions.push(restore);
  }

  const edit = element("button", {
    className: "btn btn--icon",
    attrs: {
      type: "button",
      title: t("common.edit"),
      "aria-label": t("plan.editItem", { title: item.title })
    },
    children: [icon("edit")]
  });
  edit.addEventListener("click", () => {
    editingItemId = item.id;
    renderPlan({ focusItemId: item.id });
    document.querySelector<HTMLInputElement>(`#plan-title-${cssEscape(item.id)}`)?.focus();
  });

  const remove = element("button", {
    className: "btn btn--icon btn--danger",
    attrs: {
      type: "button",
      title: t("common.delete"),
      "aria-label": t("plan.removeItem", { title: item.title })
    },
    children: [icon("trash")]
  });
  remove.addEventListener("click", () => void deleteItem(item, remove));
  actions.push(edit, remove);

  return element("div", { className: "plan-item__actions", children: actions });
}

function createMoveButton(
  item: PlanItem,
  direction: "up" | "down",
  disabled: boolean,
  variant: PlanView
): HTMLButtonElement {
  const label =
    variant === "mindmap"
      ? direction === "up"
        ? t("plan.moveLeft")
        : t("plan.moveRight")
      : direction === "up"
        ? t("plan.moveUp")
        : t("plan.moveDown");
  const button = element("button", {
    className: `btn btn--icon plan-move-button plan-move-button--${variant}`,
    attrs: {
      type: "button",
      title: label,
      "aria-label": `${label}“${item.title}”`,
      disabled,
      "data-direction": direction
    },
    children: [icon("chevron")]
  });
  button.addEventListener("click", () => void movePlanItem(item, direction, button));
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
  const completionMode = createCompletionModeControl(
    `plan-completion-mode-${item.id}`,
    item.completionMode
  );
  const url = element("input", {
    className: "plan-input",
    attrs: { type: "url", value: item.url, maxlength: "500", required: true, inputmode: "url" }
  });
  const duration = createDurationInput(
    `plan-duration-${item.id}`,
    item.scheduledDurationMinutes,
    `plan-duration-help-${item.id}`
  );
  const save = element("button", {
    className: "btn btn--primary",
    text: t("common.save"),
    attrs: { type: "submit" }
  });
  const cancel = element("button", {
    className: "btn",
    text: t("common.cancel"),
    attrs: { type: "button" }
  });
  cancel.addEventListener("click", () => {
    editingItemId = null;
    renderPlan({ focusItemId: item.id });
  });

  const form = element("form", {
    className: "plan-edit-form",
    attrs: { "aria-label": t("plan.editItem", { title: item.title }) },
    children: [
      element("label", {
        className: "plan-field",
        children: [element("span", { text: t("plan.titleField") }), title]
      }),
      element("label", {
        className: "plan-field",
        children: [
          element("span", { text: t("plan.completionMode") }),
          completionMode.select,
          completionMode.description
        ]
      }),
      element("label", {
        className: "plan-field",
        children: [element("span", { text: t("plan.urlField") }), url]
      }),
      element("label", {
        className: "plan-field",
        children: [
          element("span", { text: t("plan.durationField") }),
          duration,
          element("small", {
            className: "plan-field__hint",
            text: t("plan.durationHint"),
            attrs: { id: `plan-duration-help-${item.id}` }
          })
        ]
      }),
      element("div", { className: "plan-form__actions", children: [save, cancel] })
    ]
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void updateItem(
      item,
      title.value,
      url.value,
      duration.value,
      completionMode.select.value as PlanCompletionMode,
      save
    );
  });
  return form;
}

async function startWatching(item: PlanItem, button: HTMLButtonElement): Promise<void> {
  setButtonBusy(button, true, t("plan.requestingPermission"));
  try {
    const granted = await permissionsRequest([`${item.origin}/*`]);
    if (!granted) throw new Error(t("plan.permissionDenied"));
    setButtonBusy(button, true, t("plan.started"));
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
    toast(completed ? t("plan.completedToast") : t("plan.restoredToast"));
    renderPlan({ focusItemId: item.id });
  } catch (error) {
    control.disabled = false;
    toast(describeError(error), "error");
  }
}

async function movePlanItem(
  item: PlanItem,
  direction: "up" | "down",
  control?: HTMLButtonElement
): Promise<void> {
  if (!state) return;
  const pending = sortedItems(state, "pending");
  const index = pending.findIndex((candidate) => candidate.id === item.id);
  const target = pending[index + (direction === "up" ? -1 : 1)];
  if (!target) return;
  if (control) control.disabled = true;
  await reorderPlanItems(item.id, target.id, direction === "up" ? "before" : "after");
  if (control) control.disabled = false;
}

function enableItemSorting(itemElement: HTMLLIElement, item: PlanItem, variant: PlanView): void {
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
    const position = getDropPosition(itemElement, event, variant);
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
    const position = getDropPosition(itemElement, event, variant);
    clearDropState(itemElement);
    if (!sourceId || sourceId === item.id) return;
    void reorderPlanItems(sourceId, item.id, position);
  });
  itemElement.addEventListener("dragend", () => {
    itemElement.classList.remove("plan-item--dragging");
    itemElement.setAttribute("aria-grabbed", "false");
    document
      .querySelectorAll<HTMLElement>(".plan-item--drop-before, .plan-item--drop-after")
      .forEach(clearDropState);
  });
  itemElement.addEventListener("keydown", (event) => {
    if (!event.altKey || event.target !== itemElement) return;
    const backwardKey = variant === "mindmap" ? "ArrowLeft" : "ArrowUp";
    const forwardKey = variant === "mindmap" ? "ArrowRight" : "ArrowDown";
    if (event.key !== backwardKey && event.key !== forwardKey) return;
    event.preventDefault();
    void movePlanItem(item, event.key === backwardKey ? "up" : "down");
  });
}

function getDropPosition(
  element: HTMLElement,
  event: DragEvent,
  variant: PlanView
): "before" | "after" {
  const bounds = element.getBoundingClientRect();
  return variant === "mindmap"
    ? event.clientX < bounds.left + bounds.width / 2
      ? "before"
      : "after"
    : event.clientY < bounds.top + bounds.height / 2
      ? "before"
      : "after";
}

function clearDropState(element: HTMLElement): void {
  element.classList.remove("plan-item--drop-before", "plan-item--drop-after");
}

async function reorderPlanItems(
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
    toast(t("plan.reordered"));
    renderPlan({ focusItemId: sourceId });
  } catch (error) {
    toast(describeError(error), "error");
  }
}

async function updateItem(
  item: PlanItem,
  titleValue: string,
  urlValue: string,
  durationValue: string,
  completionMode: PlanCompletionMode,
  button: HTMLButtonElement
): Promise<void> {
  const title = titleValue.trim();
  const url = urlValue.trim();
  if (!title || !url) {
    toast(t("plan.required"), "error");
    return;
  }
  const scheduledDurationMinutes = readDurationMinutes(durationValue);
  if (scheduledDurationMinutes === null) {
    toast(
      t("plan.invalidDuration", {
        min: MIN_PLAN_DURATION_MINUTES,
        max: MAX_PLAN_DURATION_MINUTES
      }),
      "error"
    );
    return;
  }
  setButtonBusy(button, true, t("common.saving"));
  try {
    state = await sendRequest({
      type: "UPDATE_PLAN_ITEM",
      id: item.id,
      patch: { title, url, scheduledDurationMinutes, completionMode }
    });
    editingItemId = null;
    toast(t("plan.saved"));
    renderPlan({ focusItemId: item.id });
  } catch (error) {
    setButtonBusy(button, false);
    toast(describeError(error), "error");
  }
}

async function deleteItem(item: PlanItem, button: HTMLButtonElement): Promise<void> {
  if (!window.confirm(t("plan.removeQuestion", { title: item.title }))) return;
  button.disabled = true;
  try {
    state = await sendRequest({ type: "DELETE_PLAN_ITEM", id: item.id });
    editingItemId = null;
    toast(t("plan.removed"));
    renderPlan();
    document.querySelector<HTMLButtonElement>('[data-testid="plan-add-open"]')?.focus();
  } catch (error) {
    button.disabled = false;
    toast(describeError(error), "error");
  }
}

function openAddDialog(): void {
  const existing = document.querySelector<HTMLDialogElement>(".plan-add-dialog");
  if (existing) {
    existing.showModal();
    existing.querySelector<HTMLInputElement>("#plan-video-url")?.focus();
    return;
  }
  const url = element("input", {
    className: "plan-input",
    attrs: {
      id: "plan-video-url",
      type: "url",
      inputmode: "url",
      autocomplete: "off",
      maxlength: "500",
      placeholder: t("plan.urlPlaceholder"),
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
      placeholder: t("plan.titlePlaceholder"),
      "data-testid": "plan-add-title"
    }
  });
  const duration = createDurationInput(
    "plan-scheduled-duration",
    state?.settings.watchDurationMinutes ?? 45,
    "plan-duration-help plan-url-error"
  );
  const completionMode = createCompletionModeControl(
    "plan-completion-mode",
    state?.settings.defaultCompletionMode ?? "flow"
  );
  const error = element("p", {
    className: "plan-field__error",
    attrs: { id: "plan-url-error", role: "alert", hidden: true }
  });
  const submit = element("button", {
    className: "btn btn--primary",
    attrs: { type: "submit", "data-testid": "plan-add-submit" },
    children: [icon("plus"), t("plan.add")]
  });
  const cancel = element("button", {
    className: "btn",
    text: t("common.cancel"),
    attrs: { type: "button" }
  });
  const iconClose = element("button", {
    className: "btn btn--icon",
    attrs: { type: "button", title: t("common.close"), "aria-label": t("common.close") },
    children: [icon("close")]
  });
  const form = element("form", {
    className: "plan-dialog__surface plan-form",
    attrs: { novalidate: true, method: "dialog" },
    children: [
      element("header", {
        className: "plan-dialog__header",
        children: [
          element("h2", { text: t("plan.add"), attrs: { id: "plan-add-title" } }),
          iconClose
        ]
      }),
      element("div", {
        className: "plan-dialog__body plan-form__body",
        children: [
          element("div", {
            className: "plan-field",
            children: [
              element("label", { text: t("plan.urlField"), attrs: { for: "plan-video-url" } }),
              url,
              error
            ]
          }),
          element("div", {
            className: "plan-field",
            children: [
              element("label", { text: t("plan.titleField"), attrs: { for: "plan-video-title" } }),
              title
            ]
          }),
          element("div", {
            className: "plan-field",
            children: [
              element("label", {
                text: t("plan.durationField"),
                attrs: { for: "plan-scheduled-duration" }
              }),
              duration,
              element("small", {
                className: "plan-field__hint",
                text: t("plan.durationHint"),
                attrs: { id: "plan-duration-help" }
              })
            ]
          }),
          element("div", {
            className: "plan-field",
            children: [
              element("label", {
                text: t("plan.completionMode"),
                attrs: { for: "plan-completion-mode" }
              }),
              completionMode.select,
              completionMode.description
            ]
          })
        ]
      }),
      element("footer", { className: "plan-dialog__footer", children: [cancel, submit] })
    ]
  });
  const dialog = element("dialog", {
    className: "plan-dialog plan-add-dialog",
    attrs: { "aria-labelledby": "plan-add-title" },
    children: [form]
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.hidden = true;
    url.removeAttribute("aria-invalid");
    void addItem(url, title, duration, completionMode.select, error, submit, dialog);
  });
  const closeDialog = () => dialog.close();
  cancel.addEventListener("click", closeDialog);
  iconClose.addEventListener("click", closeDialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  url.focus();
}

async function addItem(
  urlInput: HTMLInputElement,
  titleInput: HTMLInputElement,
  durationInput: HTMLInputElement,
  completionModeInput: HTMLSelectElement,
  error: HTMLElement,
  submit: HTMLButtonElement,
  dialog: HTMLDialogElement
): Promise<void> {
  const url = urlInput.value.trim();
  const title = titleInput.value.trim();
  if (!url) {
    showFieldError(urlInput, error, t("plan.invalidUrl"));
    return;
  }
  const scheduledDurationMinutes = readDurationMinutes(durationInput.value);
  if (scheduledDurationMinutes === null) {
    showFieldError(
      durationInput,
      error,
      t("plan.invalidDuration", {
        min: MIN_PLAN_DURATION_MINUTES,
        max: MAX_PLAN_DURATION_MINUTES
      })
    );
    return;
  }
  setButtonBusy(submit, true, t("common.processing"));
  try {
    const previousIds = new Set(state?.queue.items.map((item) => item.id) ?? []);
    state = await sendRequest({
      type: "ADD_PLAN_ITEM",
      url,
      scheduledDurationMinutes,
      completionMode: completionModeInput.value as PlanCompletionMode,
      ...(title ? { title } : {})
    });
    const addedItem = state.queue.items.find((item) => !previousIds.has(item.id));
    editingItemId = null;
    dialog.close();
    toast(t("plan.added"));
    renderPlan(addedItem ? { focusItemId: addedItem.id } : {});
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

function openBulkImportDialog(): void {
  const bulkDuration = createDurationInput(
    "plan-bulk-duration",
    state?.settings.watchDurationMinutes ?? 45,
    "plan-bulk-error"
  );
  const bulkCompletionMode = createCompletionModeControl(
    "plan-bulk-completion-mode",
    state?.settings.defaultCompletionMode ?? "flow"
  );
  const textarea = element("textarea", {
    className: "plan-input plan-bulk-textarea",
    attrs: {
      rows: "8",
      maxlength: "100000",
      placeholder: t("plan.bulkPlaceholder"),
      "aria-label": t("plan.contentList"),
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
    children: [icon("refresh"), t("plan.checkLinks")]
  });
  const importButton = element("button", {
    className: "btn btn--primary",
    text: t("plan.importSelected"),
    attrs: { type: "button", disabled: true }
  });
  const close = element("button", {
    className: "btn",
    text: t("common.cancel"),
    attrs: { type: "button" }
  });
  const iconClose = element("button", {
    className: "btn btn--icon",
    attrs: { type: "button", title: t("common.close"), "aria-label": t("common.close") },
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
                  element("h2", { text: t("plan.bulkTitle"), attrs: { id: "plan-bulk-title" } })
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
                  element("label", {
                    text: t("plan.contentList"),
                    attrs: { for: "plan-bulk-input" }
                  }),
                  textarea,
                  error
                ]
              }),
              element("div", {
                className: "plan-field",
                children: [
                  element("label", {
                    text: t("plan.durationField"),
                    attrs: { for: "plan-bulk-duration" }
                  }),
                  bulkDuration,
                  element("small", { className: "plan-field__hint", text: t("plan.durationHint") })
                ]
              }),
              element("div", {
                className: "plan-field",
                children: [
                  element("label", {
                    text: t("plan.completionMode"),
                    attrs: { for: "plan-bulk-completion-mode" }
                  }),
                  bulkCompletionMode.select,
                  bulkCompletionMode.description
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
    const scheduledDurationMinutes = readDurationMinutes(bulkDuration.value);
    if (scheduledDurationMinutes === null) {
      error.hidden = false;
      error.textContent = t("plan.invalidDuration", {
        min: MIN_PLAN_DURATION_MINUTES,
        max: MAX_PLAN_DURATION_MINUTES
      });
      bulkDuration.focus();
      importButton.disabled = true;
      return;
    }
    const result = parsePlanImport(
      textarea.value,
      scheduledDurationMinutes,
      bulkCompletionMode.select.value as PlanCompletionMode
    );
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
          ? t("plan.inputTooLong")
          : t("plan.noValidLinks");
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

  const selectionCount = element("span", {
    text: t("plan.selectedCount", { count: items.length })
  });
  const selectAll = element("button", {
    className: "btn",
    text: t("plan.clearSelection"),
    attrs: { type: "button" }
  });
  const checkboxes = items.map((item) =>
    element("input", {
      attrs: {
        type: "checkbox",
        value: item.url,
        checked: true,
        "aria-label": t("plan.selectItem", {
          item: item.title ?? item.url ?? t("plan.contentItem")
        })
      }
    })
  );
  const refreshCount = () => {
    const selected = checkboxes.filter((checkbox) => checkbox.checked).length;
    selectionCount.textContent = t("plan.selectedCount", { count: selected });
    importButton.disabled = selected === 0;
    selectAll.textContent =
      selected === checkboxes.length ? t("plan.clearSelection") : t("plan.selectAll");
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
  if (duplicateCount > 0) notes.push(t("plan.duplicatesMerged", { count: duplicateCount }));
  if (invalidCount > 0) notes.push(t("plan.invalidLines", { count: invalidCount }));
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
                    text: item.title || item.url || t("plan.contentItem")
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
  setButtonBusy(button, true, t("common.processing"));
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
        ? t("plan.importedSkipped", { count: addedCount, skipped: skippedCount })
        : t("plan.imported", { count: addedCount })
    );
    renderPlan();
  } catch (error) {
    setButtonBusy(button, false);
    toast(
      addedCount > 0
        ? t("plan.importInterrupted", { count: addedCount, error: describeError(error) })
        : describeError(error),
      "error"
    );
    if (addedCount > 0) {
      dialog.close();
      renderPlan();
    }
  }
}

function parsePlanImport(
  value: string,
  scheduledDurationMinutes: number,
  completionMode: PlanCompletionMode
): {
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
    const parsed = parsePlanImportLine(line, scheduledDurationMinutes, completionMode);
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
  line: string,
  scheduledDurationMinutes: number,
  completionMode: PlanCompletionMode
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
    return {
      url: url.href,
      title: normalizedTitle,
      source: "manual",
      scheduledDurationMinutes,
      completionMode
    };
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
    return new Intl.DateTimeFormat(getResolvedLocale(), {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(timestamp));
  } catch {
    return "—";
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return t("duration.minutes", { minutes });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0
    ? t("duration.hours", { hours })
    : t("duration.hoursMinutes", { hours, minutes: remainder });
}

function createDurationInput(id: string, value: number, describedBy: string): HTMLInputElement {
  return element("input", {
    className: "plan-input",
    attrs: {
      id,
      type: "number",
      inputmode: "numeric",
      min: MIN_PLAN_DURATION_MINUTES,
      max: MAX_PLAN_DURATION_MINUTES,
      step: "1",
      value,
      required: true,
      "aria-describedby": describedBy,
      "data-testid": id === "plan-scheduled-duration" ? "plan-add-duration" : undefined
    }
  });
}

function createCompletionModeControl(
  id: string,
  selectedMode: PlanCompletionMode
): { select: HTMLSelectElement; description: HTMLElement } {
  const descriptionId = `${id}-description`;
  const description = element("small", {
    className: "plan-field__hint plan-mode-description",
    text: t(COMPLETION_MODE_DESCRIPTION_KEYS[selectedMode]),
    attrs: { id: descriptionId, "aria-live": "polite" }
  });
  const select = element("select", {
    className: "plan-input plan-select",
    attrs: {
      id,
      required: true,
      "aria-describedby": descriptionId,
      "data-testid": id === "plan-completion-mode" ? "plan-add-completion-mode" : undefined
    },
    children: (
      Object.entries(COMPLETION_MODE_LABEL_KEYS) as Array<[PlanCompletionMode, MessageKey]>
    ).map(([mode, labelKey]) =>
      element("option", {
        text: t(labelKey),
        attrs: { value: mode, selected: mode === selectedMode }
      })
    )
  });
  select.addEventListener("change", () => {
    description.textContent = t(
      COMPLETION_MODE_DESCRIPTION_KEYS[select.value as PlanCompletionMode]
    );
  });
  return { select, description };
}

function readDurationMinutes(value: string): number | null {
  if (!/^\d+$/u.test(value.trim())) return null;
  const minutes = Number(value);
  return Number.isInteger(minutes) &&
    minutes >= MIN_PLAN_DURATION_MINUTES &&
    minutes <= MAX_PLAN_DURATION_MINUTES
    ? minutes
    : null;
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
