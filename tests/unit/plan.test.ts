import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlanService } from "../../src/background/plan";
import type { ExtensionApi, StorageAreaLike } from "../../src/shared/browser";
import { createDefaultSettings } from "../../src/shared/config";
import { normalizePlanItemInput } from "../../src/shared/plan";
import {
  PlanAccessRepository,
  PlanQueueRepository,
  SettingsRepository,
  normalizePlanAccessStore,
  normalizePlanQueueStore
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
      normalizePlanItemInput({
        url: "https://example.com/read?id=1#private",
        title: " Read ",
        scheduledDurationMinutes: 25,
        completionMode: "flow"
      })
    ).toMatchObject({
      url: "https://example.com/read?id=1",
      origin: "https://example.com",
      title: "Read"
    });
    expect(
      normalizePlanItemInput({
        url: "https://example.com/read?id=1#private",
        title: " Read ",
        scheduledDurationMinutes: 25,
        completionMode: "flow"
      })
    ).toMatchObject({ scheduledDurationMinutes: 25, completionMode: "flow" });
    expect(
      normalizePlanItemInput({
        url: "file:///private/data",
        scheduledDurationMinutes: 25,
        completionMode: "flow"
      })
    ).toBeNull();
    expect(
      normalizePlanItemInput({
        url: "https://user:pass@example.com/",
        scheduledDurationMinutes: 25,
        completionMode: "flow"
      })
    ).toBeNull();
    expect(
      normalizePlanItemInput({
        url: "https://example.com/",
        scheduledDurationMinutes: 0,
        completionMode: "flow"
      })
    ).toBeNull();
  });

  it("grants only the explicitly started URL for the configured duration", async () => {
    let state = await service.add({
      url: "https://example.com/focus",
      title: "Focus",
      scheduledDurationMinutes: 30,
      completionMode: "strict"
    });
    const item = state.queue.items[0];
    expect(item).toBeDefined();

    const started = await service.start(item?.id ?? "missing");
    expect(started.url).toBe("https://example.com/focus");
    expect(started.state.settings.enabled).toBe(true);
    expect(started.state.activeGrant).toMatchObject({
      itemId: item?.id,
      scheduledDurationMinutes: 30,
      completionMode: "strict"
    });
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

  it("revokes the active authorization when its URL, duration, mode, or item changes", async () => {
    let state = await service.add({
      url: "https://example.com/edit",
      title: "Before",
      scheduledDurationMinutes: 20,
      completionMode: "strict"
    });
    const item = state.queue.items[0];
    const itemId = item?.id ?? "missing";
    await service.start(itemId);

    state = await service.update(itemId, { title: "After" });
    expect(state.activeGrant?.itemId).toBe(itemId);
    state = await service.update(itemId, { scheduledDurationMinutes: 25 });
    expect(state.activeGrant).toBeUndefined();
    expect(state.settings.enabled).toBe(false);

    await service.start(itemId);
    state = await service.update(itemId, { completionMode: "lenient" });
    expect(state.activeGrant).toBeUndefined();

    await service.start(itemId);
    state = await service.remove(itemId);
    expect(state.activeGrant).toBeUndefined();
    expect(state.queue.items).toHaveLength(0);
  });

  it("expires grants without backdating or extending them", async () => {
    await service.setMode({ enabled: true });
    const state = await service.add({
      url: "https://example.com/today",
      scheduledDurationMinutes: 1,
      completionMode: "strict"
    });
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
      {
        url: "https://one.example/",
        title: "One",
        scheduledDurationMinutes: 10,
        completionMode: "flow"
      },
      {
        url: "https://two.example/",
        title: "Two",
        scheduledDurationMinutes: 20,
        completionMode: "lenient"
      },
      {
        url: "https://one.example/",
        title: "Duplicate",
        scheduledDurationMinutes: 10,
        completionMode: "flow"
      }
    ]);
    expect(imported).toMatchObject({ addedCount: 2, skippedCount: 1 });
    const ids = imported.state.queue.items.map((item) => item.id);
    const reordered = await service.reorder([...ids].reverse());
    expect(reordered.queue.items.map((item) => item.id)).toEqual([...ids].reverse());
  });

  it("migrates legacy plan durations and authorization policy without widening access", () => {
    const queue = normalizePlanQueueStore({
      schemaVersion: 1,
      items: [
        {
          id: "legacy-item",
          url: "https://example.com/legacy",
          title: "Legacy",
          status: "pending",
          order: 0,
          source: "manual",
          addedAt: 10,
          completedAt: null
        }
      ]
    });
    expect(queue.items[0]).toMatchObject({
      scheduledDurationMinutes: 45,
      completionMode: "strict"
    });

    expect(
      normalizePlanAccessStore({
        schemaVersion: 1,
        activeGrant: {
          itemId: "legacy-item",
          url: "https://example.com/legacy",
          grantedAt: 1_000,
          expiresAt: 1_000 + 30 * 60_000
        }
      }).activeGrant
    ).toMatchObject({ scheduledDurationMinutes: 30, completionMode: "strict" });

    expect(
      normalizePlanAccessStore({
        schemaVersion: 1,
        activeGrant: {
          itemId: "legacy-video-flow",
          url: "https://example.com/video",
          grantedAt: 1_000,
          expiresAt: 1_000 + 15 * 60_000,
          scheduledDurationMinutes: 30,
          completionMode: "flow",
          flowContinuationKind: "video-end"
        }
      }).activeGrant
    ).toMatchObject({
      expiresAt: Number.MAX_SAFE_INTEGER,
      flowContinuationKind: "video-end"
    });
  });

  it("keeps flow expiry pending until a bounded continuation or explicit revoke", async () => {
    const state = await service.add({
      url: "https://example.com/flow",
      scheduledDurationMinutes: 1,
      completionMode: "flow"
    });
    const item = state.queue.items[0];
    await service.start(item?.id ?? "missing");
    now += 60_001;

    await expect(service.decideNavigation("https://example.com/flow")).resolves.toMatchObject({
      allowed: false,
      reason: "expired",
      completionMode: "flow",
      flowDecisionRequired: true
    });
    expect((await service.getState()).activeGrant?.itemId).toBe(item?.id);
    await expect(
      service.continueFlow(item?.id ?? "missing", { kind: "minutes", minutes: 16 })
    ).rejects.toThrow(/1 and 15/u);
    await expect(
      service.continueFlow(
        item?.id ?? "missing",
        { kind: "minutes", minutes: 5 },
        "https://example.com/not-the-plan"
      )
    ).rejects.toThrow(/not waiting/u);

    const continued = await service.continueFlow(item?.id ?? "missing", {
      kind: "video-end"
    });
    expect(continued).toMatchObject({
      continuationKind: "video-end",
      expiresAt: Number.MAX_SAFE_INTEGER
    });
    now += 24 * 60 * 60_000;
    await expect(service.decideNavigation("https://example.com/flow")).resolves.toMatchObject({
      allowed: true,
      reason: "authorized",
      completionMode: "flow",
      flowContinuationKind: "video-end"
    });
    await expect(service.getState()).resolves.toHaveProperty(
      "activeGrant.flowContinuationKind",
      "video-end"
    );
  });

  it("revokes a video-end flow continuation when playback ends", async () => {
    const state = await service.add({
      url: "https://example.com/video",
      scheduledDurationMinutes: 1,
      completionMode: "flow"
    });
    const item = state.queue.items[0];
    await service.start(item?.id ?? "missing");
    now += 60_001;
    await service.continueFlow(item?.id ?? "missing", { kind: "video-end" });
    await expect(
      service.revokeFlow(item?.id ?? "missing", "https://example.com/not-the-plan")
    ).rejects.toThrow(/no longer active/u);
    await expect(service.revokeFlow(item?.id ?? "missing")).resolves.not.toHaveProperty(
      "activeGrant"
    );
  });

  it("allows lenient expiry once and auto-completes only when configured", async () => {
    await service.setMode({ autoCompleteOnStart: true });
    const state = await service.add({
      url: "https://example.com/lenient",
      scheduledDurationMinutes: 1,
      completionMode: "lenient"
    });
    const item = state.queue.items[0];
    const started = await service.start(item?.id ?? "missing");
    expect(started.state.queue.items[0]?.status).toBe("completed");
    expect(started.state.activeGrant?.itemId).toBe(item?.id);

    now += 60_001;
    await expect(service.decideNavigation("https://example.com/lenient")).resolves.toMatchObject({
      allowed: true,
      reason: "expired",
      completionMode: "lenient"
    });
    await expect(service.getState()).resolves.not.toHaveProperty("activeGrant");
  });
});
