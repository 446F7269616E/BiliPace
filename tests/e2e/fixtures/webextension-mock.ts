import type { BrowserContext } from "@playwright/test";

export interface MockSettings {
  schemaVersion: 3;
  enabled: boolean;
  sites: Record<
    string,
    {
      id: string;
      origin: string;
      hostname: string;
      label: string;
      enabled: boolean;
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
  planMode: { enabled: boolean; watchDurationMinutes: number };
  contentFilters: {
    enabled: boolean;
    hiddenElements: Record<string, boolean>;
    videoCards: { enabled: boolean; keywords: string[]; regexPatterns: string[] };
    slashToSearch: boolean;
  };
}

const initialSettings: MockSettings = {
  schemaVersion: 3,
  enabled: true,
  sites: {
    "site:bilibili": {
      id: "site:bilibili",
      origin: "https://www.bilibili.com",
      hostname: "www.bilibili.com",
      label: "哔哩哔哩",
      enabled: true,
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
        dailyLimitMinutes: null,
        schedules: [],
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
  planMode: { enabled: false, watchDurationMinutes: 45 },
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
          patch?: Partial<MockSettings>;
          period?: string;
          enabled?: boolean;
          watchDurationMinutes?: number;
          url?: string;
          siteId?: string;
          moduleId?: string;
          action?: string;
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
              schemaVersion: 1,
              installations: {}
            });
            break;
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
                  payload.watchDurationMinutes ?? settings.planMode.watchDurationMinutes
              }
            };
            result = ok({ settings: settings.planMode, queue: { schemaVersion: 1, items: [] } });
            break;
          case "GET_USAGE":
            result = ok({
              period: payload.period ?? "day",
              startDate: "2026-08-06",
              endDate: "2026-08-06",
              totalSeconds: 5_400,
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
              section: "home",
              blocked: true,
              reason: "blocked",
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
