import {
  createLocalModuleImportPreview,
  LocalModuleImportError,
  parseLocalModuleFiles
} from "../modules/local/importer";
import {
  LOCAL_MODULE_IMPORT_RISK_CODE,
  type LocalModuleDefinition,
  type LocalModuleFile,
  type LocalModuleSnapshot,
  type LocalModuleWarningCode
} from "../modules/local/types";
import { originsFromLocalModule } from "../modules/local/validation";
import { configureLocale, localizeDocumentTitle, t } from "../shared/i18n";
import { sendRequest } from "../shared/messages";
import type { DeepPartial, FocusSettings } from "../shared/types";
import { assertAppRoot, describeError, element, setButtonBusy, toast } from "../styles/dom";
import { createPageNavigation } from "../ui/page-navigation";
import { addManagedSite, requestLocalModulePermissions } from "../ui/site-management";

const MODULE_CATALOG_URL = "https://github.com/446F7269616E/Hourleaf/tree/main/optional-modules";
const app = assertAppRoot();
let settings: FocusSettings | null = null;
let localModules: LocalModuleSnapshot | null = null;
const settingsGroupStates = new Map<string, boolean>();

document.body.classList.add("home-page");
configureLocale("system");
void loadSettings();

async function loadSettings(): Promise<void> {
  renderLoading();
  try {
    [settings, localModules] = await Promise.all([
      sendRequest({ type: "GET_SETTINGS" }),
      sendRequest({ type: "GET_LOCAL_MODULES" })
    ]);
    configureLocale((settings as FocusSettings & { locale?: string }).locale);
    localizeDocumentTitle("settings");
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
        attrs: { "aria-busy": "true", "aria-label": t("settings.loading") },
        children: [element("h2", { text: t("settings.loading") })]
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
  retry.addEventListener("click", () => void loadSettings());
  app.replaceChildren(
    createShell(
      element("section", {
        className: "card state-view home-state",
        attrs: { role: "alert" },
        children: [
          element("h2", { text: t("settings.loadFailed") }),
          element("p", { text: message }),
          retry
        ]
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
          element("h1", { className: "page-title", text: t("settings.title") }),
          element("p", { text: t("settings.description") })
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
    text: t("settings.importModule"),
    attrs: { type: "button", "data-testid": "module-import-open" }
  });
  importButton.addEventListener("click", openImportDialog);
  const installations = Object.values(localModules.store.installations).sort((left, right) =>
    left.definition.name.localeCompare(right.definition.name, "zh-CN")
  );
  const warningItems = localModules.runtime.warnings.map((warning) =>
    element("li", { text: describeLocalModuleWarning(warning) })
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
              element("h2", {
                text: t("settings.modules"),
                attrs: { id: "module-settings-title" }
              }),
              element("p", {
                text: t("settings.modulesDescription")
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
      createSettingsGroup(
        "module-library",
        t("settings.moduleLibrary"),
        t("settings.moduleLibraryDescription", { count: installations.length }),
        [
          installations.length > 0
            ? element("div", {
                className: "home-module-list",
                children: installations.map(createLocalModuleCard)
              })
            : element("section", {
                className: "home-module-empty",
                children: [
                  element("h3", { text: t("settings.noModules") }),
                  element("p", {
                    text: t("settings.noModulesDescription")
                  })
                ]
              })
        ],
        true
      )
    ]
  });
}

function createModuleBoundaryNotice(): HTMLElement {
  const catalogLink = element("a", {
    className: "btn",
    text: t("settings.openCatalog"),
    attrs: { href: MODULE_CATALOG_URL, target: "_blank", rel: "noopener noreferrer" }
  });
  return element("aside", {
    className: "card home-module-boundary",
    attrs: { "aria-label": t("settings.moduleBoundary") },
    children: [
      element("div", {
        children: [
          element("strong", { text: t("settings.moduleBoundary") }),
          element("p", {
            text: t("settings.moduleBoundaryDescription")
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
  const toggle = createToggle(
    t("settings.enableModule", { module: definition.name }),
    enabled,
    `local-module-${definition.id}`
  );
  toggle.input.addEventListener("change", () => {
    void setLocalModuleEnabled(definition.id, toggle.input.checked, toggle.input);
  });
  const remove = element("button", {
    className: "btn btn--danger",
    text: t("common.delete"),
    attrs: { type: "button" }
  });
  remove.addEventListener("click", () => {
    openConfirmation({
      title: t("settings.moduleRemoveQuestion", { module: definition.name }),
      detail: t("settings.moduleRemoveDetail"),
      actionLabel: t("common.delete"),
      onConfirm: async () => {
        localModules = await sendRequest({ type: "REMOVE_LOCAL_MODULE", moduleId: definition.id });
        toast(t("settings.moduleRemoved"));
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
            text: enabled ? t("common.enabled") : t("common.disabled")
          }),
          element("div", { className: "home-module__actions", children: [toggle.label, remove] })
        ]
      }),
      element("div", {
        className: "home-module__details",
        children: [
          createModuleDetail(t("settings.moduleAuthor"), definition.author),
          createModuleDetail(t("settings.moduleFormat"), definition.format),
          createModuleDetail(t("settings.moduleSites"), definition.matches.join(", ")),
          createModuleDetail(
            t("settings.moduleCapabilities"),
            definition.capabilities.length > 0
              ? formatModuleCapabilities(definition.capabilities)
              : t("settings.metadataOnly")
          ),
          createModuleDetail(t("settings.moduleSource"), t("settings.localFileSource"))
        ]
      })
    ]
  });
}

function createModuleDetail(label: string, value: string): HTMLElement {
  return element("p", {
    children: [element("strong", { text: `${label}: ` }), document.createTextNode(value)]
  });
}

function formatModuleCapabilities(capabilities: LocalModuleDefinition["capabilities"]): string {
  return capabilities
    .map((capability) =>
      t(
        capability === "domain-policy"
          ? "settings.capability.domainPolicy"
          : capability === "hide-elements"
            ? "settings.capability.hideElements"
            : capability === "css"
              ? "settings.capability.css"
              : "settings.capability.userScript"
      )
    )
    .join(", ");
}

function describeLocalModuleImportError(error: LocalModuleImportError): string {
  if (error.code === "selection-required" || error.code === "file-limit-exceeded") {
    return t("settings.importError.selection");
  }
  if (
    error.code === "invalid-file" ||
    error.code === "duplicate-file" ||
    error.code === "unsupported-file-type"
  ) {
    return t("settings.importError.file");
  }
  if (error.code === "invalid-reference" || error.code === "missing-reference") {
    return t("settings.importError.reference");
  }
  if (error.code === "metadata-required" || error.code === "metadata-conflict") {
    return t("settings.importError.metadata");
  }
  if (
    error.code === "unsafe-css" ||
    error.code === "unsafe-user-script" ||
    error.code === "unsupported-dnr"
  ) {
    return t("settings.importError.unsafe");
  }
  return t("settings.importError.manifest");
}

function openImportDialog(): void {
  let candidate: LocalModuleDefinition | null = null;
  const fileInput = element("input", {
    className: "input",
    attrs: {
      type: "file",
      multiple: true,
      accept: ".json,.css,.user.js,application/json,text/css,text/javascript",
      "data-testid": "module-import-files"
    }
  });
  const preview = element("div", {
    className: "home-import-preview",
    attrs: { role: "status", "aria-live": "polite" },
    text: t("settings.importInitial")
  });
  const confirm = element("button", {
    className: "btn btn--primary",
    text: t("settings.importConfirm"),
    attrs: { type: "button", "data-testid": "module-import-confirm" }
  });
  confirm.disabled = true;
  const acknowledgement = element("input", {
    attrs: { type: "checkbox", "aria-label": t("settings.importDisclaimer") }
  });
  const acknowledgementLabel = element("label", {
    className: "home-import-acknowledgement",
    children: [acknowledgement, element("span", { text: t("settings.importDisclaimer") })]
  });
  const cancel = element("button", {
    className: "btn",
    text: t("common.cancel"),
    attrs: { type: "button" }
  });
  const close = element("button", {
    className: "btn btn--icon",
    text: "×",
    attrs: { type: "button", title: t("common.close"), "aria-label": t("common.close") }
  });
  const dialog = element("dialog", {
    className: "dialog home-import-dialog",
    attrs: { "aria-labelledby": "module-import-title" },
    children: [
      element("div", {
        className: "home-import-dialog__surface",
        children: [
          element("header", {
            className: "home-import-dialog__header",
            children: [
              element("div", {
                children: [
                  element("h2", {
                    text: t("settings.importTitle"),
                    attrs: { id: "module-import-title" }
                  }),
                  element("p", { text: t("settings.importDescription") })
                ]
              }),
              close
            ]
          }),
          element("div", {
            className: "home-import-dialog__body",
            children: [
              element("label", {
                className: "home-import-picker",
                children: [
                  element("strong", { text: t("settings.importFiles") }),
                  element("span", { text: t("settings.importFilesDescription") }),
                  fileInput
                ]
              }),
              preview,
              acknowledgementLabel
            ]
          }),
          element("footer", {
            className: "home-import-dialog__footer",
            children: [cancel, confirm]
          })
        ]
      })
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
        const importPreview = createLocalModuleImportPreview(candidate);
        preview.replaceChildren(
          element("strong", { text: `${importPreview.name} ${importPreview.version}` }),
          element("p", { text: `${t("settings.moduleAuthor")}: ${importPreview.author}` }),
          element("p", { text: `${t("settings.moduleFormat")}: ${importPreview.format}` }),
          element("p", {
            text: `${t("settings.moduleSites")}: ${importPreview.matches.join(", ")}`
          }),
          element("p", {
            text: `${t("settings.moduleCapabilities")}: ${formatModuleCapabilities(importPreview.capabilities) || t("settings.metadataOnly")}`
          })
        );
        confirm.disabled = !acknowledgement.checked;
      } catch (error) {
        preview.textContent =
          error instanceof LocalModuleImportError
            ? describeLocalModuleImportError(error)
            : describeError(error);
      }
    })();
  });
  acknowledgement.addEventListener("change", () => {
    confirm.disabled = !candidate || !acknowledgement.checked;
  });
  const closeDialog = () => dialog.close();
  cancel.addEventListener("click", closeDialog);
  close.addEventListener("click", closeDialog);
  confirm.addEventListener("click", () => {
    if (!candidate || !acknowledgement.checked) return;
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
      throw new Error(t("settings.safariScriptUnsupported"));
    }
    const granted = await requestLocalModulePermissions(
      definition.matches,
      definition.userScript.trim().length > 0
    );
    if (!granted) throw new Error(t("settings.permissionDenied"));
    for (const origin of originsFromLocalModule(definition)) await addManagedSite(origin);
    localModules = await sendRequest({
      type: "IMPORT_LOCAL_MODULE",
      module: definition,
      riskAcknowledgement: LOCAL_MODULE_IMPORT_RISK_CODE
    });
    localModules = await sendRequest({
      type: "SET_LOCAL_MODULE_ENABLED",
      moduleId: definition.id,
      enabled: true
    });
    dialog.close();
    toast(
      localModules.runtime.warnings[0]
        ? describeLocalModuleWarning(localModules.runtime.warnings[0])
        : t("settings.moduleImported")
    );
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
    toast(
      localModules.runtime.warnings[0]
        ? describeLocalModuleWarning(localModules.runtime.warnings[0])
        : enabled
          ? t("settings.moduleEnabled")
          : t("settings.moduleDisabled")
    );
    renderSettings();
  } catch (error) {
    toast(describeError(error), "error");
    await loadSettings();
  }
}

function describeLocalModuleWarning(warning: LocalModuleWarningCode): string {
  return t(
    warning === "unsafe-user-script"
      ? "settings.warning.unsafeUserScript"
      : warning === "safari-user-script-disabled"
        ? "settings.warning.safariUserScriptDisabled"
        : warning === "user-scripts-api-unavailable"
          ? "settings.warning.userScriptsApiUnavailable"
          : warning === "user-scripts-permission-required"
            ? "settings.warning.userScriptsPermissionRequired"
            : "settings.warning.legacyDnrCleanupFailed"
  );
}

function createPluginSettingsPanel(): HTMLElement {
  if (!settings) return element("section");
  const focusToggle = createToggle(
    t("settings.focusEnabled"),
    settings.enabled,
    "settings-focus-toggle"
  );
  focusToggle.input.addEventListener("change", () => {
    void updateSettings({ enabled: focusToggle.input.checked }, focusToggle.input);
  });
  const locale = element("select", {
    className: "select",
    attrs: {
      value: settings.locale,
      "aria-label": t("settings.language")
    },
    children: [
      element("option", { attrs: { value: "system" }, text: t("locale.system") }),
      element("option", { attrs: { value: "zh-CN" }, text: t("locale.zhCN") }),
      element("option", { attrs: { value: "en" }, text: t("locale.en") })
    ]
  });
  locale.addEventListener("change", () => {
    void updateSettings({ locale: locale.value as FocusSettings["locale"] }, locale);
  });
  const autoComplete = createToggle(
    t("settings.planAutoComplete"),
    settings.planMode.autoCompleteOnStart,
    "settings-plan-auto-complete"
  );
  autoComplete.input.addEventListener("change", () => {
    void updateSettings(
      { planMode: { autoCompleteOnStart: autoComplete.input.checked } },
      autoComplete.input
    );
  });
  const iconMinutes = createToggle(
    t("settings.showRemainingMinutesOnIcon"),
    settings.showRemainingMinutesOnIcon,
    "settings-show-remaining-minutes"
  );
  iconMinutes.input.addEventListener("change", () => {
    void updateSettings(
      { showRemainingMinutesOnIcon: iconMinutes.input.checked },
      iconMinutes.input
    );
  });
  const endView = element("select", {
    className: "select",
    attrs: { value: settings.endPage.view, "aria-label": t("settings.endPageView") },
    children: [
      element("option", {
        attrs: { value: "dashboard" },
        text: t("settings.endView.dashboard")
      }),
      element("option", { attrs: { value: "message" }, text: t("settings.endView.message") }),
      element("option", { attrs: { value: "minimal" }, text: t("settings.endView.minimal") })
    ]
  });
  endView.addEventListener("change", () => {
    void updateSettings(
      { endPage: { view: endView.value as FocusSettings["endPage"]["view"] } },
      endView
    );
  });
  const motivation = element("textarea", {
    className: "input home-end-message",
    attrs: {
      maxlength: "500",
      rows: "3",
      placeholder: t("settings.motivationPlaceholder"),
      "aria-label": t("settings.motivation")
    },
    text: settings.endPage.motivationalMessage
  });
  motivation.addEventListener("change", () => {
    void updateSettings({ endPage: { motivationalMessage: motivation.value.trim() } }, motivation);
  });
  const unlockMethod = element("select", {
    className: "select",
    attrs: {
      value: settings.endPage.groupUnlock.method,
      "aria-label": t("settings.groupUnlock")
    },
    children: [
      element("option", { attrs: { value: "none" }, text: t("settings.unlock.none") }),
      element("option", { attrs: { value: "wait" }, text: t("settings.unlock.wait") }),
      element("option", { attrs: { value: "math" }, text: t("settings.unlock.math") }),
      element("option", { attrs: { value: "password" }, text: t("settings.unlock.password") })
    ]
  });
  const currentUnlockMethod = settings.endPage.groupUnlock.method;
  const hasPasswordVerifier = settings.endPage.groupUnlock.passwordVerifier.length === 64;
  unlockMethod.addEventListener("change", () => {
    if (unlockMethod.value === "password" && !hasPasswordVerifier) {
      unlockMethod.value = currentUnlockMethod;
      toast(t("settings.passwordRequired"), "error");
      password.focus();
      return;
    }
    void updateSettings(
      {
        endPage: {
          groupUnlock: {
            method: unlockMethod.value as FocusSettings["endPage"]["groupUnlock"]["method"]
          }
        }
      },
      unlockMethod
    );
  });
  const waitMinutes = element("input", {
    className: "input",
    attrs: {
      type: "number",
      min: "1",
      max: "120",
      step: "1",
      value: settings.endPage.groupUnlock.waitMinutes,
      "aria-label": t("settings.waitMinutes")
    }
  });
  waitMinutes.addEventListener("change", () => {
    void updateSettings(
      {
        endPage: {
          groupUnlock: { waitMinutes: clampNumberInput(waitMinutes, 1, 120) }
        }
      },
      waitMinutes
    );
  });
  const password = element("input", {
    className: "input",
    attrs: {
      type: "password",
      maxlength: "128",
      autocomplete: "new-password",
      placeholder: t("settings.passwordPlaceholder"),
      "aria-label": t("settings.password")
    }
  });
  password.addEventListener("change", () => {
    if (!password.value) return;
    void (async () => {
      const verifier = await sha256(password.value);
      password.value = "";
      await updateSettings({ endPage: { groupUnlock: { passwordVerifier: verifier } } }, password);
    })();
  });
  const clearUsage = element("button", {
    className: "btn btn--danger",
    text: t("settings.clearUsage"),
    attrs: { type: "button" }
  });
  clearUsage.addEventListener("click", () => {
    openConfirmation({
      title: t("settings.clearUsageQuestion"),
      detail: t("settings.clearUsageDetail"),
      actionLabel: t("settings.clearUsage"),
      onConfirm: async () => {
        await sendRequest({ type: "CLEAR_USAGE" });
        toast(t("settings.cleared"));
      }
    });
  });
  const resetSettings = element("button", {
    className: "btn",
    text: t("settings.reset"),
    attrs: { type: "button" }
  });
  resetSettings.addEventListener("click", () => {
    openConfirmation({
      title: t("settings.resetQuestion"),
      detail: t("settings.resetDetail"),
      actionLabel: t("settings.reset"),
      onConfirm: async () => {
        settings = await sendRequest({ type: "RESET_SETTINGS" });
        configureLocale(settings.locale);
        toast(t("settings.resetDone"));
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
        t("settings.other"),
        t("settings.otherDescription")
      ),
      element("div", {
        className: "home-plugin-card card",
        children: [
          createSettingsGroup(
            "general",
            t("settings.general"),
            t("settings.generalDescription"),
            [
              createSettingRow(
                t("settings.focusEnabled"),
                t("settings.focusEnabledDescription"),
                focusToggle.label
              ),
              createSettingRow(t("settings.language"), t("settings.languageDescription"), locale),
              createSettingRow(
                t("settings.planAutoComplete"),
                t("settings.planAutoCompleteDescription"),
                autoComplete.label
              ),
              createSettingRow(
                t("settings.showRemainingMinutesOnIcon"),
                t("settings.showRemainingMinutesOnIconDescription"),
                iconMinutes.label
              )
            ],
            true
          ),
          createSettingsGroup(
            "end-page",
            t("settings.endPage"),
            t("settings.endPageDescription"),
            [
              createSettingRow(
                t("settings.endPageView"),
                t("settings.endPageViewDescription"),
                endView
              ),
              createSettingRow(
                t("settings.motivation"),
                t("settings.motivationDescription"),
                motivation
              ),
              createSettingRow(
                t("settings.groupUnlock"),
                t("settings.groupUnlockDescription"),
                unlockMethod
              ),
              ...(settings.endPage.groupUnlock.method === "wait"
                ? [
                    createSettingRow(
                      t("settings.waitMinutes"),
                      t("settings.waitMinutesDescription"),
                      element("label", {
                        className: "home-number-control",
                        children: [waitMinutes, element("span", { text: t("common.minutes") })]
                      })
                    )
                  ]
                : []),
              createSettingRow(t("settings.password"), t("settings.passwordStored"), password)
            ],
            true
          ),
          createSettingsGroup(
            "data-management",
            t("settings.dataManagement"),
            t("settings.dataManagementDescription"),
            [
              element("div", {
                className: "home-settings__actions",
                children: [resetSettings, clearUsage]
              })
            ],
            false
          )
        ]
      })
    ]
  });
}

function createSettingsGroup(
  id: string,
  title: string,
  description: string,
  children: HTMLElement[],
  open: boolean
): HTMLDetailsElement {
  const group = element("details", {
    className: "home-settings-group",
    attrs: { open: settingsGroupStates.get(id) ?? open, "data-settings-group": id },
    children: [
      element("summary", {
        className: "home-settings-group__summary",
        children: [
          element("div", {
            children: [element("h3", { text: title }), element("p", { text: description })]
          }),
          element("span", {
            className: "home-settings-group__chevron",
            attrs: { "aria-hidden": "true" }
          })
        ]
      }),
      element("div", { className: "home-settings-group__content", children })
    ]
  });
  group.addEventListener("toggle", () => settingsGroupStates.set(id, group.open));
  return group;
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
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): Promise<void> {
  control.disabled = true;
  try {
    settings = await sendRequest({ type: "UPDATE_SETTINGS", patch });
    configureLocale(settings.locale);
    localizeDocumentTitle("settings");
    toast(t("common.saved"));
    renderSettings();
  } catch (error) {
    toast(describeError(error), "error");
    await loadSettings();
  }
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
          element("button", {
            className: "btn",
            text: t("common.cancel"),
            attrs: { type: "button" }
          }),
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
