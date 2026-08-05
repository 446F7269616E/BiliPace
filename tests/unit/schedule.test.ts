import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../../src/shared/config";
import { isScheduleActive, shouldBlockSection, timeToMinutes } from "../../src/shared/schedule";
import type { BlockingSchedule } from "../../src/shared/types";

const overnight: BlockingSchedule = {
  id: "overnight",
  name: "晚间专注",
  enabled: true,
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
      reason: "focus-disabled"
    });
  });
});
