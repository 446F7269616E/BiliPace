import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnalyticsService } from "../../src/shared/analytics";
import type { ExtensionApi, StorageAreaLike } from "../../src/shared/browser";
import { createDefaultSettings } from "../../src/shared/config";
import { PeriodRuntimeService } from "../../src/shared/period-runtime";
import {
  PeriodRuntimeRepository,
  RawUsageRepository,
  SettingsRepository
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
const siteId = "site:test";
const targetId = "target:test";
const periodId = "period:test";
let now = new Date(2026, 7, 12, 12).getTime();
let settings: SettingsRepository;
let analytics: AnalyticsService;
let runtime: PeriodRuntimeService;

beforeEach(async () => {
  for (const key of Object.keys(storage.values)) delete storage.values[key];
  now = new Date(2026, 7, 12, 12).getTime();
  (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser = {
    runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener: () => undefined } },
    storage: { local: storage }
  };
  settings = new SettingsRepository(storage);
  analytics = new AnalyticsService(new RawUsageRepository(storage));
  await settings.set({
    ...createDefaultSettings(),
    endPage: {
      view: "dashboard",
      motivationalMessage: "",
      groupUnlock: { method: "math", waitMinutes: 5, passwordVerifier: "" }
    },
    sites: {
      [siteId]: {
        id: siteId,
        origin: "https://example.com",
        hostname: "example.com",
        label: "Example",
        enabled: true,
        restrictionMode: "flow",
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
            id: periodId,
            name: "All day",
            enabled: true,
            days: [0, 1, 2, 3, 4, 5, 6],
            startTime: "00:00",
            endTime: "00:00",
            behavior: "timed",
            limitMinutes: 2,
            groupCount: 2
          }
        ],
        temporaryAccess: { enabled: false, durationMinutes: 5, maxUsesPerDay: 0 }
      }
    }
  });
  runtime = new PeriodRuntimeService(
    settings,
    new PeriodRuntimeRepository(storage),
    analytics,
    () => now
  );
});

afterEach(() => {
  delete (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser;
});

describe("period runtime", () => {
  it("validates a math challenge before unlocking the next allowance group", async () => {
    await analytics.recordInterval(targetId, now - 60_000, now, periodId);
    const status = await runtime.getStatus(targetId, periodId);
    expect(status).toMatchObject({ canUnlock: true, unlockedGroups: 1, groupCount: 2 });
    expect(status.mathChallenge).toBeDefined();
    await expect(runtime.unlock(targetId, periodId, "0")).rejects.toThrow();

    const challenge = status.mathChallenge as { left: number; right: number };
    await expect(
      runtime.unlock(targetId, periodId, String(challenge.left + challenge.right))
    ).resolves.toMatchObject({ unlockedGroups: 2, canUnlock: false });
  });

  it("rejects a concurrent unlock based on a stale group", async () => {
    await analytics.recordInterval(targetId, now - 60_000, now, periodId);
    const status = await runtime.getStatus(targetId, periodId);
    const challenge = status.mathChallenge as { left: number; right: number };
    const proof = String(challenge.left + challenge.right);

    const results = await Promise.allSettled([
      runtime.unlock(targetId, periodId, proof),
      runtime.unlock(targetId, periodId, proof)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(runtime.getStatus(targetId, periodId)).resolves.toMatchObject({
      unlockedGroups: 2
    });
  });

  it("grants one bounded flow continuation after the full period allowance", async () => {
    await analytics.recordInterval(targetId, now - 120_000, now, periodId);
    const entry = await runtime.grantFlow(targetId, periodId, { kind: "minutes", minutes: 15 });
    expect(entry).toMatchObject({
      flowUsed: true,
      flowContinuationKind: "minutes",
      flowExpiresAt: now + 15 * 60_000
    });
    await expect(
      runtime.grantFlow(targetId, periodId, { kind: "minutes", minutes: 1 })
    ).rejects.toThrow("already been used");
  });

  it("keeps video-end continuation active without a minute deadline", async () => {
    await analytics.recordInterval(targetId, now - 120_000, now, periodId);
    const entry = await runtime.grantFlow(targetId, periodId, { kind: "video-end" });
    expect(entry).toMatchObject({
      flowUsed: true,
      flowContinuationKind: "video-end"
    });
    expect(entry.flowExpiresAt).toBeUndefined();

    now += 60 * 60_000;
    await expect(runtime.getEntry(targetId, periodId)).resolves.toMatchObject({
      flowContinuationKind: "video-end"
    });
    expect((await runtime.getEntry(targetId, periodId)).flowExpiresAt).toBeUndefined();
  });
});
