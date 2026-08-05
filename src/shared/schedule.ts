import type { BlockingSchedule, FocusSettings, SectionId } from "./types";

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
export function isScheduleActive(schedule: BlockingSchedule, now = new Date()): boolean {
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
): {
  blocked: boolean;
  reason: "focus-disabled" | "rule-disabled" | "outside-schedule" | "blocked";
} {
  if (!settings.enabled) return { blocked: false, reason: "focus-disabled" };
  const rule = settings.sectionRules[section];
  if (!rule.enabled) return { blocked: false, reason: "rule-disabled" };
  if (rule.schedules.length === 0) return { blocked: true, reason: "blocked" };

  return rule.schedules.some((schedule) => isScheduleActive(schedule, now))
    ? { blocked: true, reason: "blocked" }
    : { blocked: false, reason: "outside-schedule" };
}
