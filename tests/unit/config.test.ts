import { describe, expect, it } from "vitest";
import { createDefaultSettings, mergeSettings, normalizeSettings } from "../../src/shared/config";
import { SECTION_IDS } from "../../src/shared/types";

describe("settings schema", () => {
  it("provides independent, complete defaults", () => {
    const first = createDefaultSettings();
    const second = createDefaultSettings();
    first.sectionRules.home.enabled = false;
    expect(second.sectionRules.home.enabled).toBe(true);
    expect(Object.keys(first.sectionRules)).toEqual([...SECTION_IDS]);
    expect(first.enabled).toBe(true);
    expect(first.schemaVersion).toBe(2);
    expect(first.planMode).toEqual({ enabled: false, watchDurationMinutes: 45 });
  });

  it("migrates block-only schedules and keeps explicit access effects", () => {
    const normalized = normalizeSettings({
      schemaVersion: 1,
      sectionRules: {
        home: {
          schedules: [
            {
              id: "legacy",
              name: "旧时段",
              enabled: true,
              days: [1],
              startTime: "09:00",
              endTime: "10:00"
            },
            {
              id: "allow",
              name: "可用时段",
              enabled: true,
              effect: "allow",
              days: [2],
              startTime: "12:00",
              endTime: "13:00"
            }
          ]
        }
      }
    });

    expect(normalized.schemaVersion).toBe(2);
    expect(normalized.sectionRules.home.schedules.map((rule) => rule.effect)).toEqual([
      "block",
      "allow"
    ]);
  });

  it("normalizes untrusted persisted values and bounds numeric settings", () => {
    const normalized = normalizeSettings({
      enabled: false,
      sectionRules: {
        video: {
          enabled: true,
          dailyLimitMinutes: 99_999,
          schedules: [
            {
              id: "valid",
              name: "x".repeat(100),
              enabled: true,
              days: [1, 1, 9, "2"],
              startTime: "09:00",
              endTime: "10:00"
            },
            { startTime: "bad", endTime: "10:00" }
          ]
        }
      },
      temporaryAccess: { durationMinutes: 0, maxUsesPerDay: 500 }
    });

    expect(normalized.enabled).toBe(false);
    expect(normalized.sectionRules.video.dailyLimitMinutes).toBe(1_440);
    expect(normalized.sectionRules.video.schedules).toHaveLength(1);
    expect(normalized.sectionRules.video.schedules[0]?.days).toEqual([1]);
    expect(normalized.sectionRules.video.schedules[0]?.name).toHaveLength(60);
    expect(normalized.temporaryAccess.durationMinutes).toBe(1);
    expect(normalized.temporaryAccess.maxUsesPerDay).toBe(50);
    expect(normalized.planMode).toEqual({ enabled: false, watchDurationMinutes: 45 });
  });

  it("migrates optional plan mode settings from old data and bounds new values", () => {
    expect(normalizeSettings({ enabled: true }).planMode).toEqual({
      enabled: false,
      watchDurationMinutes: 45
    });
    expect(
      normalizeSettings({ planMode: { enabled: true, watchDurationMinutes: 99_999 } }).planMode
    ).toEqual({ enabled: true, watchDurationMinutes: 360 });
  });

  it("merges nested patches without erasing unrelated section preferences", () => {
    const current = createDefaultSettings();
    const next = mergeSettings(current, {
      sectionRules: { video: { enabled: true, dailyLimitMinutes: 45 } }
    });
    expect(next.sectionRules.video.enabled).toBe(true);
    expect(next.sectionRules.video.dailyLimitMinutes).toBe(45);
    expect(next.sectionRules.home.enabled).toBe(true);
    expect(
      mergeSettings(next, { planMode: { enabled: true, watchDurationMinutes: 25 } }).planMode
    ).toEqual({ enabled: true, watchDurationMinutes: 25 });
  });
});
