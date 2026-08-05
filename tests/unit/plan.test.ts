import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlanService } from "../../src/background/plan";
import type { ExtensionApi, StorageAreaLike } from "../../src/shared/browser";
import {
  canonicalVideoUrl,
  extractBvidFromVideoUrl,
  normalizePlanItemInput
} from "../../src/shared/plan";
import {
  PlanAccessRepository,
  PlanQueueRepository,
  SettingsRepository,
  STORAGE_KEYS
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
let now = 1_700_000_000_000;
let settings: SettingsRepository;
let service: PlanService;

beforeEach(() => {
  now = 1_700_000_000_000;
  for (const key of Object.keys(storage.values)) delete storage.values[key];
  (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser = {
    runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener: () => undefined } },
    storage: { local: storage }
  };
  settings = new SettingsRepository(storage);
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

describe("plan video identity", () => {
  it("accepts exact Bilibili video routes and canonicalizes away arbitrary URL data", () => {
    const source = "https://m.bilibili.com/video/BV1xx411c7mD/?spm_id_from=private#comment-123";
    expect(extractBvidFromVideoUrl(source)).toBe("BV1xx411c7mD");
    expect(normalizePlanItemInput({ url: source, title: "  视频  " })).toEqual({
      bvid: "BV1xx411c7mD",
      url: canonicalVideoUrl("BV1xx411c7mD"),
      title: "视频",
      source: "manual"
    });
    expect(extractBvidFromVideoUrl("https://www.bilibili.com/search?bvid=BV1xx411c7mD")).toBeNull();
    expect(extractBvidFromVideoUrl("https://bilibili.com.evil.test/video/BV1xx411c7mD")).toBeNull();
    expect(
      normalizePlanItemInput({
        bvid: "BV1xx411c7mD",
        url: "https://www.bilibili.com/video/BV17x411w7KC"
      })
    ).toBeNull();
  });
});

describe("plan queue and watch authorization", () => {
  it("migrates malformed local data without retaining arbitrary URLs", async () => {
    storage.values[STORAGE_KEYS.planQueue] = {
      schemaVersion: 99,
      items: [
        {
          id: "stable-id",
          bvid: "BV1xx411c7mD",
          url: "https://evil.test/private?secret=1",
          title: "保留标题",
          status: "pending",
          order: 9,
          source: "manual",
          addedAt: now
        },
        { id: "bad", bvid: "invalid", url: "https://evil.test" }
      ]
    };
    const state = await service.getState();
    expect(state.queue.items).toHaveLength(1);
    expect(state.queue.items[0]).toMatchObject({
      id: "stable-id",
      bvid: "BV1xx411c7mD",
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
      order: 0
    });
  });

  it("grants only the current pending item for the configured bounded time", async () => {
    await settings.update({ planMode: { enabled: true, watchDurationMinutes: 5 } });
    const added = await service.add({
      url: "https://www.bilibili.com/video/BV1xx411c7mD?from=private",
      title: "第一集"
    });
    const item = added.queue.items[0];
    expect(item?.url).toBe("https://www.bilibili.com/video/BV1xx411c7mD");

    const started = await service.start(item?.id ?? "");
    expect(started.expiresAt).toBe(now + 5 * 60_000);
    await expect(service.decideNavigation("BV1xx411c7mD")).resolves.toMatchObject({
      allowed: true,
      reason: "authorized"
    });
    await expect(service.decideNavigation("BV17x411w7KC")).resolves.toMatchObject({
      allowed: false,
      reason: "not-authorized"
    });
    await expect(service.decideNavigation()).resolves.toMatchObject({
      allowed: false,
      reason: "not-video"
    });

    now += 5 * 60_000;
    await expect(service.decideNavigation("BV1xx411c7mD")).resolves.toMatchObject({
      allowed: false,
      reason: "expired"
    });
  });

  it("supports import, ordering, completion, restoration, and duplicate suppression", async () => {
    const result = await service.importItems(
      [
        { bvid: "BV1xx411c7mD", title: "A" },
        { bvid: "BV17x411w7KC", title: "B" },
        { bvid: "BV1xx411c7mD", title: "duplicate" }
      ],
      "watch-later"
    );
    expect(result).toMatchObject({ addedCount: 2, skippedCount: 1 });
    const [first, second] = result.state.queue.items;
    expect(first?.source).toBe("watch-later");

    const moved = await service.move(second?.id ?? "", "up");
    expect(moved.queue.items.map((item) => item.id)).toEqual([second?.id, first?.id]);
    expect(moved.queue.items.map((item) => item.order)).toEqual([0, 1]);

    const completed = await service.setCompleted(second?.id ?? "", true);
    expect(completed.queue.items[0]).toMatchObject({ status: "completed", completedAt: now });
    const restored = await service.setCompleted(second?.id ?? "", false);
    expect(restored.queue.items[0]).toMatchObject({ status: "pending", completedAt: null });

    const reordered = await service.reorder([first?.id ?? "", second?.id ?? ""]);
    expect(reordered.queue.items.map((item) => item.id)).toEqual([first?.id, second?.id]);
  });
});
