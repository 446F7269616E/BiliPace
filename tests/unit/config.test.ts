import { describe, expect, it } from "vitest";
import {
  createDefaultSettings,
  createDefaultTimePeriod,
  mergeSettings,
  normalizeSettings
} from "../../src/shared/config";
import { SECTION_IDS } from "../../src/shared/types";

describe("settings schema", () => {
  it("provides independent, complete defaults", () => {
    const first = createDefaultSettings();
    const second = createDefaultSettings();
    first.sectionRules.home.enabled = false;
    expect(second.sectionRules.home.enabled).toBe(true);
    expect(Object.keys(first.sectionRules)).toEqual([...SECTION_IDS]);
    expect(first.enabled).toBe(true);
    expect(first.showRemainingMinutesOnIcon).toBe(true);
    expect(first.schemaVersion).toBe(4);
    expect(first.sites).toEqual({});
    expect(first.targets).toEqual({});
    expect(first.locale).toBe("system");
    expect(first.endPage).toMatchObject({ view: "dashboard", motivationalMessage: "" });
    expect(first.planMode).toEqual({
      enabled: false,
      watchDurationMinutes: 45,
      defaultCompletionMode: "flow",
      autoCompleteOnStart: false
    });
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

    expect(normalized.schemaVersion).toBe(4);
    expect(normalized.sectionRules.home.schedules.map((rule) => rule.effect)).toEqual([
      "block",
      "allow"
    ]);
  });

  it("keeps a timed all-day fallback when migrating legacy block-only target rules", () => {
    const normalized = normalizeSettings({
      sites: {
        "site:test": {
          origin: "https://example.com",
          label: "Example",
          targetIds: ["target:test"]
        }
      },
      targets: {
        "target:test": {
          siteId: "site:test",
          dailyLimitMinutes: 45,
          schedules: [
            {
              id: "blocked-window",
              name: "Blocked",
              enabled: true,
              effect: "block",
              days: [1],
              startTime: "09:00",
              endTime: "10:00"
            }
          ]
        }
      }
    });
    expect(normalized.targets["target:test"]?.timePeriods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ behavior: "always-block" }),
        expect.objectContaining({ behavior: "timed", limitMinutes: 45 })
      ])
    );
  });

  it.each(["always-allow", "always-block"] as const)(
    "absorbs the legacy %s policy into an all-day period",
    (accessPolicy) => {
      const normalized = normalizeSettings({
        sites: {
          "site:test": {
            origin: "https://example.com",
            label: "Example",
            targetIds: ["target:test"]
          }
        },
        targets: {
          "target:test": {
            siteId: "site:test",
            accessPolicy
          }
        }
      });

      expect(normalized.targets["target:test"]).toMatchObject({
        accessPolicy: "timed",
        timePeriods: [
          expect.objectContaining({
            name: "",
            behavior: accessPolicy,
            days: [0, 1, 2, 3, 4, 5, 6],
            startTime: "00:00",
            endTime: "00:00"
          })
        ]
      });
    }
  );

  it("uses an empty marker for localized system period names", () => {
    expect(createDefaultTimePeriod().name).toBe("");
    const normalized = normalizeSettings({
      sites: {
        "site:test": { origin: "https://example.com", targetIds: ["target:test"] }
      },
      targets: {
        "target:test": {
          siteId: "site:test",
          timePeriods: [
            {
              id: "period:test",
              name: "全天",
              enabled: true,
              days: [0, 1, 2, 3, 4, 5, 6],
              startTime: "00:00",
              endTime: "00:00",
              behavior: "timed",
              limitMinutes: null,
              groupCount: 1
            }
          ]
        }
      }
    });
    expect(normalized.targets["target:test"]?.timePeriods[0]?.name).toBe("");
  });

  it("migrates hidden website and target master switches to per-period control", () => {
    const normalized = normalizeSettings({
      sites: {
        "site:test": {
          origin: "https://example.com",
          enabled: false,
          targetIds: ["target:test"]
        }
      },
      targets: {
        "target:test": {
          siteId: "site:test",
          enabled: false,
          timePeriods: [
            {
              id: "period:test",
              name: "Available",
              enabled: true,
              days: [0, 1, 2, 3, 4, 5, 6],
              startTime: "00:00",
              endTime: "00:00",
              behavior: "always-allow",
              limitMinutes: null,
              groupCount: 1
            }
          ]
        }
      }
    });

    expect(normalized.sites["site:test"]?.enabled).toBe(true);
    expect(normalized.targets["target:test"]?.enabled).toBe(true);
    expect(normalized.targets["target:test"]?.timePeriods[0]?.enabled).toBe(true);
  });

  it("normalizes per-site visit confirmation independently from end-page waits", () => {
    const normalized = normalizeSettings({
      sites: {
        "site:test": {
          origin: "https://example.com",
          targetIds: [],
          visitConfirmation: { enabled: true, waitSeconds: 999 }
        }
      }
    });
    expect(normalized.sites["site:test"]?.visitConfirmation).toEqual({
      enabled: true,
      waitSeconds: 60
    });
    expect(normalized.endPage.groupUnlock.waitMinutes).toBe(5);

    const updated = mergeSettings(normalized, {
      sites: { "site:test": { visitConfirmation: { waitSeconds: 7 } } }
    });
    expect(updated.sites["site:test"]?.visitConfirmation).toEqual({
      enabled: true,
      waitSeconds: 7
    });
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
    expect(normalized.showRemainingMinutesOnIcon).toBe(true);
    expect(normalized.sectionRules.video.dailyLimitMinutes).toBe(1_440);
    expect(normalized.sectionRules.video.schedules).toHaveLength(1);
    expect(normalized.sectionRules.video.schedules[0]?.days).toEqual([1]);
    expect(normalized.sectionRules.video.schedules[0]?.name).toHaveLength(60);
    expect(normalized.temporaryAccess.durationMinutes).toBe(1);
    expect(normalized.temporaryAccess.maxUsesPerDay).toBe(50);
    expect(normalized.planMode).toEqual({
      enabled: false,
      watchDurationMinutes: 45,
      defaultCompletionMode: "flow",
      autoCompleteOnStart: false
    });
  });

  it("normalizes the optional toolbar remaining-minutes preference", () => {
    expect(
      normalizeSettings({ showRemainingMinutesOnIcon: false }).showRemainingMinutesOnIcon
    ).toBe(false);
    expect(
      normalizeSettings({ showRemainingMinutesOnIcon: "yes" }).showRemainingMinutesOnIcon
    ).toBe(true);
  });

  it("migrates optional plan mode settings from old data and bounds new values", () => {
    expect(normalizeSettings({ enabled: true }).planMode).toEqual({
      enabled: false,
      watchDurationMinutes: 45,
      defaultCompletionMode: "flow",
      autoCompleteOnStart: false
    });
    expect(
      normalizeSettings({ planMode: { enabled: true, watchDurationMinutes: 99_999 } }).planMode
    ).toEqual({
      enabled: true,
      watchDurationMinutes: 360,
      defaultCompletionMode: "flow",
      autoCompleteOnStart: false
    });
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
    ).toEqual({
      enabled: true,
      watchDurationMinutes: 25,
      defaultCompletionMode: "flow",
      autoCompleteOnStart: false
    });
  });
});
