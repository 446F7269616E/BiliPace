import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlanService } from "../../src/background/plan";
import type { ExtensionApi, StorageAreaLike } from "../../src/shared/browser";
import { createDefaultSettings } from "../../src/shared/config";
import { normalizePlanItemInput } from "../../src/shared/plan";
import {
  PlanAccessRepository,
  PlanQueueRepository,
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

  remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete this.values[key];
    return Promise.resolve();
  }
}

const storage = new MemoryStorage();
let now = 1_000;
let settings: SettingsRepository;
let service: PlanService;

beforeEach(async () => {
  for (const key of Object.keys(storage.values)) delete storage.values[key];
  (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser = {
    runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener: () => undefined } },
    storage: { local: storage }
  };
  now = 1_000;
  settings = new SettingsRepository(storage);
  await settings.set(createDefaultSettings());
  service = new PlanService(
    settings,
    new PlanQueueRepository(storage),
    new PlanAccessRepository(storage),
    () => now
  );
});

afterEach(() => {
  delete (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser;
});

describe("generic plan", () => {
  it("normalizes HTTP(S) URLs without keeping fragments or credentials", () => {
    expect(
      normalizePlanItemInput({ url: "https://example.com/read?id=1#private", title: " Read " })
    ).toMatchObject({
      url: "https://example.com/read?id=1",
      origin: "https://example.com",
      title: "Read"
    });
    expect(normalizePlanItemInput({ url: "file:///private/data" })).toBeNull();
    expect(normalizePlanItemInput({ url: "https://user:pass@example.com/" })).toBeNull();
  });

  it("grants only the explicitly started URL for the configured duration", async () => {
    await service.setMode({ watchDurationMinutes: 30 });
    let state = await service.add({ url: "https://example.com/focus", title: "Focus" });
    const item = state.queue.items[0];
    expect(item).toBeDefined();

    const started = await service.start(item?.id ?? "missing");
    expect(started.url).toBe("https://example.com/focus");
    expect(started.state.settings.enabled).toBe(true);
    await expect(service.decideNavigation(started.url)).resolves.toMatchObject({
      allowed: true,
      reason: "authorized",
      expiresAt: now + 30 * 60_000
    });
    await expect(service.decideNavigation("https://example.com/other")).resolves.toMatchObject({
      allowed: false,
      reason: "not-authorized"
    });

    state = await service.setCompleted(item?.id ?? "missing", true);
    expect(state.activeGrant).toBeUndefined();
    expect(state.settings.enabled).toBe(false);
  });

  it("expires grants without backdating or extending them", async () => {
    await service.setMode({ enabled: true, watchDurationMinutes: 1 });
    const state = await service.add({ url: "https://example.com/today" });
    const item = state.queue.items[0];
    await service.start(item?.id ?? "missing");
    now += 60_001;
    await expect(service.decideNavigation("https://example.com/today")).resolves.toMatchObject({
      allowed: false,
      reason: "expired"
    });
    const expiredState = await service.getState();
    expect(expiredState.settings.enabled).toBe(false);
    expect(expiredState).not.toHaveProperty("activeGrant");
  });

  it("recovers a legacy enabled mode that has no active plan item", async () => {
    await service.setMode({ enabled: true });

    await expect(service.decideNavigation("https://example.com/unplanned")).resolves.toMatchObject({
      planModeEnabled: false,
      allowed: true,
      reason: "disabled"
    });
    await expect(service.getState()).resolves.toMatchObject({
      settings: { enabled: false }
    });
  });

  it("deduplicates imports and persists an explicit order", async () => {
    const imported = await service.importItems([
      { url: "https://one.example/", title: "One" },
      { url: "https://two.example/", title: "Two" },
      { url: "https://one.example/", title: "Duplicate" }
    ]);
    expect(imported).toMatchObject({ addedCount: 2, skippedCount: 1 });
    const ids = imported.state.queue.items.map((item) => item.id);
    const reordered = await service.reorder([...ids].reverse());
    expect(reordered.queue.items.map((item) => item.id)).toEqual([...ids].reverse());
  });
});
