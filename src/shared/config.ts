import {
  type BlockingSchedule,
  type DeepPartial,
  type FocusSettings,
  SECTION_IDS,
  type SectionId,
  type SectionRule,
  type TemporaryAccessSettings,
  type Weekday
} from "./types";

const DEFAULT_BLOCKED_SECTIONS: ReadonlySet<SectionId> = new Set(["home", "dynamic", "popular"]);

function defaultRule(section: SectionId): SectionRule {
  return {
    enabled: DEFAULT_BLOCKED_SECTIONS.has(section),
    dailyLimitMinutes: null,
    schedules: []
  };
}

export const DEFAULT_SETTINGS: Readonly<FocusSettings> = Object.freeze({
  schemaVersion: 1,
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
    schemaVersion: 1,
    enabled: patch.enabled ?? base.enabled,
    sectionRules: { ...base.sectionRules },
    temporaryAccess: {
      ...base.temporaryAccess,
      ...(patch.temporaryAccess ?? {})
    },
    planMode: {
      ...base.planMode,
      ...(patch.planMode ?? {})
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
        ? rulePatch.schedules.map((schedule) => ({
            id: schedule.id ?? createId(),
            name: schedule.name ?? "专注计划",
            enabled: schedule.enabled ?? true,
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
 * This doubles as the schema-v1 migration boundary for future versions.
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
        ? rawRule.schedules.map(normalizeSchedule).filter(isDefined)
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

  return {
    schemaVersion: 1,
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    sectionRules,
    temporaryAccess,
    planMode
  };
}

function normalizeSchedule(value: unknown): BlockingSchedule | undefined {
  if (!isRecord(value)) return undefined;
  const startTime = normalizeTime(value.startTime);
  const endTime = normalizeTime(value.endTime);
  if (!startTime || !endTime) return undefined;

  const uniqueDays = Array.isArray(value.days)
    ? [...new Set(value.days.filter(isWeekday))].sort((a, b) => a - b)
    : [];

  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : createId(),
    name: typeof value.name === "string" ? value.name.trim().slice(0, 60) : "专注计划",
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
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
    schemaVersion: 1,
    enabled: settings.enabled,
    sectionRules,
    temporaryAccess: { ...settings.temporaryAccess },
    planMode: { ...settings.planMode }
  };
}

function createUnsafeDefaultSettings(): FocusSettings {
  const sectionRules = {} as Record<SectionId, SectionRule>;
  for (const section of SECTION_IDS) sectionRules[section] = defaultRule(section);
  return {
    schemaVersion: 1,
    enabled: true,
    sectionRules,
    temporaryAccess: { enabled: true, durationMinutes: 5, maxUsesPerDay: 3 },
    planMode: { enabled: false, watchDurationMinutes: 45 }
  };
}

function cloneSchedule(schedule: BlockingSchedule): BlockingSchedule {
  return { ...schedule, days: [...schedule.days] };
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
