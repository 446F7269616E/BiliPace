import { sendRequest } from "../shared/messages";
import {
  SECTION_IDS,
  SECTION_LABELS,
  type BlockingSchedule,
  type FocusSettings,
  type SectionId,
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
      attrs: { "aria-busy": "true", "aria-label": "正在加载设置" },
      children: [
        element("div", {
          children: [
            element("div", { className: "state-view__icon", children: [icon("settings")] }),
            element("h2", { text: "正在准备你的专注空间" }),
            element("p", { text: "读取板块规则与专注计划…" })
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
            element("h2", { text: "设置加载失败" }),
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
    children: [
      createPageHeader(),
      createGuide(),
      element("div", {
        className: "settings-layout",
        children: [createNavigation(), createSettingsContent()]
      })
    ]
  });
  savebar = createSavebar();
  shell.append(topbar, content, savebar);
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
    text: "设置已保存",
    dataset: { dirty: "false" }
  });

  return element("header", {
    className: "options-topbar",
    children: [
      element("div", {
        className: "options-topbar__inner",
        children: [
          createBrand(),
          element("div", {
            className: "cluster",
            children: [
              saveState,
              element("a", {
                className: "btn",
                attrs: { href: "plan.html", target: "_blank", rel: "noreferrer" },
                children: [icon("calendar"), element("span", { text: "观看计划" })]
              }),
              element("a", {
                className: "btn",
                attrs: { href: "dashboard.html", target: "_blank", rel: "noreferrer" },
                children: [icon("bar-chart"), element("span", { text: "查看仪表盘" })]
              }),
              topSaveButton
            ]
          })
        ]
      })
    ]
  });
}

function createBrand(): HTMLElement {
  return element("a", {
    className: "brand",
    attrs: { href: "options.html", "aria-label": "BiliPace 哔哩节拍设置" },
    children: [
      element("span", { className: "brand__mark", children: [icon("focus")] }),
      element("span", {
        className: "brand__meta",
        children: [element("span", { text: "BiliPace" }), element("small", { text: "非官方扩展" })]
      })
    ]
  });
}

function createPageHeader(): HTMLElement {
  return element("header", {
    className: "options-header",
    children: [
      element("div", {
        children: [
          element("h1", { className: "page-title", text: "把注意力留给真正想看的内容" }),
          element("p", {
            className: "page-description",
            text: "选择要管理的板块，安排专注时间，并为偶尔需要访问的时刻留一点弹性。"
          })
        ]
      }),
      element("span", {
        className: "badge badge--success",
        children: [element("span", { className: "badge__dot" }), "本地隐私保护"]
      })
    ]
  });
}

function createGuide(): HTMLElement {
  const stepData = [
    ["选择板块", "打开你想减少干扰的区域"],
    ["安排时间", "设定每周固定的专注时段"],
    ["查看洞察", "用趋势而不是内疚调整习惯"]
  ] as const;
  const steps = stepData.map(([title, description], index) =>
    element("li", {
      className: "guide-step",
      children: [
        element("span", { className: "guide-step__number", text: String(index + 1) }),
        element("span", {
          children: [element("strong", { text: title }), element("span", { text: description })]
        })
      ]
    })
  );
  return element("section", {
    className: "guide-card card",
    attrs: { "aria-labelledby": "guide-title" },
    children: [
      element("div", {
        className: "guide-card__intro",
        children: [
          element("p", { className: "guide-card__eyebrow", text: "3 步开始" }),
          element("h2", { text: "第一次使用？", attrs: { id: "guide-title" } }),
          element("p", { text: "默认管理首页、动态和热门。你可以随时调整，所有数据都只在本地。" })
        ]
      }),
      element("ol", { className: "guide-steps", children: steps })
    ]
  });
}

function createNavigation(): HTMLElement {
  const links = [
    ["sections", "shield", "板块管理"],
    ["plan-mode", "calendar", "计划模式"],
    ["access", "unlock", "临时放行"],
    ["privacy", "lock", "数据与隐私"]
  ] as const;
  return element("aside", {
    children: [
      element("nav", {
        className: "settings-nav",
        attrs: { "aria-label": "设置页导航" },
        children: [
          ...links.map(([target, iconName, label]) =>
            element("a", { attrs: { href: `#${target}` }, children: [icon(iconName), label] })
          ),
          element("p", {
            className: "settings-nav__meta",
            text: "计划按本地时间执行。跨午夜时段会延续到次日结束时间。"
          })
        ]
      })
    ]
  });
}

function createSettingsContent(): HTMLElement {
  return element("div", {
    className: "settings-content",
    children: [createSectionsArea(), createPlanArea(), createAccessArea(), createPrivacyArea()]
  });
}

function createSectionsArea(): HTMLElement {
  if (!draft) return element("section");
  const masterToggle = createToggle("专注保护总开关", draft.enabled, "options-master-toggle");
  const masterCard = element("div", {
    className: "master-card card",
    children: [
      element("div", {
        className: "master-card__copy",
        children: [
          element("span", { className: "master-card__icon", children: [icon("shield")] }),
          element("span", {
            children: [
              element("strong", { text: "专注保护总开关" }),
              element("p", { text: "暂停时保留所有规则，再开启即可继续执行" })
            ]
          })
        ]
      }),
      masterToggle.label
    ]
  });
  masterToggle.input.addEventListener("change", () => {
    if (!draft) return;
    draft.enabled = masterToggle.input.checked;
    updateDirtyState();
  });

  return element("section", {
    attrs: { id: "sections", "aria-labelledby": "sections-title" },
    children: [
      createSectionHeading(
        "sections-title",
        "板块管理",
        "单独控制每个区域，并设置每日用量与固定专注计划。"
      ),
      element("div", {
        className: "section-list",
        children: [masterCard, ...SECTION_IDS.map((section) => createSectionCard(section))]
      })
    ]
  });
}

function createSectionCard(section: SectionId): HTMLElement {
  if (!draft) return element("article");
  const rule = draft.sectionRules[section];
  const sectionToggle = createToggle(
    `屏蔽${SECTION_LABELS[section]}`,
    rule.enabled,
    `section-toggle-${section}`
  );
  const card = element("article", {
    className: "section-card card",
    dataset: { enabled: String(rule.enabled) },
    attrs: { style: `--section-color: ${SECTION_META[section].color}` }
  });
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
            text: "没有计划时，只要板块开关开启，就会全天屏蔽。"
          })
        ];
  const addButton = element("button", {
    className: "btn",
    attrs: {
      type: "button",
      "aria-label": `为${SECTION_LABELS[section]}添加计划`,
      "data-testid": section === "home" ? "schedule-add" : `schedule-add-${section}`
    },
    children: [icon("plus"), "添加计划"]
  });
  addButton.addEventListener("click", () => openScheduleDialog(section));

  card.append(
    element("header", {
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
        sectionToggle.label
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
                element("p", { text: "达到限额后，该板块在当天剩余时间内进入屏蔽状态" })
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
                element("h4", { text: "屏蔽计划" }),
                element("p", { text: "多个计划重叠时，屏蔽仍持续生效" })
              ]
            }),
            addButton
          ]
        }),
        element("ul", { className: "schedule-list", children: scheduleItems })
      ]
    })
  );
  return card;
}

function createScheduleItem(section: SectionId, schedule: BlockingSchedule): HTMLLIElement {
  const editButton = element("button", {
    className: "btn btn--icon",
    attrs: { type: "button", title: "编辑计划", "aria-label": `编辑${schedule.name}` },
    children: [icon("edit")]
  });
  editButton.addEventListener("click", () => openScheduleDialog(section, schedule));
  const deleteButton = element("button", {
    className: "btn btn--icon btn--danger",
    attrs: { type: "button", title: "删除计划", "aria-label": `删除${schedule.name}` },
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
    dataset: { enabled: String(schedule.enabled) },
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
          })
        ]
      }),
      element("div", { className: "schedule-item__actions", children: [editButton, deleteButton] })
    ]
  });
}

function createPlanArea(): HTMLElement {
  if (!draft) return element("section");
  const enabledToggle = createToggle("计划模式", draft.planMode.enabled, "plan-mode-toggle");
  const durationInput = numberInput(
    draft.planMode.watchDurationMinutes,
    1,
    360,
    "计划视频单次放行时长（分钟）"
  );

  enabledToggle.input.addEventListener("change", () => {
    if (!draft) return;
    draft.planMode.enabled = enabledToggle.input.checked;
    durationInput.disabled = !enabledToggle.input.checked;
    updateDirtyState();
  });
  durationInput.disabled = !draft.planMode.enabled;
  durationInput.addEventListener("input", () => {
    if (!draft) return;
    draft.planMode.watchDurationMinutes = clampInput(durationInput, 1, 360);
    updateDirtyState();
  });

  return element("section", {
    attrs: { id: "plan-mode", "aria-labelledby": "plan-mode-title" },
    children: [
      createSectionHeading(
        "plan-mode-title",
        "计划模式",
        "先建立观看待办，再为明确选择的视频开启一个有限的观看窗口。"
      ),
      element("div", {
        className: "access-card plan-settings-card card",
        children: [
          element("div", {
            className: "access-toggle-row",
            children: [
              element("div", {
                children: [
                  element("strong", { text: "打开 Bilibili 前先查看计划" }),
                  element("p", {
                    text: "开启后，任意 Bilibili 链接会先回到计划页；只放行从清单中开始的对应视频。"
                  })
                ]
              }),
              enabledToggle.label
            ]
          }),
          element("div", {
            className: "access-fields",
            children: [
              createField(
                "单次观看窗口",
                "到期后再次打开 Bilibili 会回到计划页",
                durationInput,
                "分钟"
              ),
              element("div", {
                className: "plan-settings-card__action",
                children: [
                  element("strong", { text: "管理观看待办" }),
                  element("p", { text: "添加、排序、打卡或批量粘贴视频链接" }),
                  element("a", {
                    className: "btn btn--primary",
                    attrs: { href: "plan.html", target: "_blank", rel: "noreferrer" },
                    children: [icon("calendar"), "打开计划页"]
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

function createAccessArea(): HTMLElement {
  if (!draft) return element("section");
  const enabledToggle = createToggle(
    "临时放行",
    draft.temporaryAccess.enabled,
    "temporary-access-toggle"
  );
  const durationInput = numberInput(
    draft.temporaryAccess.durationMinutes,
    1,
    60,
    "每次放行时长（分钟）"
  );
  const usesInput = numberInput(draft.temporaryAccess.maxUsesPerDay, 0, 50, "每日最多放行次数");

  enabledToggle.input.addEventListener("change", () => {
    if (!draft) return;
    draft.temporaryAccess.enabled = enabledToggle.input.checked;
    durationInput.disabled = !enabledToggle.input.checked;
    usesInput.disabled = !enabledToggle.input.checked;
    updateDirtyState();
  });
  durationInput.disabled = !draft.temporaryAccess.enabled;
  usesInput.disabled = !draft.temporaryAccess.enabled;
  durationInput.addEventListener("input", () => {
    if (!draft) return;
    draft.temporaryAccess.durationMinutes = clampInput(durationInput, 1, 60);
    updateDirtyState();
  });
  usesInput.addEventListener("input", () => {
    if (!draft) return;
    draft.temporaryAccess.maxUsesPerDay = clampInput(usesInput, 0, 50);
    updateDirtyState();
  });

  return element("section", {
    attrs: { id: "access", "aria-labelledby": "access-title" },
    children: [
      createSectionHeading(
        "access-title",
        "临时放行",
        "需要临时访问时，从扩展弹窗获得一段有边界的自由时间。"
      ),
      element("div", {
        className: "access-card card",
        children: [
          element("div", {
            className: "access-toggle-row",
            children: [
              element("div", {
                children: [
                  element("strong", { text: "允许临时放行" }),
                  element("p", { text: "仅对当前板块生效，到期后自动恢复屏蔽" })
                ]
              }),
              enabledToggle.label
            ]
          }),
          element("div", {
            className: "access-fields",
            children: [
              createField(
                "每次时长",
                "建议保持短暂，避免一次放行变成无限浏览",
                durationInput,
                "分钟"
              ),
              createField("每日次数", "用完后当天不再显示临时放行入口", usesInput, "次")
            ]
          })
        ]
      })
    ]
  });
}

function createPrivacyArea(): HTMLElement {
  const reset = element("button", {
    className: "btn btn--danger",
    text: "恢复默认设置",
    attrs: { type: "button" }
  });
  reset.addEventListener("click", () => openResetDialog());
  return element("section", {
    attrs: { id: "privacy", "aria-labelledby": "privacy-title" },
    children: [
      createSectionHeading(
        "privacy-title",
        "数据与隐私",
        "BiliPace 不需要账户，也不会把浏览记录发送到远端。"
      ),
      element("div", {
        className: "privacy-card card",
        children: [
          element("span", { className: "privacy-card__icon", children: [icon("lock")] }),
          element("div", {
            children: [
              element("strong", { text: "本地优先，观看清单由你主动管理" }),
              element("p", {
                text: "使用统计只保存日期、板块与累计秒数；计划模式会在本机保存你主动添加的 BV 号、标题和完成状态，不保存账号密码或 Cookie。"
              })
            ]
          }),
          reset
        ]
      })
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
            children: [
              element("strong", { text: "你有未保存的更改" }),
              element("span", { text: "保存后立即生效" })
            ]
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

function numberInput(value: number, min: number, max: number, label: string): HTMLInputElement {
  return element("input", {
    className: "input",
    attrs: { type: "number", value, min, max, step: "1", "aria-label": label }
  });
}

function createField(
  labelText: string,
  hint: string,
  input: HTMLInputElement,
  suffix: string
): HTMLElement {
  const id = `field-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  return element("label", {
    className: "field",
    attrs: { for: id },
    children: [
      element("span", { text: `${labelText}（${suffix}）` }),
      input,
      element("span", { className: "field__hint", text: hint })
    ]
  });
}

function openScheduleDialog(section: SectionId, existing?: BlockingSchedule): void {
  if (!draft) return;
  const schedule: BlockingSchedule = existing
    ? { ...existing, days: [...existing.days] }
    : {
        id: createId(),
        name: "专注计划",
        enabled: true,
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
      "aria-label": "计划名称"
    }
  });
  const enabledToggle = createToggle("启用这个计划", schedule.enabled, "schedule-enabled");
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
    attrs: { type: "button", title: "关闭", "aria-label": "关闭计划编辑器" },
    children: [icon("close")]
  });
  const cancelButton = element("button", {
    className: "btn",
    text: "取消",
    attrs: { type: "button" }
  });
  const saveButton = element("button", {
    className: "btn btn--primary",
    text: existing ? "保存计划" : "添加计划",
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
                text: existing ? "编辑专注计划" : `为${SECTION_LABELS[section]}添加计划`,
                attrs: { id: titleId }
              }),
              element("p", { className: "muted", text: "计划只在所选日期和时段内触发屏蔽。" })
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
            children: [element("span", { text: "计划名称" }), nameInput]
          }),
          element("div", {
            className: "access-toggle-row",
            children: [
              element("div", {
                children: [
                  element("strong", { text: "启用计划" }),
                  element("p", { text: "暂停后仍保留日期和时间" })
                ]
              }),
              enabledToggle.label
            ]
          }),
          element("fieldset", {
            className: "field",
            children: [
              element("legend", { text: "重复日期" }),
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
                children: [element("span", { text: "开始时间" }), startInput]
              }),
              element("span", { className: "time-fields__dash", text: "至" }),
              element("label", {
                className: "field",
                children: [element("span", { text: "结束时间" }), endInput]
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
      startInput.value >= endInput.value ? "结束时间不晚于开始时间，将按跨午夜计划执行。" : "";
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
    const updated: BlockingSchedule = {
      ...schedule,
      name: nameInput.value.trim(),
      enabled: enabledToggle.input.checked,
      days,
      startTime: startInput.value,
      endTime: endInput.value
    };
    const schedules = draft.sectionRules[section].schedules;
    const index = schedules.findIndex((candidate) => candidate.id === updated.id);
    if (index >= 0) schedules[index] = updated;
    else schedules.push(updated);
    close();
    renderOptionsPreservingScroll();
    toast(existing ? "计划已更新到草稿" : "计划已添加到草稿");
  });

  backdrop.append(form);
  document.body.append(backdrop);
  document.addEventListener("keydown", onKeydown);
  updateNote();
  window.setTimeout(() => nameInput.focus(), 0);
}

function openResetDialog(): void {
  const titleId = "reset-dialog-title";
  const backdrop = element("div", { className: "dialog-backdrop" });
  const cancel = element("button", { className: "btn", text: "取消", attrs: { type: "button" } });
  const confirm = element("button", {
    className: "btn btn--danger",
    text: "恢复默认",
    attrs: { type: "button" }
  });
  const dialog = element("section", {
    className: "dialog",
    attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    children: [
      element("header", {
        className: "dialog__header",
        children: [
          element("div", {
            children: [
              element("h2", { text: "恢复默认设置？", attrs: { id: titleId } }),
              element("p", {
                className: "muted",
                text: "板块开关、限额和所有计划都会恢复。使用时长不会被清除。"
              })
            ]
          })
        ]
      }),
      element("footer", { className: "dialog__footer", children: [cancel, confirm] })
    ]
  });
  const close = (): void => backdrop.remove();
  cancel.addEventListener("click", close);
  confirm.addEventListener("click", () => {
    void resetSettings();
  });

  async function resetSettings(): Promise<void> {
    setButtonBusy(confirm, true, "正在恢复");
    try {
      draft = cloneSettings(await sendRequest({ type: "RESET_SETTINGS" }));
      savedSnapshot = snapshot(draft);
      close();
      renderOptionsPreservingScroll();
      toast("已恢复默认设置");
    } catch (error) {
      setButtonBusy(confirm, false);
      toast(describeError(error), "error");
    }
  }
  backdrop.append(dialog);
  document.body.append(backdrop);
  cancel.focus();
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
    toast("设置已保存并开始生效");
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
    saveState.textContent = dirty ? "有未保存的更改" : "设置已保存";
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

function crossesMidnight(schedule: BlockingSchedule): boolean {
  return schedule.startTime >= schedule.endTime;
}

function clampInput(input: HTMLInputElement, min: number, max: number): number {
  const value = Number(input.value);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min;
}

function cloneSettings(settings: FocusSettings): FocusSettings {
  return {
    schemaVersion: 1,
    enabled: settings.enabled,
    temporaryAccess: { ...settings.temporaryAccess },
    planMode: { ...settings.planMode },
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

function snapshot(settings: FocusSettings): string {
  return JSON.stringify(settings);
}

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `schedule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
