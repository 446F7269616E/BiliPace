import { sendRequest } from "../shared/messages";
import { MAX_TIME_ACCESS_RULES, SETTINGS_SCHEMA_VERSION } from "../shared/config";
import { createPresetRules, TIME_ACCESS_PRESETS, type TimeAccessPreset } from "../shared/schedule";
import {
  CONTENT_FILTER_IDS,
  SECTION_IDS,
  SECTION_LABELS,
  type ContentFilterId,
  type FocusSettings,
  type SectionId,
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

const WEEKDAYS: ReadonlyArray<{ value: Weekday; short: string; label: string }> = [
  { value: 1, short: "一", label: "星期一" },
  { value: 2, short: "二", label: "星期二" },
  { value: 3, short: "三", label: "星期三" },
  { value: 4, short: "四", label: "星期四" },
  { value: 5, short: "五", label: "星期五" },
  { value: 6, short: "六", label: "星期六" },
  { value: 0, short: "日", label: "星期日" }
];

const SECTION_META: Readonly<Record<SectionId, { description: string; color: string }>> = {
  home: { description: "推荐流、视频分区与首页内容", color: "#e94983" },
  dynamic: { description: "关注账号发布的动态内容", color: "#7657d5" },
  popular: { description: "热门、排行榜与每周必看", color: "#ef7d35" },
  video: { description: "视频详情页与播放页面", color: "#df5277" },
  live: { description: "直播首页与直播间", color: "#3b9f91" },
  bangumi: { description: "番剧、电影与影视内容", color: "#4e78e8" },
  search: { description: "搜索结果与发现内容", color: "#63738f" }
};

const CONTENT_FILTER_META: Readonly<
  Record<ContentFilterId, { title: string; description: string }>
> = {
  "home-feed": { title: "首页推荐流", description: "隐藏首页视频卡片" },
  "dynamic-feed": { title: "动态信息流", description: "隐藏动态内容列表" },
  "related-videos": { title: "相关视频", description: "隐藏播放页相关推荐" },
  comments: { title: "评论区", description: "隐藏评论与回复" },
  "search-suggestions": { title: "搜索联想", description: "隐藏输入时的推荐词" },
  ads: { title: "推广内容", description: "隐藏识别到的推广内容" },
  "top-navigation": { title: "顶部导航", description: "隐藏站点顶栏" }
};

const app = assertAppRoot();
let draft: FocusSettings | null = null;
let savedSnapshot = "";
let topSaveButton: HTMLButtonElement | null = null;
let savebarButton: HTMLButtonElement | null = null;
let saveState: HTMLElement | null = null;
let savebar: HTMLElement | null = null;

window.addEventListener("beforeunload", (event) => {
  if (!isDirty()) return;
  event.preventDefault();
});

void loadOptions();

async function loadOptions(): Promise<void> {
  renderLoading();
  try {
    draft = cloneSettings(await sendRequest({ type: "GET_SETTINGS" }));
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
    children: [element("h1", { className: "page-title", text: "配置" })]
  });
}

function createSettingsContent(): HTMLElement {
  return element("div", {
    className: "settings-content",
    children: [createContentFiltersArea(), createSectionsArea()]
  });
}

function createContentFiltersArea(): HTMLElement {
  if (!draft) return element("section");
  const filters = draft.contentFilters;
  const masterToggle = createToggle(
    "隐藏干扰内容",
    filters.enabled,
    "content-filters-master-toggle"
  );
  masterToggle.input.addEventListener("change", () => {
    if (!draft) return;
    draft.contentFilters.enabled = masterToggle.input.checked;
    renderOptionsPreservingScroll();
    updateDirtyState();
  });

  const elementToggles = CONTENT_FILTER_IDS.map((id) => {
    const meta = CONTENT_FILTER_META[id];
    const toggle = createToggle(meta.title, filters.hiddenElements[id], `content-filter-${id}`);
    toggle.input.disabled = !filters.enabled;
    toggle.input.addEventListener("change", () => {
      if (!draft) return;
      draft.contentFilters.hiddenElements[id] = toggle.input.checked;
      updateDirtyState();
    });
    return element("div", {
      className: "content-filter-item",
      children: [
        element("div", {
          children: [
            element("strong", { text: meta.title }),
            element("p", { text: meta.description })
          ]
        }),
        toggle.label
      ]
    });
  });

  const shortcutToggle = createToggle(
    "按斜杠键直达搜索",
    filters.slashToSearch,
    "slash-search-toggle"
  );
  shortcutToggle.input.disabled = !filters.enabled;
  shortcutToggle.input.addEventListener("change", () => {
    if (!draft) return;
    draft.contentFilters.slashToSearch = shortcutToggle.input.checked;
    updateDirtyState();
  });

  const cardToggle = createToggle(
    "按标题隐藏视频卡片",
    filters.videoCards.enabled,
    "video-card-filter-toggle"
  );
  const keywordInput = element("textarea", {
    className: "input content-filter-textarea",
    attrs: {
      rows: "5",
      placeholder: "例如：赛事集锦\n直播回放",
      "aria-label": "要隐藏的视频标题关键词，每行一个"
    },
    text: filters.videoCards.keywords.join("\n")
  });
  const regexInput = element("textarea", {
    className: "input content-filter-textarea",
    attrs: {
      rows: "5",
      placeholder: "例如：第\\d+期",
      "aria-label": "要隐藏的视频标题规则，每行一个"
    },
    text: filters.videoCards.regexPatterns.join("\n")
  });
  const cardInputsDisabled = !filters.enabled || !filters.videoCards.enabled;
  cardToggle.input.disabled = !filters.enabled;
  keywordInput.disabled = cardInputsDisabled;
  regexInput.disabled = cardInputsDisabled;
  cardToggle.input.addEventListener("change", () => {
    if (!draft) return;
    draft.contentFilters.videoCards.enabled = cardToggle.input.checked;
    keywordInput.disabled = !cardToggle.input.checked;
    regexInput.disabled = !cardToggle.input.checked;
    updateDirtyState();
  });
  keywordInput.addEventListener("input", () => {
    if (!draft) return;
    draft.contentFilters.videoCards.keywords = parseLines(keywordInput.value);
    updateDirtyState();
  });
  regexInput.addEventListener("input", () => {
    if (!draft) return;
    draft.contentFilters.videoCards.regexPatterns = parseLines(regexInput.value);
    updateDirtyState();
  });

  return element("section", {
    attrs: { id: "content-filters", "aria-labelledby": "content-filters-title" },
    children: [
      createSectionHeading("content-filters-title", "内容降噪", "选择要隐藏的页面内容。"),
      element("div", {
        className: "content-filter-card card",
        children: [
          element("div", {
            className: "access-toggle-row",
            children: [
              element("div", {
                children: [
                  element("strong", { text: "隐藏干扰内容" }),
                  element("p", { text: "关闭后不应用隐藏规则" })
                ]
              }),
              masterToggle.label
            ]
          }),
          element("div", { className: "content-filter-grid", children: elementToggles }),
          element("div", {
            className: "content-filter-item content-filter-item--wide",
            children: [
              element("div", {
                children: [
                  element("strong", { text: "按 / 直达搜索" }),
                  element("p", { text: "不在输入框中时按 /，光标会直接进入站内搜索" })
                ]
              }),
              shortcutToggle.label
            ]
          }),
          element("div", {
            className: "video-card-filter",
            children: [
              element("div", {
                className: "access-toggle-row",
                children: [
                  element("div", {
                    children: [
                      element("strong", { text: "按标题隐藏视频" }),
                      element("p", { text: "命中关键词或规则的卡片不会出现在信息流和搜索结果中" })
                    ]
                  }),
                  cardToggle.label
                ]
              }),
              element("div", {
                className: "content-filter-fields",
                children: [
                  element("label", {
                    className: "field",
                    children: [
                      element("span", { text: "标题关键词（每行一个）" }),
                      keywordInput,
                      element("span", { className: "field__hint", text: "不区分大小写" })
                    ]
                  }),
                  element("label", {
                    className: "field",
                    children: [
                      element("span", { text: "标题规则（高级，每行一个）" }),
                      regexInput,
                      element("span", {
                        className: "field__hint",
                        text: "不完整或可能拖慢页面的规则会被安全忽略"
                      })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  });
}

function createSectionsArea(): HTMLElement {
  if (!draft) return element("section");
  return element("section", {
    attrs: { id: "sections", "aria-labelledby": "sections-title" },
    children: [
      createSectionHeading("sections-title", "整页专注", "设置板块限额和时间规则。"),
      element("div", {
        className: "section-list",
        children: SECTION_IDS.map((section) => createSectionCard(section))
      })
    ]
  });
}

function createSectionCard(section: SectionId): HTMLElement {
  if (!draft) return element("article");
  const rule = draft.sectionRules[section];
  const sectionToggle = createToggle(
    `专注拦截${SECTION_LABELS[section]}`,
    rule.enabled,
    `section-toggle-${section}`
  );
  const card = element("details", {
    className: "section-card card",
    dataset: { enabled: String(rule.enabled) },
    attrs: {
      style: `--section-color: ${SECTION_META[section].color}`,
      open: section === "home"
    }
  });
  sectionToggle.label.addEventListener("click", (event) => event.stopPropagation());
  sectionToggle.input.addEventListener("change", () => {
    if (!draft) return;
    draft.sectionRules[section].enabled = sectionToggle.input.checked;
    card.dataset.enabled = String(sectionToggle.input.checked);
    updateDirtyState();
  });

  const limitInput = element("input", {
    className: "input",
    attrs: {
      type: "number",
      min: "1",
      max: "1440",
      step: "5",
      value: rule.dailyLimitMinutes ?? "",
      placeholder: "不限额",
      "aria-label": `${SECTION_LABELS[section]}每日限额（分钟）`,
      "data-testid": `daily-limit-${section}`
    }
  });
  limitInput.addEventListener("input", () => {
    if (!draft) return;
    const parsed = Number(limitInput.value);
    draft.sectionRules[section].dailyLimitMinutes = limitInput.value
      ? Math.min(1440, Math.max(1, Math.round(parsed)))
      : null;
    updateDirtyState();
  });

  const scheduleItems =
    rule.schedules.length > 0
      ? rule.schedules.map((schedule) => createScheduleItem(section, schedule))
      : [
          element("li", {
            className: "schedule-empty",
            text:
              rule.dailyLimitMinutes === null ? "未设时段，全天不可用" : "未设时段，按每日限额执行"
          })
        ];
  const addButton = element("button", {
    className: "btn",
    attrs: {
      type: "button",
      "aria-label": `为${SECTION_LABELS[section]}添加时间规则`,
      "data-testid": section === "home" ? "schedule-add" : `schedule-add-${section}`
    },
    children: [icon("plus"), "自定义"]
  });
  addButton.addEventListener("click", () => openScheduleDialog(section));
  const presetButton = element("button", {
    className: "btn",
    attrs: { type: "button", "aria-label": `为${SECTION_LABELS[section]}添加常用时段` },
    children: [icon("clock"), "常用时段"]
  });
  presetButton.addEventListener("click", () => openPresetDialog(section));

  const allowCount = rule.schedules.filter((schedule) => schedule.effect === "allow").length;
  const blockCount = rule.schedules.filter((schedule) => schedule.effect === "block").length;

  card.append(
    element("summary", {
      className: "section-card__header",
      children: [
        element("div", {
          className: "section-card__identity",
          children: [
            element("span", {
              className: "section-card__icon",
              children: [icon(section === "home" ? "home" : "sparkles")]
            }),
            element("span", {
              children: [
                element("h3", { text: SECTION_LABELS[section] }),
                element("p", { text: SECTION_META[section].description })
              ]
            })
          ]
        }),
        element("span", {
          className: "section-card__summary-actions",
          children: [
            element("span", {
              className: "section-card__summary",
              text: `${rule.dailyLimitMinutes ? `每天 ${rule.dailyLimitMinutes} 分钟` : "不限时"} · ${allowCount} 可用 / ${blockCount} 不可用`
            }),
            sectionToggle.label,
            element("span", { className: "section-card__chevron", children: [icon("chevron")] })
          ]
        })
      ]
    }),
    element("div", {
      className: "section-card__body",
      children: [
        element("div", { className: "section-card__divider" }),
        element("div", {
          className: "limit-row",
          children: [
            element("div", {
              children: [
                element("strong", { text: "每日限额" }),
                element("p", { text: "达到限额后不可用" })
              ]
            }),
            element("label", {
              className: "limit-control",
              children: [limitInput, element("span", { text: "分钟 / 天" })]
            })
          ]
        }),
        element("div", {
          className: "schedule-heading",
          children: [
            element("div", {
              children: [
                element("h4", { text: "时间黑白名单" }),
                element("p", { text: "时段重叠时，可用优先" })
              ]
            }),
            element("div", {
              className: "schedule-heading__actions",
              children: [presetButton, addButton]
            })
          ]
        }),
        element("ul", { className: "schedule-list", children: scheduleItems })
      ]
    })
  );
  return card;
}

function createScheduleItem(section: SectionId, schedule: TimeAccessRule): HTMLLIElement {
  const editButton = element("button", {
    className: "btn btn--icon",
    attrs: { type: "button", title: "编辑时段", "aria-label": `编辑${schedule.name}` },
    children: [icon("edit")]
  });
  editButton.addEventListener("click", () => openScheduleDialog(section, schedule));
  const deleteButton = element("button", {
    className: "btn btn--icon btn--danger",
    attrs: { type: "button", title: "删除时段", "aria-label": `删除${schedule.name}` },
    children: [icon("trash")]
  });
  deleteButton.addEventListener("click", () => {
    if (!draft) return;
    draft.sectionRules[section].schedules = draft.sectionRules[section].schedules.filter(
      (candidate) => candidate.id !== schedule.id
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

function openScheduleDialog(section: SectionId, existing?: TimeAccessRule): void {
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
                text: existing ? "编辑时间规则" : `为${SECTION_LABELS[section]}添加时间规则`,
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
    const schedules = draft.sectionRules[section].schedules;
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

function openPresetDialog(section: SectionId): void {
  if (!draft) return;
  const titleId = `preset-dialog-${section}`;
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
              addPreset(section, preset, effect, dayInputs, note)
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
  section: SectionId,
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

  const rules = draft.sectionRules[section].schedules;
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
  setButtonBusy(button, true, "保存中");
  if (button !== topSaveButton && topSaveButton) topSaveButton.disabled = true;
  if (button !== savebarButton && savebarButton) savebarButton.disabled = true;
  try {
    draft = cloneSettings(await sendRequest({ type: "UPDATE_SETTINGS", patch: draft }));
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
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    enabled: settings.enabled,
    temporaryAccess: { ...settings.temporaryAccess },
    planMode: { ...settings.planMode },
    contentFilters: {
      ...settings.contentFilters,
      hiddenElements: { ...settings.contentFilters.hiddenElements },
      videoCards: {
        ...settings.contentFilters.videoCards,
        keywords: [...settings.contentFilters.videoCards.keywords],
        regexPatterns: [...settings.contentFilters.videoCards.regexPatterns]
      }
    },
    sectionRules: Object.fromEntries(
      SECTION_IDS.map((section) => [
        section,
        {
          ...settings.sectionRules[section],
          schedules: settings.sectionRules[section].schedules.map((schedule) => ({
            ...schedule,
            days: [...schedule.days]
          }))
        }
      ])
    ) as FocusSettings["sectionRules"]
  };
}

function parseLines(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  ].slice(0, 50);
}

function snapshot(settings: FocusSettings): string {
  return JSON.stringify(settings);
}

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `schedule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
