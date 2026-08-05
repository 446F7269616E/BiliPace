import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnalyticsService } from "../../src/shared/analytics";
import type { ExtensionApi, StorageAreaLike } from "../../src/shared/browser";
import { RawUsageRepository } from "../../src/shared/storage";

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

  remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete this.values[key];
    return Promise.resolve();
  }
}

const storage = new MemoryStorage();

beforeEach(() => {
  for (const key of Object.keys(storage.values)) delete storage.values[key];
  (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser = {
    runtime: {
      sendMessage: () => Promise.resolve(),
      onMessage: { addListener: () => undefined }
    },
    storage: { local: storage }
  };
});

afterEach(() => {
  delete (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser;
});

describe("usage analytics", () => {
  it("splits an interval across local midnight", async () => {
    const analytics = new AnalyticsService(new RawUsageRepository(storage));
    const start = new Date(2026, 7, 3, 23, 59, 50).getTime();
    const end = new Date(2026, 7, 4, 0, 0, 10).getTime();
    await analytics.recordInterval("video", start, end);

    const monday = await analytics.summarize("day", new Date(2026, 7, 3, 12));
    const tuesday = await analytics.summarize("day", new Date(2026, 7, 4, 12));
    expect(monday.bySection.video).toBe(10);
    expect(tuesday.bySection.video).toBe(10);
  });

  it("derives a Monday-to-Sunday week and fills missing daily buckets", async () => {
    const analytics = new AnalyticsService(new RawUsageRepository(storage));
    await analytics.recordInterval(
      "home",
      new Date(2026, 7, 5, 12, 0, 0).getTime(),
      new Date(2026, 7, 5, 12, 1, 0).getTime()
    );
    const summary = await analytics.summarize("week", new Date(2026, 7, 5));
    expect(summary.startDate).toBe("2026-08-03");
    expect(summary.endDate).toBe("2026-08-09");
    expect(summary.byDay).toHaveLength(7);
    expect(summary.totalSeconds).toBe(60);
  });
});
