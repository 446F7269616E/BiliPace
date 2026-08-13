import { describe, expect, it } from "vitest";
import {
  formatRemainingMinutesBadge,
  resolveTargetAllowance,
  resolveToolbarBadgeText
} from "../../src/shared/remaining-time";
import { createDefaultSettings } from "../../src/shared/config";
import type { PageDecision, SiteTargetSettings, UsageSummary } from "../../src/shared/types";

const target: SiteTargetSettings = {
  id: "target:test",
  siteId: "site:test",
  label: "Example",
  enabled: true,
  dailyLimitMinutes: 999,
  schedules: [],
  timePeriods: [
    {
      id: "period:morning",
      name: "Morning",
      enabled: true,
      days: [1],
      startTime: "09:00",
      endTime: "12:00",
      behavior: "timed",
      limitMinutes: 45,
      groupCount: 1
    },
    {
      id: "period:evening",
      name: "Evening",
      enabled: true,
      days: [1],
      startTime: "18:00",
      endTime: "20:00",
      behavior: "timed",
      limitMinutes: 20,
      groupCount: 1
    }
  ],
  temporaryAccess: { enabled: false, durationMinutes: 5, maxUsesPerDay: 0 }
};

const usage: UsageSummary = {
  period: "day",
  startDate: "2026-08-13",
  endDate: "2026-08-13",
  totalSeconds: 1_500,
  byTarget: { "target:test": 1_500 },
  byPeriod: { "period:morning": 600, "period:evening": 900 },
  bySection: {
    home: 0,
    dynamic: 0,
    popular: 0,
    video: 0,
    live: 0,
    bangumi: 0,
    search: 0
  },
  byDay: []
};

describe("remaining time presentation", () => {
  it("uses the active period's canonical usage instead of the legacy daily limit", () => {
    expect(resolveTargetAllowance(target, usage, "period:morning")).toMatchObject({
      usedTodaySeconds: 1_500,
      allowanceUsedSeconds: 600,
      limitSeconds: 2_700,
      remainingSeconds: 2_100
    });
    expect(resolveTargetAllowance(target, usage, "period:evening")).toMatchObject({
      allowanceUsedSeconds: 900,
      limitSeconds: 1_200,
      remainingSeconds: 300
    });
  });

  it("formats a useful minute badge through the final partial minute", () => {
    expect(formatRemainingMinutesBadge(2_100)).toBe("35");
    expect(formatRemainingMinutesBadge(1)).toBe("1");
    expect(formatRemainingMinutesBadge(0)).toBe("0");
    expect(formatRemainingMinutesBadge(null)).toBe("");
  });

  it("honors the toolbar preference and active page decision", () => {
    const settings = createDefaultSettings();
    settings.sites[target.siteId] = {
      id: target.siteId,
      origin: "https://example.com",
      hostname: "example.com",
      label: "Example",
      enabled: true,
      restrictionMode: "strict",
      targetIds: [target.id],
      createdAt: 1,
      updatedAt: 1
    };
    settings.targets[target.id] = target;
    const decision: PageDecision = {
      siteId: target.siteId,
      targetId: target.id,
      section: null,
      blocked: false,
      reason: "outside-schedule",
      activePeriodId: "period:morning",
      canRequestTemporaryAccess: false,
      temporaryAccessUsesRemaining: 0
    };

    expect(resolveToolbarBadgeText(settings, usage, decision)).toBe("35");
    settings.showRemainingMinutesOnIcon = false;
    expect(resolveToolbarBadgeText(settings, usage, decision)).toBe("");
  });
});
