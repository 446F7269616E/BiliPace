import type { BrowserContext } from "@playwright/test";

export interface MockSettings {
  schemaVersion: 4;
  enabled: boolean;
  showRemainingMinutesOnIcon: boolean;
  locale: "system" | "zh-CN" | "en";
  endPage: {
    view: "dashboard" | "message" | "minimal";
    motivationalMessage: string;
    groupUnlock: {
      method: "none" | "wait" | "math" | "password";
      waitMinutes: number;
      passwordVerifier: string;
    };
  };
  sites: Record<
    string,
    {
      id: string;
      origin: string;
      hostname: string;
      label: string;
      enabled: boolean;
      restrictionMode: "lenient" | "flow" | "strict";
      visitConfirmation?: { enabled: boolean; waitSeconds: number };
      targetIds: string[];
      createdAt: number;
      updatedAt: number;
    }
  >;
  targets: Record<
    string,
    {
      id: string;
      siteId: string;
      label: string;
      enabled: boolean;
      dailyLimitMinutes: number | null;
      schedules: unknown[];
      timePeriods: Array<{
        id: string;
        name: string;
        enabled: boolean;
        days: number[];
        startTime: string;
        endTime: string;
        behavior: "timed" | "always-allow" | "always-block";
        limitMinutes: number | null;
        groupCount: number;
      }>;
      temporaryAccess: { enabled: boolean; durationMinutes: number; maxUsesPerDay: number };
      moduleId?: string;
      moduleSectionId?: string;
    }
  >;
  sectionRules: Record<
    string,
    { enabled: boolean; dailyLimitMinutes: number | null; schedules: unknown[] }
  >;
  temporaryAccess: { enabled: boolean; durationMinutes: number; maxUsesPerDay: number };
  planMode: {
    enabled: boolean;
    watchDurationMinutes: number;
    defaultCompletionMode: "lenient" | "flow" | "strict";
    autoCompleteOnStart: boolean;
  };
  contentFilters: {
    enabled: boolean;
    hiddenElements: Record<string, boolean>;
    videoCards: { enabled: boolean; keywords: string[]; regexPatterns: string[] };
    slashToSearch: boolean;
  };
}

const initialSettings: MockSettings = {
  schemaVersion: 4,
  enabled: true,
  showRemainingMinutesOnIcon: true,
  locale: "zh-CN",
  endPage: {
    view: "dashboard",
    motivationalMessage: "",
    groupUnlock: { method: "none", waitMinutes: 5, passwordVerifier: "" }
  },
  sites: {
    "site:bilibili": {
      id: "site:bilibili",
      origin: "https://www.bilibili.com",
      hostname: "www.bilibili.com",
      label: "哔哩哔哩",
      enabled: true,
      restrictionMode: "strict",
      targetIds: [
        "module:bilibili:home",
        "module:bilibili:dynamic",
        "module:bilibili:popular",
        "module:bilibili:video",
        "module:bilibili:live",
        "module:bilibili:bangumi",
        "module:bilibili:search"
      ],
      createdAt: 1,
      updatedAt: 1
    }
  },
  targets: Object.fromEntries(
    ["home", "dynamic", "popular", "video", "live", "bangumi", "search"].map((section) => [
      `module:bilibili:${section}`,
      {
        id: `module:bilibili:${section}`,
        siteId: "site:bilibili",
        label: section,
        enabled: ["home", "dynamic", "popular"].includes(section),
        dailyLimitMinutes: section === "home" ? 45 : null,
        schedules: [],
        timePeriods: [
          {
            id: `period:${section}:all-day`,
            name: "全天",
            enabled: true,
            days: [0, 1, 2, 3, 4, 5, 6],
            startTime: "00:00",
            endTime: "00:00",
            behavior: "timed",
            limitMinutes: section === "home" ? 45 : null,
            groupCount: 1
          }
        ],
        temporaryAccess: { enabled: true, durationMinutes: 5, maxUsesPerDay: 3 },
        moduleId: "hourleaf.site.bilibili",
        moduleSectionId: section
      }
    ])
  ),
  sectionRules: {
    home: { enabled: true, dailyLimitMinutes: null, schedules: [] },
    dynamic: { enabled: true, dailyLimitMinutes: null, schedules: [] },
    popular: { enabled: true, dailyLimitMinutes: null, schedules: [] },
    video: { enabled: false, dailyLimitMinutes: null, schedules: [] },
    live: { enabled: false, dailyLimitMinutes: null, schedules: [] },
    bangumi: { enabled: false, dailyLimitMinutes: null, schedules: [] },
    search: { enabled: false, dailyLimitMinutes: null, schedules: [] }
  },
  temporaryAccess: { enabled: true, durationMinutes: 5, maxUsesPerDay: 3 },
  planMode: {
    enabled: false,
    watchDurationMinutes: 45,
    defaultCompletionMode: "flow",
    autoCompleteOnStart: false
  },
  contentFilters: {
    enabled: true,
    hiddenElements: {
      "home-feed": false,
      "dynamic-feed": false,
      "related-videos": true,
      comments: false,
      "search-suggestions": true,
      ads: true,
      "top-navigation": false
    },
    videoCards: { enabled: false, keywords: [], regexPatterns: [] },
    slashToSearch: true
  }
};

/**
 * Supplies only the WebExtension contract used by the three extension pages.
 * It intentionally uses the Promise-shaped `browser.*` API so the same built
 * UI can execute in Playwright Chromium and Firefox without privileged install.
 */
export async function installWebExtensionMock(context: BrowserContext): Promise<void> {
  await context.addInitScript((seed) => {
    const clone = <T>(value: T): T =>
      value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
    let settings = clone(seed);
    let localModules: {
      schemaVersion: 1;
      installations: Record<string, Record<string, unknown>>;
    } = { schemaVersion: 1, installations: {} };
    let planItems: Array<{
      id: string;
      url: string;
      origin: string;
      title: string;
      status: "pending" | "completed";
      order: number;
      source: "manual" | "watch-later" | "favorite";
      scheduledDurationMinutes: number;
      completionMode: "lenient" | "flow" | "strict";
      addedAt: number;
      completedAt: number | null;
    }> = [];
    const localStore: Record<string, unknown> = {};

    const storageArea = {
      get(keys?: string | string[] | Record<string, unknown> | null) {
        if (keys == null) return Promise.resolve(clone(localStore));
        if (typeof keys === "string") {
          return Promise.resolve({ [keys]: clone(localStore[keys]) });
        }
        if (Array.isArray(keys)) {
          return Promise.resolve(
            Object.fromEntries(keys.map((key) => [key, clone(localStore[key])]))
          );
        }
        return Promise.resolve(
          Object.fromEntries(
            Object.entries(keys).map(([key, fallback]) => [
              key,
              clone(localStore[key] === undefined ? fallback : localStore[key])
            ])
          )
        );
      },
      set(items: Record<string, unknown>) {
        Object.assign(localStore, clone(items));
        return Promise.resolve();
      },
      remove(keys: string | string[]) {
        for (const key of typeof keys === "string" ? [keys] : keys) delete localStore[key];
        return Promise.resolve();
      }
    };

    const ok = (data: unknown) => ({ ok: true, data: clone(data) });
    const runtime = {
      onMessage: { addListener() {} },
      getURL: (relativePath: string) => new URL(relativePath, location.href).href,
      openOptionsPage: () => Promise.resolve(),
      sendMessage(message: {
        version?: number;
        requestId?: string;
        type?: string;
        payload?: {
          patch?: Partial<MockSettings> & {
            restrictionMode?: "lenient" | "flow" | "strict";
            timePeriods?: MockSettings["targets"][string]["timePeriods"];
          };
          module?: Record<string, unknown>;
          period?: string;
          enabled?: boolean;
          watchDurationMinutes?: number;
          defaultCompletionMode?: "lenient" | "flow" | "strict";
          autoCompleteOnStart?: boolean;
          url?: string;
          siteId?: string;
          targetId?: string;
          moduleId?: string;
          action?: string;
          id?: string;
          title?: string;
          source?: "manual" | "watch-later" | "favorite";
          scheduledDurationMinutes?: number;
          completionMode?: "lenient" | "flow" | "strict";
          completed?: boolean;
        };
      }) {
        let result: unknown;
        const payload = message.payload ?? {};
        switch (message.type) {
          case "GET_SETTINGS":
            result = ok(settings);
            break;
          case "GET_SITE_MODULES":
            result = ok({
              schemaVersion: 2,
              installations: {},
              removedModuleIds: []
            });
            break;
          case "GET_LOCAL_MODULES":
            result = ok({
              store: localModules,
              runtime: {
                userScripts: "available",
                declarativeNetRequest: "available",
                warnings: []
              }
            });
            break;
          case "IMPORT_LOCAL_MODULE": {
            const module = payload.module;
            const moduleId = typeof module?.id === "string" ? module.id : "local:test";
            localModules = {
              ...localModules,
              installations: {
                ...localModules.installations,
                [moduleId]: {
                  definition: clone(module),
                  source: "local-file",
                  enabled: false,
                  importedAt: 1,
                  updatedAt: 1
                }
              }
            };
            result = ok({
              store: localModules,
              runtime: {
                userScripts: "available",
                declarativeNetRequest: "available",
                warnings: []
              }
            });
            break;
          }
          case "SET_LOCAL_MODULE_ENABLED": {
            const moduleId = String(payload.moduleId ?? "");
            const installation = localModules.installations[moduleId];
            if (installation) installation.enabled = payload.enabled === true;
            result = ok({
              store: localModules,
              runtime: {
                userScripts: "available",
                declarativeNetRequest: "available",
                warnings: []
              }
            });
            break;
          }
          case "REMOVE_LOCAL_MODULE":
            delete localModules.installations[String(payload.moduleId ?? "")];
            result = ok({
              store: localModules,
              runtime: {
                userScripts: "available",
                declarativeNetRequest: "available",
                warnings: []
              }
            });
            break;
          case "GET_LOCAL_PAGE_RULES":
            result = ok({ css: "", hideSelectors: [], moduleIds: [] });
            break;
          case "ADD_MANAGED_SITE":
            result = ok({
              granted: true,
              origin: new URL(String(payload.url ?? "https://example.com")).origin
            });
            break;
          case "UPDATE_MANAGED_SITE": {
            const siteId = String(payload.siteId ?? "");
            const site = settings.sites[siteId];
            if (!site) {
              result = {
                ok: false,
                error: { code: "NOT_FOUND", message: "Website is not configured" }
              };
              break;
            }
            settings.sites[siteId] = {
              ...site,
              ...(payload.patch ?? {}),
              updatedAt: Date.now()
            };
            result = ok(settings.sites[siteId]);
            break;
          }
          case "UPDATE_SITE_TARGET": {
            const targetId = String(payload.targetId ?? "");
            const target = settings.targets[targetId];
            if (!target) {
              result = {
                ok: false,
                error: { code: "NOT_FOUND", message: "Website target is not configured" }
              };
              break;
            }
            settings.targets[targetId] = { ...target, ...(payload.patch ?? {}) };
            result = ok(settings.targets[targetId]);
            break;
          }
          case "UPDATE_SETTINGS":
            settings = {
              ...settings,
              ...payload.patch,
              sectionRules: {
                ...settings.sectionRules,
                ...(payload.patch?.sectionRules ?? {})
              },
              temporaryAccess: {
                ...settings.temporaryAccess,
                ...(payload.patch?.temporaryAccess ?? {})
              },
              planMode: {
                ...settings.planMode,
                ...(payload.patch?.planMode ?? {})
              },
              endPage: {
                ...settings.endPage,
                ...(payload.patch?.endPage ?? {}),
                groupUnlock: {
                  ...settings.endPage.groupUnlock,
                  ...(payload.patch?.endPage?.groupUnlock ?? {})
                }
              }
            };
            result = ok(settings);
            break;
          case "RESET_SETTINGS":
            settings = clone(seed);
            result = ok(settings);
            break;
          case "SET_PLAN_MODE":
            settings = {
              ...settings,
              planMode: {
                enabled: payload.enabled ?? settings.planMode.enabled,
                watchDurationMinutes:
                  payload.watchDurationMinutes ?? settings.planMode.watchDurationMinutes,
                defaultCompletionMode:
                  payload.defaultCompletionMode ?? settings.planMode.defaultCompletionMode,
                autoCompleteOnStart:
                  payload.autoCompleteOnStart ?? settings.planMode.autoCompleteOnStart
              }
            };
            result = ok({ settings: settings.planMode, queue: { schemaVersion: 1, items: [] } });
            break;
          case "GET_PLAN_STATE":
            result = ok({
              settings: settings.planMode,
              queue: { schemaVersion: 1, items: planItems }
            });
            break;
          case "ADD_PLAN_ITEM": {
            const url = new URL(String(payload.url));
            planItems = [
              ...planItems,
              {
                id: `plan:${planItems.length + 1}`,
                url: url.href,
                origin: url.origin,
                title: payload.title?.trim() || url.hostname,
                status: "pending",
                order: planItems.length,
                source: payload.source ?? "manual",
                scheduledDurationMinutes: payload.scheduledDurationMinutes ?? 45,
                completionMode: payload.completionMode ?? "flow",
                addedAt: Date.now(),
                completedAt: null
              }
            ];
            result = ok({
              settings: settings.planMode,
              queue: { schemaVersion: 1, items: planItems }
            });
            break;
          }
          case "GET_USAGE":
            result = ok({
              period: payload.period ?? "day",
              startDate: "2026-08-06",
              endDate: "2026-08-06",
              totalSeconds: 5_400,
              byPeriod: { "period:home:all-day": 600 },
              byTarget: {
                "module:bilibili:home": 600,
                "module:bilibili:dynamic": 900,
                "module:bilibili:bangumi": 3_900
              },
              bySection: {
                home: 600,
                dynamic: 900,
                popular: 0,
                video: 0,
                live: 0,
                bangumi: 3_900,
                search: 0
              },
              byDay: [
                {
                  date: "2026-08-06",
                  byTarget: {
                    "module:bilibili:home": 600,
                    "module:bilibili:dynamic": 900,
                    "module:bilibili:bangumi": 3_900
                  },
                  byPeriod: { "period:home:all-day": 600 },
                  bySection: {
                    home: 600,
                    dynamic: 900,
                    popular: 0,
                    video: 0,
                    live: 0,
                    bangumi: 3_900,
                    search: 0
                  }
                }
              ]
            });
            break;
          case "CLEAR_USAGE":
            result = ok({ cleared: true });
            break;
          case "GET_TRACKING_STATUS":
            result = ok({
              siteId: "site:bilibili",
              targetId: "module:bilibili:home",
              section: "home",
              isTracking: true,
              idleState: "active",
              windowFocused: true
            });
            break;
          case "GRANT_TEMPORARY_ACCESS":
            result = ok({
              section: "home",
              blocked: false,
              reason: "temporary-access",
              canRequestTemporaryAccess: true,
              temporaryAccessUsesRemaining: 2
            });
            break;
          case "GET_PAGE_DECISION":
            result = ok({
              siteId: "site:bilibili",
              targetId: "module:bilibili:home",
              section: "home",
              blocked: true,
              reason: "blocked",
              activePeriodId: "period:home:all-day",
              canRequestTemporaryAccess: true,
              temporaryAccessUsesRemaining: 3
            });
            break;
          default:
            result = {
              ok: false,
              error: { code: "UNSUPPORTED", message: "Unsupported test message" }
            };
        }
        return Promise.resolve({
          version: 1,
          requestId: message.requestId ?? "mock-request",
          result
        });
      }
    };

    Object.defineProperty(globalThis, "browser", {
      configurable: true,
      value: {
        runtime,
        storage: { local: storageArea, sync: storageArea },
        tabs: {
          query() {
            return Promise.resolve([
              { id: 1, active: true, windowId: 1, url: "https://www.bilibili.com/" }
            ]);
          }
        },
        permissions: {
          contains() {
            return Promise.resolve(true);
          },
          request() {
            return Promise.resolve(true);
          }
        },
        idle: {
          queryState() {
            return Promise.resolve("active");
          }
        }
      }
    });
  }, initialSettings);
}
