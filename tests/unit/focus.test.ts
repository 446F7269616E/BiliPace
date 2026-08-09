import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnalyticsService } from "../../src/shared/analytics";
import type { ExtensionApi, StorageAreaLike } from "../../src/shared/browser";
import { FocusDecisionService } from "../../src/shared/focus";
import {
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

beforeEach(() => {
  for (const key of Object.keys(storage.values)) delete storage.values[key];
  (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser = {
    runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener: () => undefined } },
    storage: { local: storage }
  };
  settings = new SettingsRepository(storage);
  analytics = new AnalyticsService(new RawUsageRepository(storage));
  decisions = new FocusDecisionService(settings, new TemporaryAccessRepository(storage), analytics);
});

afterEach(() => {
  delete (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser;
});

describe("focus decisions", () => {
  it("uses a quota-only rule when a daily limit is set without schedules", async () => {
    const now = new Date(2026, 7, 6, 12);
    await settings.update({
      sectionRules: { video: { enabled: true, dailyLimitMinutes: 1, schedules: [] } }
    });
    expect((await decisions.decide("https://www.bilibili.com/video/BV1test", now)).blocked).toBe(
      false
    );

    await analytics.recordInterval("video", now.getTime() - 60_000, now.getTime());
    const limited = await decisions.decide("https://www.bilibili.com/video/BV1test", now);
    expect(limited).toMatchObject({ blocked: true, reason: "daily-limit" });
  });

  it("persists a scoped temporary allowance with a bounded daily use count", async () => {
    const now = new Date(2026, 7, 6, 9);
    await settings.update({
      temporaryAccess: { enabled: true, durationMinutes: 5, maxUsesPerDay: 1 }
    });
    const url = "https://www.bilibili.com/";
    const granted = await decisions.grant(url, now);
    expect(granted).toMatchObject({
      blocked: false,
      reason: "temporary-access",
      temporaryAccessUsesRemaining: 0
    });
    expect(granted.temporaryAccessExpiresAt).toBe(now.getTime() + 5 * 60_000);

    const later = new Date(now.getTime() + 6 * 60_000);
    const expired = await decisions.decide(url, later);
    expect(expired).toMatchObject({ blocked: true, canRequestTemporaryAccess: false });
  });

  it("lets the master switch bypass every managed rule without losing it", async () => {
    await settings.update({ enabled: false });
    expect(await decisions.decide("https://www.bilibili.com/", new Date())).toMatchObject({
      blocked: false,
      reason: "focus-disabled"
    });
  });

  it("lets explicit time rules take precedence over the daily limit", async () => {
    const monday = new Date(2026, 7, 3, 12);
    await settings.update({
      sectionRules: {
        video: {
          enabled: true,
          dailyLimitMinutes: 1,
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
    await analytics.recordInterval("video", monday.getTime() - 60_000, monday.getTime());

    expect(await decisions.decide("https://www.bilibili.com/video/BV1test", monday)).toMatchObject({
      blocked: false,
      reason: "outside-schedule"
    });
    expect(
      await decisions.decide("https://www.bilibili.com/video/BV1test", new Date(2026, 7, 3, 15))
    ).toMatchObject({ blocked: true, reason: "blocked" });
  });
});
