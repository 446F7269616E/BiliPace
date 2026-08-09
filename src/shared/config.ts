import {
  CONTENT_FILTER_IDS,
  type ContentFilterId,
  type ContentFilterSettings,
  type DeepPartial,
  type FocusSettings,
  SECTION_IDS,
  type SectionId,
  type SectionRule,
  type TemporaryAccessSettings,
  type TimeAccessRule,
  type TimeAccessEffect,
  type Weekday
} from "./types";

export const SETTINGS_SCHEMA_VERSION = 2 as const;
export const MAX_TIME_ACCESS_RULES = 64;

const DEFAULT_BLOCKED_SECTIONS: ReadonlySet<SectionId> = new Set(["home", "dynamic", "popular"]);

const DEFAULT_HIDDEN_ELEMENTS: Readonly<Record<ContentFilterId, boolean>> = Object.freeze({
  "home-feed": false,
  "dynamic-feed": false,
  "related-videos": true,
  comments: false,
  "search-suggestions": true,
  ads: true,
  "top-navigation": false
});

function defaultRule(section: SectionId): SectionRule {
  return {
    enabled: DEFAULT_BLOCKED_SECTIONS.has(section),
    dailyLimitMinutes: null,
    schedules: []
  };
}

export const DEFAULT_SETTINGS: Readonly<FocusSettings> = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  enabled: true,
  sectionRules: Object.freeze(
    Object.fromEntries(
      SECTION_IDS.map((section) => [section, Object.freeze(defaultRule(section))])
    ) as Record<SectionId, SectionRule>
  ),
  temporaryAccess: Object.freeze({
    enabled: true,
    durationMinutes: 5,
    maxUsesPerDay: 3
  }),
  planMode: Object.freeze({
    enabled: false,
    watchDurationMinutes: 45
  }),
  contentFilters: Object.freeze({
    enabled: true,
    hiddenElements: DEFAULT_HIDDEN_ELEMENTS,
    videoCards: Object.freeze({ enabled: false, keywords: [], regexPatterns: [] }),
    slashToSearch: true
  })
});

export function createDefaultSettings(): FocusSettings {
  return cloneSettings(DEFAULT_SETTINGS);
}

export function mergeSettings(
  base: FocusSettings,
  patch: DeepPartial<FocusSettings>
): FocusSettings {
  const merged: FocusSettings = {
    ...base,
    ...patch,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    enabled: patch.enabled ?? base.enabled,
    sectionRules: { ...base.sectionRules },
    temporaryAccess: {
      ...base.temporaryAccess,
      ...(patch.temporaryAccess ?? {})
    },
    planMode: {
      ...base.planMode,
      ...(patch.planMode ?? {})
    },
    contentFilters: {
      ...base.contentFilters,
      ...(patch.contentFilters ?? {}),
      hiddenElements: {
        ...base.contentFilters.hiddenElements,
        ...(patch.contentFilters?.hiddenElements ?? {})
      },
      videoCards: {
        ...base.contentFilters.videoCards,
        ...(patch.contentFilters?.videoCards ?? {})
      }
    }
  };

  for (const section of SECTION_IDS) {
    const rulePatch = patch.sectionRules?.[section];
    merged.sectionRules[section] = {
      ...base.sectionRules[section],
      ...(rulePatch ?? {}),
      dailyLimitMinutes:
        rulePatch?.dailyLimitMinutes === undefined
          ? base.sectionRules[section].dailyLimitMinutes
          : rulePatch.dailyLimitMinutes,
      schedules: rulePatch?.schedules
        ? rulePatch.schedules.slice(0, MAX_TIME_ACCESS_RULES).map((schedule) => ({
            id: schedule.id ?? createId(),
            name: schedule.name ?? "时间规则",
            enabled: schedule.enabled ?? true,
            effect: schedule.effect ?? "block",
            days: schedule.days ?? [],
            startTime: schedule.startTime ?? "09:00",
            endTime: schedule.endTime ?? "18:00"
          }))
        : base.sectionRules[section].schedules.map(cloneSchedule)
    };
  }

  return normalizeSettings(merged);
}

/**
 * Treats persisted data as untrusted and returns a complete, bounded settings object.
 * This is the schema migration boundary for stored settings.
 */
export function normalizeSettings(value: unknown): FocusSettings {
  const defaults = createUnsafeDefaultSettings();
  if (!isRecord(value)) return defaults;

  const rawRules = isRecord(value.sectionRules) ? value.sectionRules : {};
  const sectionRules = {} as Record<SectionId, SectionRule>;

  for (const section of SECTION_IDS) {
    const rawRule = isRecord(rawRules[section]) ? rawRules[section] : {};
    sectionRules[section] = {
      enabled:
        typeof rawRule.enabled === "boolean"
          ? rawRule.enabled
          : defaults.sectionRules[section].enabled,
      dailyLimitMinutes: normalizeDailyLimit(rawRule.dailyLimitMinutes),
      schedules: Array.isArray(rawRule.schedules)
        ? rawRule.schedules.slice(0, MAX_TIME_ACCESS_RULES).map(normalizeSchedule).filter(isDefined)
        : []
    };
  }

  const rawAccess = isRecord(value.temporaryAccess) ? value.temporaryAccess : {};
  const temporaryAccess: TemporaryAccessSettings = {
    enabled:
      typeof rawAccess.enabled === "boolean" ? rawAccess.enabled : defaults.temporaryAccess.enabled,
    durationMinutes: clampInteger(rawAccess.durationMinutes, 1, 60, 5),
    maxUsesPerDay: clampInteger(rawAccess.maxUsesPerDay, 0, 50, 3)
  };

  const rawPlanMode = isRecord(value.planMode) ? value.planMode : {};
  const planMode = {
    enabled: typeof rawPlanMode.enabled === "boolean" ? rawPlanMode.enabled : false,
    watchDurationMinutes: clampInteger(rawPlanMode.watchDurationMinutes, 1, 360, 45)
  };

  const contentFilters = normalizeContentFilters(value.contentFilters, defaults.contentFilters);

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    sectionRules,
    temporaryAccess,
    planMode,
    contentFilters
  };
}

function normalizeContentFilters(
  value: unknown,
  defaults: ContentFilterSettings
): ContentFilterSettings {
  const raw = isRecord(value) ? value : {};
  const rawHidden = isRecord(raw.hiddenElements) ? raw.hiddenElements : {};
  const hiddenElements = {} as Record<ContentFilterId, boolean>;
  for (const id of CONTENT_FILTER_IDS) {
    hiddenElements[id] =
      typeof rawHidden[id] === "boolean" ? rawHidden[id] : defaults.hiddenElements[id];
  }

  const rawCards = isRecord(raw.videoCards) ? raw.videoCards : {};
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaults.enabled,
    hiddenElements,
    videoCards: {
      enabled: typeof rawCards.enabled === "boolean" ? rawCards.enabled : false,
      keywords: normalizeFilterTerms(rawCards.keywords),
      regexPatterns: normalizeFilterTerms(rawCards.regexPatterns)
    },
    slashToSearch: typeof raw.slashToSearch === "boolean" ? raw.slashToSearch : true
  };
}

function normalizeFilterTerms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 80))
    .filter(Boolean);
  return [...new Set(normalized)].slice(0, 50);
}

function normalizeSchedule(value: unknown): TimeAccessRule | undefined {
  if (!isRecord(value)) return undefined;
  const startTime = normalizeTime(value.startTime);
  const endTime = normalizeTime(value.endTime);
  if (!startTime || !endTime) return undefined;

  const uniqueDays = Array.isArray(value.days)
    ? [...new Set(value.days.filter(isWeekday))].sort((a, b) => a - b)
    : [];

  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : createId(),
    name: typeof value.name === "string" ? value.name.trim().slice(0, 60) : "时间规则",
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    // schema v1 schedules were block-only. A missing effect is migrated without
    // changing the user's existing access windows.
    effect: isTimeAccessEffect(value.effect) ? value.effect : "block",
    days: uniqueDays,
    startTime,
    endTime
  };
}

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeTime(value: unknown): string | undefined {
  return isTimeOfDay(value) ? value : undefined;
}

function isWeekday(value: unknown): value is Weekday {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 6;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function cloneSettings(settings: Readonly<FocusSettings>): FocusSettings {
  const sectionRules = {} as Record<SectionId, SectionRule>;
  for (const section of SECTION_IDS) {
    sectionRules[section] = {
      enabled: settings.sectionRules[section].enabled,
      dailyLimitMinutes: settings.sectionRules[section].dailyLimitMinutes,
      schedules: settings.sectionRules[section].schedules.map(cloneSchedule)
    };
  }
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    enabled: settings.enabled,
    sectionRules,
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
    }
  };
}

function createUnsafeDefaultSettings(): FocusSettings {
  const sectionRules = {} as Record<SectionId, SectionRule>;
  for (const section of SECTION_IDS) sectionRules[section] = defaultRule(section);
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    enabled: true,
    sectionRules,
    temporaryAccess: { enabled: true, durationMinutes: 5, maxUsesPerDay: 3 },
    planMode: { enabled: false, watchDurationMinutes: 45 },
    contentFilters: {
      enabled: true,
      hiddenElements: { ...DEFAULT_HIDDEN_ELEMENTS },
      videoCards: { enabled: false, keywords: [], regexPatterns: [] },
      slashToSearch: true
    }
  };
}

function cloneSchedule(schedule: TimeAccessRule): TimeAccessRule {
  return { ...schedule, days: [...schedule.days] };
}

function isTimeAccessEffect(value: unknown): value is TimeAccessEffect {
  return value === "allow" || value === "block";
}

function normalizeDailyLimit(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1_440, Math.max(1, Math.round(value)));
}

function createId(): string {
  const cryptoObject = globalThis.crypto;
  if (typeof cryptoObject?.randomUUID === "function") return cryptoObject.randomUUID();
  return `schedule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
