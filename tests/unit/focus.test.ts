import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnalyticsService } from "../../src/shared/analytics";
import type { ExtensionApi, StorageAreaLike } from "../../src/shared/browser";
import { createDefaultSettings } from "../../src/shared/config";
import { FocusDecisionService } from "../../src/shared/focus";
import { PeriodRuntimeService } from "../../src/shared/period-runtime";
import { ManagedSiteService } from "../../src/core/sites";
import {
  PeriodRuntimeRepository,
  RawUsageRepository,
  SettingsRepository,
  TemporaryAccessRepository
} from "../../src/shared/storage";

class MemoryStorage implements StorageAreaLike {
  readonly values: Record<string, unknown> = {};

  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    if (typeof keys === "string") return Promise.resolve({ [keys]: this.values[keys] });
    return Promise.resolve({ ...this.values });
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
    return Promise.resolve();
  }
}

const storage = new MemoryStorage();
let settings: SettingsRepository;
let analytics: AnalyticsService;
let decisions: FocusDecisionService;
const siteId = "site:test";
const targetId = "target:test";
const managedUrl = "https://example.com/focus";

beforeEach(async () => {
  for (const key of Object.keys(storage.values)) delete storage.values[key];
  (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser = {
    runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener: () => undefined } },
    storage: { local: storage },
    permissions: {
      contains: () => Promise.resolve(true),
      remove: () => Promise.resolve(true)
    },
    scripting: {
      registerContentScripts: () => Promise.resolve(),
      unregisterContentScripts: () => Promise.resolve(),
      getRegisteredContentScripts: () => Promise.resolve([])
    }
  };
  settings = new SettingsRepository(storage);
  analytics = new AnalyticsService(new RawUsageRepository(storage));
  decisions = new FocusDecisionService(settings, new TemporaryAccessRepository(storage), analytics);
  const defaults = createDefaultSettings();
  await settings.set({
    ...defaults,
    sites: {
      [siteId]: {
        id: siteId,
        origin: "https://example.com",
        hostname: "example.com",
        label: "Example",
        enabled: true,
        restrictionMode: "strict",
        targetIds: [targetId],
        createdAt: 1,
        updatedAt: 1
      }
    },
    targets: {
      [targetId]: {
        id: targetId,
        siteId,
        label: "Example",
        enabled: true,
        dailyLimitMinutes: null,
        schedules: [],
        timePeriods: [
          {
            id: "period:test",
            name: "All day",
            enabled: true,
            days: [0, 1, 2, 3, 4, 5, 6],
            startTime: "00:00",
            endTime: "00:00",
            behavior: "timed",
            limitMinutes: null,
            groupCount: 1
          }
        ],
        temporaryAccess: { enabled: true, durationMinutes: 5, maxUsesPerDay: 3 }
      }
    }
  });
});

afterEach(() => {
  delete (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser;
});

describe("focus decisions", () => {
  it("serializes a period update with unrelated settings changes", async () => {
    const managedSites = new ManagedSiteService(settings);
    const period = {
      id: "period:test",
      name: "Work",
      enabled: false,
      days: [1, 2, 3, 4, 5] as const,
      startTime: "09:00",
      endTime: "17:00",
      behavior: "timed" as const,
      limitMinutes: 45,
      groupCount: 3
    };

    await Promise.all([
      settings.update({ locale: "en", endPage: { motivationalMessage: "Keep going" } }),
      managedSites.updateTarget(targetId, { timePeriods: [{ ...period, days: [...period.days] }] })
    ]);

    const updated = await settings.get();
    expect(updated.locale).toBe("en");
    expect(updated.endPage.motivationalMessage).toBe("Keep going");
    expect(updated.targets[targetId]?.timePeriods).toEqual([{ ...period, days: [...period.days] }]);
  });

  it("preserves settings updates while adding and applying a managed-site module", async () => {
    const managedSites = new ManagedSiteService(settings);
    const manifest = {
      id: "module:test",
      version: "1.0.0",
      name: "Test module",
      hosts: ["https://new.example/*"],
      capabilities: ["classify" as const],
      sections: [{ id: "feed", label: "Feed" }]
    };

    await Promise.all([
      managedSites.addAuthorized("https://new.example/path", "New example"),
      settings.update({ locale: "en", endPage: { motivationalMessage: "Stay focused" } })
    ]);
    await Promise.all([
      managedSites.applyModuleManifest(manifest, true, "focus.js"),
      settings.update({ endPage: { view: "minimal" } })
    ]);

    const updated = await settings.get();
    const addedSite = Object.values(updated.sites).find(
      (site) => site.origin === "https://new.example"
    );
    expect(updated.locale).toBe("en");
    expect(updated.endPage).toMatchObject({
      view: "minimal",
      motivationalMessage: "Stay focused"
    });
    expect(addedSite).toBeDefined();
    expect(addedSite?.targetIds.some((id) => updated.targets[id]?.moduleId === manifest.id)).toBe(
      true
    );
  });

  it("preserves unrelated settings while removing a managed site", async () => {
    const managedSites = new ManagedSiteService(settings);

    await Promise.all([
      managedSites.remove(siteId),
      settings.update({ locale: "en", endPage: { motivationalMessage: "One step at a time" } })
    ]);

    const updated = await settings.get();
    expect(updated.sites[siteId]).toBeUndefined();
    expect(updated.targets[targetId]).toBeUndefined();
    expect(updated.locale).toBe("en");
    expect(updated.endPage.motivationalMessage).toBe("One step at a time");
  });

  it("uses period switches even when legacy website and target switches were disabled", async () => {
    await settings.update({
      sites: { [siteId]: { enabled: false } },
      targets: { [targetId]: { enabled: false } }
    });

    await expect(decisions.decide(managedUrl, new Date())).resolves.toMatchObject({
      blocked: false,
      reason: "outside-schedule"
    });
    const normalized = await settings.get();
    expect(normalized.sites[siteId]?.enabled).toBe(true);
    expect(normalized.targets[targetId]?.enabled).toBe(true);
  });

  it("uses an independent allowance for an all-day period", async () => {
    const now = new Date(2026, 7, 6, 12);
    await settings.update({
      targets: {
        [targetId]: {
          timePeriods: [
            {
              id: "period:test",
              name: "All day",
              enabled: true,
              days: [0, 1, 2, 3, 4, 5, 6],
              startTime: "00:00",
              endTime: "00:00",
              behavior: "timed",
              limitMinutes: 1,
              groupCount: 1
            }
          ]
        }
      }
    });
    expect((await decisions.decide(managedUrl, now)).blocked).toBe(false);

    await analytics.recordInterval(targetId, now.getTime() - 60_000, now.getTime(), "period:test");
    const limited = await decisions.decide(managedUrl, now);
    expect(limited).toMatchObject({
      blocked: true,
      reason: "period-limit",
      canRequestTemporaryAccess: false
    });
  });

  it("applies the site's lenient, flow, and strict behavior after a period expires", async () => {
    const now = new Date(2026, 7, 6, 12);
    await settings.update({
      targets: {
        [targetId]: {
          timePeriods: [
            {
              id: "period:test",
              name: "All day",
              enabled: true,
              days: [0, 1, 2, 3, 4, 5, 6],
              startTime: "00:00",
              endTime: "00:00",
              behavior: "timed",
              limitMinutes: 1,
              groupCount: 1
            }
          ]
        }
      }
    });
    await analytics.recordInterval(targetId, now.getTime() - 60_000, now.getTime(), "period:test");

    await settings.update({ sites: { [siteId]: { restrictionMode: "lenient" } } });
    await expect(decisions.decide(managedUrl, now)).resolves.toMatchObject({
      blocked: false,
      reason: "period-limit",
      restrictionMode: "lenient",
      needsReminder: true
    });

    await settings.update({ sites: { [siteId]: { restrictionMode: "flow" } } });
    await expect(decisions.decide(managedUrl, now)).resolves.toMatchObject({
      blocked: true,
      reason: "period-limit",
      restrictionMode: "flow",
      needsFlowChoice: true
    });

    await settings.update({ sites: { [siteId]: { restrictionMode: "strict" } } });
    await expect(decisions.decide(managedUrl, now)).resolves.toMatchObject({
      blocked: true,
      reason: "period-limit",
      restrictionMode: "strict"
    });
  });

  it("keeps a video-end flow active without converting it into a timer", async () => {
    const now = new Date(2026, 7, 6, 12);
    await settings.update({
      sites: { [siteId]: { restrictionMode: "flow" } },
      targets: {
        [targetId]: {
          timePeriods: [
            {
              id: "period:test",
              name: "All day",
              enabled: true,
              days: [0, 1, 2, 3, 4, 5, 6],
              startTime: "00:00",
              endTime: "00:00",
              behavior: "timed",
              limitMinutes: 1,
              groupCount: 1
            }
          ]
        }
      }
    });
    await analytics.recordInterval(targetId, now.getTime() - 60_000, now.getTime(), "period:test");
    const runtime = new PeriodRuntimeService(
      settings,
      new PeriodRuntimeRepository(storage),
      analytics,
      () => now.getTime()
    );
    await runtime.grantFlow(targetId, "period:test", { kind: "video-end" });

    await expect(
      decisions.decide(managedUrl, new Date(now.getTime() + 2 * 60 * 60_000))
    ).resolves.toMatchObject({
      blocked: false,
      reason: "flow-extension",
      flowContinuationKind: "video-end"
    });
    expect(
      (await decisions.decide(managedUrl, new Date(now.getTime() + 2 * 60 * 60_000))).flowExpiresAt
    ).toBeUndefined();
  });

  it("stops at a group boundary when the next group requires a challenge", async () => {
    const now = new Date(2026, 7, 6, 12);
    await settings.update({
      endPage: {
        groupUnlock: { method: "math" }
      },
      targets: {
        [targetId]: {
          timePeriods: [
            {
              id: "period:test",
              name: "All day",
              enabled: true,
              days: [0, 1, 2, 3, 4, 5, 6],
              startTime: "00:00",
              endTime: "00:00",
              behavior: "timed",
              limitMinutes: 2,
              groupCount: 2
            }
          ]
        }
      }
    });
    await analytics.recordInterval(targetId, now.getTime() - 60_000, now.getTime(), "period:test");

    await expect(decisions.decide(managedUrl, now)).resolves.toMatchObject({
      blocked: true,
      reason: "group-boundary",
      activePeriodId: "period:test",
      groupIndex: 1,
      groupCount: 2,
      groupBoundary: true,
      canRequestTemporaryAccess: false
    });
  });

  it("does not let legacy temporary access bypass an always-block period", async () => {
    const now = new Date(2026, 7, 6, 9);
    await settings.update({
      targets: {
        [targetId]: {
          timePeriods: [
            {
              id: "period:test",
              name: "All day",
              enabled: true,
              days: [0, 1, 2, 3, 4, 5, 6],
              startTime: "00:00",
              endTime: "00:00",
              behavior: "always-block",
              limitMinutes: null,
              groupCount: 1
            }
          ],
          temporaryAccess: { maxUsesPerDay: 1 }
        }
      }
    });
    const granted = await decisions.grant(managedUrl, now);
    expect(granted).toMatchObject({
      blocked: true,
      reason: "blocked",
      canRequestTemporaryAccess: false,
      temporaryAccessUsesRemaining: 1
    });
    expect(granted.temporaryAccessExpiresAt).toBeUndefined();
  });

  it("lets the master switch bypass every managed rule without losing it", async () => {
    await settings.update({ enabled: false });
    expect(await decisions.decide(managedUrl, new Date())).toMatchObject({
      blocked: false,
      reason: "focus-disabled"
    });
  });

  it("treats an explicit always-available period as a closed availability window", async () => {
    const monday = new Date(2026, 7, 3, 12);
    await settings.update({
      targets: {
        [targetId]: {
          dailyLimitMinutes: 1,
          timePeriods: [
            {
              id: "lunch",
              name: "午间",
              enabled: true,
              behavior: "always-allow",
              days: [1],
              startTime: "12:00",
              endTime: "14:00",
              limitMinutes: null,
              groupCount: 1
            }
          ],
          schedules: [
            {
              id: "lunch",
              name: "午间",
              enabled: true,
              effect: "allow",
              days: [1],
              startTime: "12:00",
              endTime: "14:00"
            }
          ]
        }
      }
    });
    await analytics.recordInterval(targetId, monday.getTime() - 60_000, monday.getTime());

    expect(await decisions.decide(managedUrl, monday)).toMatchObject({
      blocked: false,
      reason: "outside-schedule"
    });
    expect(await decisions.decide(managedUrl, new Date(2026, 7, 3, 15))).toMatchObject({
      blocked: true,
      reason: "blocked"
    });
  });

  it("ignores deprecated direct policies once canonical periods exist", async () => {
    await settings.update({
      targets: { [targetId]: { accessPolicy: "always-block", schedules: [] } }
    });
    expect(await decisions.decide(managedUrl, new Date())).toMatchObject({
      blocked: false,
      reason: "outside-schedule",
      canRequestTemporaryAccess: false
    });
    expect((await settings.get()).targets[targetId]?.accessPolicy).toBe("timed");
  });
});
