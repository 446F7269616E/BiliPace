import { createDefaultSettings, mergeSettings, normalizeSettings } from "./config";
import {
  getLocalStorageArea,
  getSettingsStorageArea,
  storageGet,
  storageRemove,
  storageSet,
  type StorageAreaLike
} from "./browser";
import type {
  DeepPartial,
  FocusSettings,
  PlanAccessStore,
  PlanItem,
  PlanItemSource,
  PlanQueueStore,
  SectionId,
  TemporaryAccessStore,
  UsageStore
} from "./types";
import { canonicalVideoUrl, isBvid, isPlanId, isPlanItemSource, MAX_PLAN_ITEMS } from "./plan";

export const STORAGE_KEYS = {
  settings: "bilifocus.settings.v1",
  usage: "bilifocus.usage.v1",
  temporaryAccess: "bilifocus.temporary-access.v1",
  planQueue: "bilifocus.plan-queue.v1",
  planAccess: "bilifocus.plan-access.v1"
} as const;

export class SettingsRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: StorageAreaLike = getSettingsStorageArea()) {}

  async get(): Promise<FocusSettings> {
    const result = await storageGet(this.area, STORAGE_KEYS.settings);
    return normalizeSettings(result[STORAGE_KEYS.settings]);
  }

  async set(settings: FocusSettings): Promise<FocusSettings> {
    const normalized = normalizeSettings(settings);
    await storageSet(this.area, { [STORAGE_KEYS.settings]: normalized });
    return normalized;
  }

  async update(patch: DeepPartial<FocusSettings>): Promise<FocusSettings> {
    return this.enqueue(async () => {
      const current = await this.get();
      return this.set(mergeSettings(current, patch));
    });
  }

  async reset(): Promise<FocusSettings> {
    const defaults = createDefaultSettings();
    await this.set(defaults);
    return defaults;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }
}

export class RawUsageRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: StorageAreaLike = getLocalStorageArea()) {}

  async get(): Promise<UsageStore> {
    const result = await storageGet(this.area, STORAGE_KEYS.usage);
    return normalizeUsageStore(result[STORAGE_KEYS.usage]);
  }

  async update(mutator: (store: UsageStore) => void | Promise<void>): Promise<UsageStore> {
    return this.enqueue(async () => {
      const store = await this.get();
      await mutator(store);
      await storageSet(this.area, { [STORAGE_KEYS.usage]: store });
      return store;
    });
  }

  async clear(): Promise<void> {
    await this.enqueue(() => storageRemove(this.area, STORAGE_KEYS.usage));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }
}

export class TemporaryAccessRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: StorageAreaLike = getLocalStorageArea()) {}

  async get(): Promise<TemporaryAccessStore> {
    const result = await storageGet(this.area, STORAGE_KEYS.temporaryAccess);
    return normalizeTemporaryAccessStore(result[STORAGE_KEYS.temporaryAccess]);
  }

  async update(
    mutator: (store: TemporaryAccessStore) => void | Promise<void>
  ): Promise<TemporaryAccessStore> {
    return this.enqueue(async () => {
      const store = await this.get();
      await mutator(store);
      await storageSet(this.area, { [STORAGE_KEYS.temporaryAccess]: store });
      return store;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }
}

export class PlanQueueRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: StorageAreaLike = getLocalStorageArea()) {}

  async get(): Promise<PlanQueueStore> {
    const result = await storageGet(this.area, STORAGE_KEYS.planQueue);
    return normalizePlanQueueStore(result[STORAGE_KEYS.planQueue]);
  }

  async update(mutator: (store: PlanQueueStore) => void | Promise<void>): Promise<PlanQueueStore> {
    return this.enqueue(async () => {
      const store = await this.get();
      await mutator(store);
      // Mutators express ordering by array position. Re-index before crossing the
      // persistence boundary so moves cannot be undone by stale order fields.
      store.items.forEach((item, order) => (item.order = order));
      const normalized = normalizePlanQueueStore(store);
      await storageSet(this.area, { [STORAGE_KEYS.planQueue]: normalized });
      return normalized;
    });
  }

  async clear(): Promise<void> {
    await this.enqueue(() => storageRemove(this.area, STORAGE_KEYS.planQueue));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }
}

export class PlanAccessRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: StorageAreaLike = getLocalStorageArea()) {}

  async get(): Promise<PlanAccessStore> {
    const result = await storageGet(this.area, STORAGE_KEYS.planAccess);
    return normalizePlanAccessStore(result[STORAGE_KEYS.planAccess]);
  }

  async update(
    mutator: (store: PlanAccessStore) => void | Promise<void>
  ): Promise<PlanAccessStore> {
    return this.enqueue(async () => {
      const store = await this.get();
      await mutator(store);
      const normalized = normalizePlanAccessStore(store);
      await storageSet(this.area, { [STORAGE_KEYS.planAccess]: normalized });
      return normalized;
    });
  }

  async clear(): Promise<void> {
    await this.enqueue(() => storageRemove(this.area, STORAGE_KEYS.planAccess));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }
}

function normalizeUsageStore(value: unknown): UsageStore {
  const store: UsageStore = { schemaVersion: 1, days: {} };
  if (!isRecord(value) || !isRecord(value.days)) return store;

  for (const [date, rawDay] of Object.entries(value.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isRecord(rawDay)) continue;
    const rawSections = isRecord(rawDay.bySection) ? rawDay.bySection : {};
    store.days[date] = {
      date,
      bySection: normalizeSectionNumbers(rawSections)
    };
  }
  return store;
}

function normalizeTemporaryAccessStore(value: unknown): TemporaryAccessStore {
  const store: TemporaryAccessStore = {
    schemaVersion: 1,
    expiresAtBySection: {},
    usesByDate: {}
  };
  if (!isRecord(value)) return store;

  if (isRecord(value.expiresAtBySection)) {
    for (const [section, expiresAt] of Object.entries(value.expiresAtBySection)) {
      if (isSectionId(section) && isNonNegativeNumber(expiresAt)) {
        store.expiresAtBySection[section] = expiresAt;
      }
    }
  }
  if (isRecord(value.usesByDate)) {
    for (const [date, uses] of Object.entries(value.usesByDate)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && isNonNegativeNumber(uses)) {
        store.usesByDate[date] = Math.floor(uses);
      }
    }
  }
  return store;
}

export function normalizePlanQueueStore(value: unknown): PlanQueueStore {
  const store: PlanQueueStore = { schemaVersion: 1, items: [] };
  if (!isRecord(value) || !Array.isArray(value.items)) return store;

  const seenIds = new Set<string>();
  const seenBvids = new Set<string>();
  const candidates: PlanItem[] = [];
  for (const raw of value.items.slice(0, MAX_PLAN_ITEMS)) {
    if (!isRecord(raw) || !isBvid(raw.bvid)) continue;
    const id = isPlanId(raw.id) && !seenIds.has(raw.id) ? raw.id : createPlanId();
    if (seenBvids.has(raw.bvid)) continue;
    seenIds.add(id);
    seenBvids.add(raw.bvid);

    const status = raw.status === "completed" ? "completed" : "pending";
    const addedAt = isTimestamp(raw.addedAt) ? raw.addedAt : 0;
    const completedAt =
      status === "completed" && isTimestamp(raw.completedAt) ? raw.completedAt : null;
    candidates.push({
      id,
      bvid: raw.bvid,
      url: canonicalVideoUrl(raw.bvid),
      title:
        typeof raw.title === "string" && raw.title.trim()
          ? raw.title.trim().slice(0, 200)
          : raw.bvid,
      status,
      order: isNonNegativeNumber(raw.order) ? Math.floor(raw.order) : candidates.length,
      source: isPlanItemSource(raw.source) ? raw.source : ("manual" satisfies PlanItemSource),
      addedAt,
      completedAt
    });
  }

  candidates.sort((left, right) => left.order - right.order || left.addedAt - right.addedAt);
  candidates.forEach((item, order) => (item.order = order));
  store.items = candidates;
  return store;
}

export function normalizePlanAccessStore(value: unknown): PlanAccessStore {
  const store: PlanAccessStore = { schemaVersion: 1 };
  if (!isRecord(value) || !isRecord(value.activeGrant)) return store;
  const grant = value.activeGrant;
  if (
    !isPlanId(grant.itemId) ||
    !isBvid(grant.bvid) ||
    !isTimestamp(grant.grantedAt) ||
    !isTimestamp(grant.expiresAt) ||
    grant.expiresAt <= grant.grantedAt
  ) {
    return store;
  }
  store.activeGrant = {
    itemId: grant.itemId,
    bvid: grant.bvid,
    grantedAt: grant.grantedAt,
    expiresAt: grant.expiresAt
  };
  return store;
}

function normalizeSectionNumbers(value: Record<string, unknown>): Record<SectionId, number> {
  return {
    home: normalizeSeconds(value.home),
    dynamic: normalizeSeconds(value.dynamic),
    popular: normalizeSeconds(value.popular),
    video: normalizeSeconds(value.video),
    live: normalizeSeconds(value.live),
    bangumi: normalizeSeconds(value.bangumi),
    search: normalizeSeconds(value.search)
  };
}

function normalizeSeconds(value: unknown): number {
  return isNonNegativeNumber(value) ? Math.round(value) : 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSectionId(value: string): value is SectionId {
  return ["home", "dynamic", "popular", "video", "live", "bangumi", "search"].includes(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function createPlanId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
