import type {
  FocusSettings,
  SectionId,
  TimeAccessEffect,
  TimeAccessRule,
  TimeOfDay,
  Weekday
} from "./types";

export type TimeAccessPresetId = "morning" | "midday" | "evening" | "meals";

export interface TimeAccessPreset {
  id: TimeAccessPresetId;
  label: string;
  ranges: ReadonlyArray<{
    label: string;
    startTime: TimeOfDay;
    endTime: TimeOfDay;
  }>;
}

export const TIME_ACCESS_PRESETS: readonly TimeAccessPreset[] = Object.freeze([
  {
    id: "morning",
    label: "晨间",
    ranges: [{ label: "晨间", startTime: "06:00", endTime: "09:00" }]
  },
  {
    id: "midday",
    label: "午间",
    ranges: [{ label: "午间", startTime: "12:00", endTime: "14:00" }]
  },
  {
    id: "evening",
    label: "晚间",
    ranges: [{ label: "晚间", startTime: "18:00", endTime: "22:00" }]
  },
  {
    id: "meals",
    label: "饭点",
    ranges: [
      { label: "早餐", startTime: "07:00", endTime: "09:00" },
      { label: "午餐", startTime: "12:00", endTime: "14:00" },
      { label: "晚餐", startTime: "18:00", endTime: "20:00" }
    ]
  }
]);

export interface TimeRuleDecision {
  blocked: boolean;
  /** Explicit rules bypass the daily limit fallback. */
  explicit: boolean;
  reason: "focus-disabled" | "rule-disabled" | "outside-schedule" | "blocked";
}

export function timeToMinutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Checks a schedule in the user's local timezone. For an overnight interval, the
 * selected weekday is the day on which the interval starts. Equal start/end
 * represents a full selected day, a useful and unambiguous all-day shortcut.
 */
export function isScheduleActive(schedule: TimeAccessRule, now = new Date()): boolean {
  if (!schedule.enabled || schedule.days.length === 0) return false;
  const start = timeToMinutes(schedule.startTime);
  const end = timeToMinutes(schedule.endTime);
  if (start === null || end === null) return false;

  const weekday = now.getDay();
  const minute = now.getHours() * 60 + now.getMinutes();
  const selected = (day: number) => schedule.days.includes(day as never);

  if (start === end) return selected(weekday);
  if (start < end) return selected(weekday) && minute >= start && minute < end;

  const previousWeekday = (weekday + 6) % 7;
  return (selected(weekday) && minute >= start) || (selected(previousWeekday) && minute < end);
}

export function shouldBlockSection(
  settings: FocusSettings,
  section: SectionId,
  now = new Date()
): TimeRuleDecision {
  if (!settings.enabled) {
    return { blocked: false, explicit: false, reason: "focus-disabled" };
  }
  const rule = settings.sectionRules[section];
  if (!rule.enabled) return { blocked: false, explicit: false, reason: "rule-disabled" };

  const enabledRules = rule.schedules.filter((schedule) => schedule.enabled);
  if (enabledRules.length === 0) {
    return rule.schedules.length === 0
      ? { blocked: true, explicit: false, reason: "blocked" }
      : { blocked: false, explicit: false, reason: "outside-schedule" };
  }

  const activeRules = enabledRules.filter((schedule) => isScheduleActive(schedule, now));
  if (activeRules.some((schedule) => schedule.effect === "allow")) {
    return { blocked: false, explicit: true, reason: "outside-schedule" };
  }
  if (activeRules.some((schedule) => schedule.effect === "block")) {
    return { blocked: true, explicit: true, reason: "blocked" };
  }

  // Once an allow rule exists it forms a closed allowlist: time outside every
  // enabled allow window is unavailable.
  if (enabledRules.some((schedule) => schedule.effect === "allow")) {
    return { blocked: true, explicit: true, reason: "blocked" };
  }

  return { blocked: false, explicit: false, reason: "outside-schedule" };
}

export function createPresetRules(
  preset: TimeAccessPreset,
  effect: TimeAccessEffect,
  days: readonly Weekday[],
  createId: () => string
): TimeAccessRule[] {
  const uniqueDays = [...new Set(days)].filter(isWeekday).sort((left, right) => left - right);
  return preset.ranges.map((range) => ({
    id: createId(),
    name: range.label,
    enabled: true,
    effect,
    days: [...uniqueDays],
    startTime: range.startTime,
    endTime: range.endTime
  }));
}

function isWeekday(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}
