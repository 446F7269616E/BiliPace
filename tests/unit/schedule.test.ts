import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../../src/shared/config";
import {
  createPresetRules,
  isScheduleActive,
  shouldBlockSection,
  TIME_ACCESS_PRESETS,
  timeToMinutes
} from "../../src/shared/schedule";
import type { TimeAccessRule } from "../../src/shared/types";

const overnight: TimeAccessRule = {
  id: "overnight",
  name: "晚间专注",
  enabled: true,
  effect: "block",
  days: [1],
  startTime: "22:00",
  endTime: "02:00"
};

describe("schedule evaluation", () => {
  it("parses valid times and rejects malformed values", () => {
    expect(timeToMinutes("23:59")).toBe(1_439);
    expect(timeToMinutes("24:00")).toBeNull();
    expect(timeToMinutes("9:00")).toBeNull();
  });

  it("attributes an overnight tail to the previous selected weekday", () => {
    expect(isScheduleActive(overnight, new Date(2026, 7, 3, 23, 0))).toBe(true); // Monday
    expect(isScheduleActive(overnight, new Date(2026, 7, 4, 1, 59))).toBe(true); // Tuesday tail
    expect(isScheduleActive(overnight, new Date(2026, 7, 4, 2, 0))).toBe(false);
    expect(isScheduleActive(overnight, new Date(2026, 7, 2, 23, 0))).toBe(false);
  });

  it("treats equal start/end as an all-day selected-day schedule", () => {
    const allDay = { ...overnight, days: [3] as const, startTime: "00:00", endTime: "00:00" };
    expect(isScheduleActive({ ...allDay, days: [...allDay.days] }, new Date(2026, 7, 5, 12))).toBe(
      true
    );
    expect(isScheduleActive({ ...allDay, days: [...allDay.days] }, new Date(2026, 7, 6, 12))).toBe(
      false
    );
  });

  it("honors the master switch and empty-schedule all-day rule", () => {
    const settings = createDefaultSettings();
    expect(shouldBlockSection(settings, "home").blocked).toBe(true);
    settings.enabled = false;
    expect(shouldBlockSection(settings, "home")).toEqual({
      blocked: false,
      explicit: false,
      reason: "focus-disabled"
    });
  });

  it("uses allow-over-block precedence and closes an enabled allowlist", () => {
    const settings = createDefaultSettings();
    settings.sectionRules.home.schedules = [
      { ...overnight, id: "allow", effect: "allow", startTime: "08:00", endTime: "12:00" },
      { ...overnight, id: "block", effect: "block", startTime: "10:00", endTime: "11:00" }
    ];

    expect(shouldBlockSection(settings, "home", new Date(2026, 7, 3, 9))).toMatchObject({
      blocked: false,
      explicit: true
    });
    expect(shouldBlockSection(settings, "home", new Date(2026, 7, 3, 10, 30))).toMatchObject({
      blocked: false,
      explicit: true
    });
    expect(shouldBlockSection(settings, "home", new Date(2026, 7, 3, 13))).toMatchObject({
      blocked: true,
      explicit: true
    });
  });

  it("creates all meal windows for the selected weekdays", () => {
    const preset = TIME_ACCESS_PRESETS.find(({ id }) => id === "meals");
    expect(preset).toBeDefined();
    let id = 0;
    const rules = createPresetRules(preset!, "allow", [1, 5, 1], () => `preset-${++id}`);

    expect(rules).toHaveLength(3);
    expect(rules.map(({ startTime, endTime }) => [startTime, endTime])).toEqual([
      ["07:00", "09:00"],
      ["12:00", "14:00"],
      ["18:00", "20:00"]
    ]);
    expect(rules.every((rule) => rule.effect === "allow")).toBe(true);
    expect(rules.every((rule) => rule.days.join(",") === "1,5")).toBe(true);
  });
});
