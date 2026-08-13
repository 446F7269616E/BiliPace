import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PLAN_CONTENT_SCRIPT_REGISTRATION_ID,
  PlanContentRegistrationService,
  type PlanRegistrationRuntime
} from "../../src/background/plan-registration";
import { PlanService } from "../../src/background/plan";
import type { ExtensionApi, StorageAreaLike } from "../../src/shared/browser";
import { createDefaultSettings } from "../../src/shared/config";
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
}

class RegistrationRuntime implements PlanRegistrationRuntime {
  permissionGranted = false;
  readonly checkedOrigins: string[][] = [];
  readonly registrations = new Map<string, string[]>([
    ["hourleaf-site-existing", ["https://managed.example/*"]]
  ]);

  contains(origins: string[]): Promise<boolean> {
    this.checkedOrigins.push([...origins]);
    return Promise.resolve(this.permissionGranted);
  }

  list(): Promise<Array<{ id: string; matches?: string[] }>> {
    return Promise.resolve(
      [...this.registrations].map(([id, matches]) => ({ id, matches: [...matches] }))
    );
  }

  register(id: string, matches: string[]): Promise<void> {
    if (this.registrations.has(id)) throw new Error("Registration already exists");
    this.registrations.set(id, [...matches]);
    return Promise.resolve();
  }

  unregister(ids: string[]): Promise<void> {
    for (const id of ids) this.registrations.delete(id);
    return Promise.resolve();
  }
}

const storage = new MemoryStorage();
let now = 1_000;
let settings: SettingsRepository;
let plan: PlanService;
let runtime: RegistrationRuntime;
let registration: PlanContentRegistrationService;

beforeEach(async () => {
  for (const key of Object.keys(storage.values)) delete storage.values[key];
  (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser = {
    runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener: () => undefined } },
    storage: { local: storage }
  };
  now = 1_000;
  settings = new SettingsRepository(storage);
  await settings.set(createDefaultSettings());
  const queue = new PlanQueueRepository(storage);
  const access = new PlanAccessRepository(storage);
  plan = new PlanService(settings, queue, access, () => now);
  runtime = new RegistrationRuntime();
  registration = new PlanContentRegistrationService(settings, queue, access, runtime, () => now);
});

afterEach(() => {
  delete (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser;
});

describe("active plan content-script registration", () => {
  it("requires the exact item origin and never touches focus registrations", async () => {
    const state = await plan.add({
      url: "https://reading.example/article?id=1",
      scheduledDurationMinutes: 25,
      completionMode: "strict"
    });
    const itemId = state.queue.items[0]?.id ?? "missing";

    await expect(registration.prepareForStart(itemId)).rejects.toThrow(/permission/u);
    expect(runtime.checkedOrigins).toEqual([["https://reading.example/*"]]);
    expect(runtime.registrations.has(PLAN_CONTENT_SCRIPT_REGISTRATION_ID)).toBe(false);

    runtime.permissionGranted = true;
    await registration.prepareForStart(itemId);
    expect(runtime.registrations.get(PLAN_CONTENT_SCRIPT_REGISTRATION_ID)).toEqual([
      "https://reading.example/*"
    ]);
    expect(runtime.registrations.get("hourleaf-site-existing")).toEqual([
      "https://managed.example/*"
    ]);

    await plan.start(itemId);
    await registration.reconcile();
    runtime.permissionGranted = false;
    await registration.reconcile();
    await expect(plan.getState()).resolves.toMatchObject({
      settings: { enabled: false }
    });
    await expect(plan.getState()).resolves.not.toHaveProperty("activeGrant");
    expect(runtime.registrations.has(PLAN_CONTENT_SCRIPT_REGISTRATION_ID)).toBe(false);
    expect(runtime.registrations.has("hourleaf-site-existing")).toBe(true);

    runtime.permissionGranted = true;
    await registration.prepareForStart(itemId);
    await plan.start(itemId);
    now += 25 * 60_000 + 1;
    await plan.decideNavigation("https://reading.example/article?id=1");
    await registration.reconcile();
    expect(runtime.registrations.has(PLAN_CONTENT_SCRIPT_REGISTRATION_ID)).toBe(false);
    expect(runtime.registrations.has("hourleaf-site-existing")).toBe(true);
  });

  it("rebuilds an expired flow grant that is still waiting for its one decision", async () => {
    const state = await plan.add({
      url: "https://video.example/watch/1",
      scheduledDurationMinutes: 1,
      completionMode: "flow"
    });
    const itemId = state.queue.items[0]?.id ?? "missing";
    runtime.permissionGranted = true;
    await registration.prepareForStart(itemId);
    await plan.start(itemId);
    now += 60_001;
    runtime.registrations.delete(PLAN_CONTENT_SCRIPT_REGISTRATION_ID);

    await registration.reconcile();
    expect(runtime.registrations.get(PLAN_CONTENT_SCRIPT_REGISTRATION_ID)).toEqual([
      "https://video.example/*"
    ]);

    const continued = await plan.continueFlow(itemId, { kind: "minutes", minutes: 1 });
    now = continued.expiresAt + 1;
    await plan.decideNavigation("https://video.example/watch/1");
    await registration.reconcile();
    expect(runtime.registrations.has(PLAN_CONTENT_SCRIPT_REGISTRATION_ID)).toBe(false);
  });

  it("authorizes website messages by sender origin and current host permission", async () => {
    runtime.permissionGranted = true;
    const sender = {
      url: "https://reading.example/article?id=1",
      tab: { id: 3, url: "https://reading.example/article?id=1" }
    };
    await expect(
      registration.assertAuthorizedWebsiteUrl("https://reading.example/next", sender)
    ).resolves.toBeUndefined();
    await expect(
      registration.assertAuthorizedWebsiteUrl("https://other.example/next", sender)
    ).rejects.toThrow(/cross origins/u);

    runtime.permissionGranted = false;
    await expect(
      registration.assertAuthorizedWebsiteUrl("https://reading.example/next", sender)
    ).rejects.toThrow(/permission/u);
  });
});
