import { createDefaultSettings, mergeSettings, normalizeSettings } from "./config";
import { STORAGE_KEYS } from "./storage-keys";
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
  PeriodRuntimeEntry,
  PeriodRuntimeStore,
  PlanAccessStore,
  PlanItem,
  PlanItemSource,
  PlanQueueStore,
  SectionId,
  SiteModuleInstallation,
  SiteModuleManifest,
  SiteModuleSource,
  SiteModuleStore,
  TargetId,
  TemporaryAccessStore,
  UsageStore
} from "./types";
import {
  isPlanCompletionMode,
  isPlanDurationMinutes,
  isPlanId,
  isPlanItemSource,
  LEGACY_PLAN_DURATION_MINUTES,
  MAX_PLAN_ITEMS,
  normalizePlanUrl
} from "./plan";

export { STORAGE_KEYS } from "./storage-keys";

export class SettingsRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: StorageAreaLike = getSettingsStorageArea()) {}

  async get(): Promise<FocusSettings> {
    const result = await storageGet(this.area, STORAGE_KEYS.settings);
    return normalizeSettings(result[STORAGE_KEYS.settings]);
  }

  async set(settings: FocusSettings): Promise<FocusSettings> {
    return this.enqueue(() => this.write(settings));
  }

  async update(patch: DeepPartial<FocusSettings>): Promise<FocusSettings> {
    return this.mutate((current) => mergeSettings(current, patch));
  }

  /** Runs a read-modify-write transaction on the repository's shared write queue. */
  async mutate(
    mutator: (current: FocusSettings) => FocusSettings | void | Promise<FocusSettings | void>
  ): Promise<FocusSettings> {
    return this.enqueue(async () => {
      const current = await this.get();
      const next = await mutator(current);
      return this.write(next ?? current);
    });
  }

  async reset(): Promise<FocusSettings> {
    return this.enqueue(() => this.write(createDefaultSettings()));
  }

  private async write(settings: FocusSettings): Promise<FocusSettings> {
    const normalized = normalizeSettings(settings);
    await storageSet(this.area, { [STORAGE_KEYS.settings]: normalized });
    return normalized;
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
      await storageSet(this.area, { [STORAGE_KEYS.usage]: serializeUsageStore(store) });
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

export class SiteModuleRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();
  private readonly preinstalled: SiteModuleManifest[];

  constructor(
    private readonly area: StorageAreaLike = getLocalStorageArea(),
    preinstalled: readonly SiteModuleManifest[] = []
  ) {
    this.preinstalled = preinstalled
      .map(normalizeSiteModuleManifest)
      .filter((manifest): manifest is SiteModuleManifest => manifest !== null);
  }

  async get(): Promise<SiteModuleStore> {
    const result = await storageGet(this.area, STORAGE_KEYS.modules);
    return normalizeSiteModuleStore(result[STORAGE_KEYS.modules]);
  }

  async initialize(now = Date.now()): Promise<SiteModuleStore> {
    return this.update((store) => {
      const preinstalledIds = new Set(this.preinstalled.map((manifest) => manifest.id));
      for (const [id, installation] of Object.entries(store.installations)) {
        if (installation.source === "bundled" && !preinstalledIds.has(id)) {
          delete store.installations[id];
        }
      }
      for (const manifest of this.preinstalled) {
        const previous = store.installations[manifest.id];
        if (previous) {
          const versionChanged = previous.manifest.version !== manifest.version;
          previous.manifest = manifest;
          previous.source = "bundled";
          if (versionChanged) previous.updatedAt = now;
        } else if (!store.removedModuleIds.includes(manifest.id)) {
          store.installations[manifest.id] = {
            manifest,
            source: "bundled",
            enabled: false,
            installedAt: now,
            updatedAt: now
          };
        }
      }
    });
  }

  async restore(id: string, now = Date.now()): Promise<SiteModuleStore> {
    const manifest = this.preinstalled.find((candidate) => candidate.id === id);
    if (!manifest) throw new Error("Site module is not included in this Hourleaf build");
    return this.update((store) => {
      store.removedModuleIds = store.removedModuleIds.filter((moduleId) => moduleId !== id);
      store.installations[id] = {
        manifest,
        source: "bundled",
        enabled: false,
        installedAt: now,
        updatedAt: now
      };
    });
  }

  async setEnabled(id: string, enabled: boolean, now = Date.now()): Promise<SiteModuleStore> {
    return this.update((store) => {
      const current = store.installations[id];
      if (!current) throw new Error("Site module is not installed");
      current.enabled = enabled;
      current.updatedAt = now;
    });
  }

  async uninstall(id: string): Promise<SiteModuleStore> {
    return this.update((store) => {
      delete store.installations[id];
      if (this.preinstalled.some((manifest) => manifest.id === id)) {
        store.removedModuleIds = [...new Set([...store.removedModuleIds, id])].slice(0, 32);
      }
    });
  }

  private update(mutator: (store: SiteModuleStore) => void): Promise<SiteModuleStore> {
    const operation = async () => {
      const store = await this.get();
      mutator(store);
      const normalized = normalizeSiteModuleStore(store);
      await storageSet(this.area, { [STORAGE_KEYS.modules]: normalized });
      return normalized;
    };
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

export class PeriodRuntimeRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: StorageAreaLike = getLocalStorageArea()) {}

  async get(): Promise<PeriodRuntimeStore> {
    const result = await storageGet(this.area, STORAGE_KEYS.periodRuntime);
    return normalizePeriodRuntimeStore(result[STORAGE_KEYS.periodRuntime]);
  }

  async update(
    mutator: (store: PeriodRuntimeStore) => void | Promise<void>
  ): Promise<PeriodRuntimeStore> {
    return this.enqueue(async () => {
      const store = await this.get();
      await mutator(store);
      const normalized = normalizePeriodRuntimeStore(store);
      await storageSet(this.area, { [STORAGE_KEYS.periodRuntime]: normalized });
      return normalized;
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
  const store: UsageStore = { schemaVersion: 3, days: {} };
  if (!isRecord(value) || !isRecord(value.days)) return store;

  for (const [date, rawDay] of Object.entries(value.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isRecord(rawDay)) continue;
    const rawTargets = isRecord(rawDay.byTarget) ? rawDay.byTarget : {};
    const rawSections = isRecord(rawDay.bySection) ? rawDay.bySection : {};
    const rawPeriods = isRecord(rawDay.byPeriod) ? rawDay.byPeriod : {};
    const byTarget = normalizeTargetNumbers(rawTargets);
    const byPeriod = normalizeTargetNumbers(rawPeriods);
    for (const section of LEGACY_SECTIONS) {
      const seconds = normalizeSeconds(rawSections[section]);
      if (seconds > 0) byTarget[legacyTargetId(section)] = seconds;
    }
    store.days[date] = {
      date,
      byTarget,
      byPeriod,
      bySection: projectLegacySections(byTarget)
    };
  }
  return store;
}

function normalizeTemporaryAccessStore(value: unknown): TemporaryAccessStore {
  const store: TemporaryAccessStore = {
    schemaVersion: 2,
    expiresAtByTarget: {},
    usesByDateAndTarget: {},
    expiresAtBySection: {},
    usesByDate: {}
  };
  if (!isRecord(value)) return store;

  if (isRecord(value.expiresAtByTarget)) {
    for (const [targetId, expiresAt] of Object.entries(value.expiresAtByTarget)) {
      if (isStableTargetId(targetId) && isNonNegativeNumber(expiresAt)) {
        store.expiresAtByTarget[targetId] = expiresAt;
      }
    }
  }

  if (isRecord(value.expiresAtBySection)) {
    for (const [section, expiresAt] of Object.entries(value.expiresAtBySection)) {
      if (isSectionId(section) && isNonNegativeNumber(expiresAt)) {
        store.expiresAtBySection[section] = expiresAt;
        store.expiresAtByTarget[legacyTargetId(section)] = expiresAt;
      }
    }
  }
  if (isRecord(value.usesByDateAndTarget)) {
    for (const [date, rawCounts] of Object.entries(value.usesByDateAndTarget)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isRecord(rawCounts)) continue;
      const counts: Partial<Record<TargetId, number>> = {};
      for (const [targetId, uses] of Object.entries(rawCounts)) {
        if (isStableTargetId(targetId) && isNonNegativeNumber(uses)) {
          counts[targetId] = Math.floor(uses);
        }
      }
      store.usesByDateAndTarget[date] = counts;
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

function normalizePeriodRuntimeStore(value: unknown): PeriodRuntimeStore {
  const store: PeriodRuntimeStore = { schemaVersion: 1, entries: {} };
  if (!isRecord(value) || !isRecord(value.entries)) return store;
  for (const [key, raw] of Object.entries(value.entries).slice(0, 512)) {
    if (!isRecord(raw) || !isStableRuntimeKey(key)) continue;
    if (
      typeof raw.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(raw.date) ||
      typeof raw.targetId !== "string" ||
      !isStableTargetId(raw.targetId) ||
      typeof raw.periodId !== "string" ||
      !isStableTargetId(raw.periodId)
    ) {
      continue;
    }
    const entry: PeriodRuntimeEntry = {
      date: raw.date,
      targetId: raw.targetId,
      periodId: raw.periodId,
      unlockedGroups: isNonNegativeNumber(raw.unlockedGroups)
        ? Math.max(1, Math.min(24, Math.floor(raw.unlockedGroups)))
        : 1
    };
    if (isTimestamp(raw.waitStartedAt)) entry.waitStartedAt = raw.waitStartedAt;
    if (raw.flowUsed === true) entry.flowUsed = true;
    if (raw.flowContinuationKind === "minutes" || raw.flowContinuationKind === "video-end") {
      entry.flowContinuationKind = raw.flowContinuationKind;
    }
    // Older builds persisted video-end as a 15-minute timer. Ignore that timer
    // while retaining minute-continuation expiries under the new explicit contract.
    if (entry.flowContinuationKind === "minutes" && isTimestamp(raw.flowExpiresAt)) {
      entry.flowExpiresAt = raw.flowExpiresAt;
    }
    store.entries[key] = entry;
  }
  return store;
}

export function normalizePlanQueueStore(value: unknown): PlanQueueStore {
  const store: PlanQueueStore = { schemaVersion: 1, items: [] };
  if (!isRecord(value) || !Array.isArray(value.items)) return store;

  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const candidates: PlanItem[] = [];
  for (const raw of value.items.slice(0, MAX_PLAN_ITEMS)) {
    if (!isRecord(raw)) continue;
    const url = normalizePlanUrl(raw.url);
    if (!url) continue;
    const id = isPlanId(raw.id) && !seenIds.has(raw.id) ? raw.id : createPlanId();
    if (seenUrls.has(url.href)) continue;
    seenIds.add(id);
    seenUrls.add(url.href);

    const status = raw.status === "completed" ? "completed" : "pending";
    const addedAt = isTimestamp(raw.addedAt) ? raw.addedAt : 0;
    const completedAt =
      status === "completed" && isTimestamp(raw.completedAt) ? raw.completedAt : null;
    candidates.push({
      id,
      ...(isLegacyIdentity(raw.bvid) ? { bvid: raw.bvid } : {}),
      url: url.href,
      origin: url.origin,
      title:
        typeof raw.title === "string" && raw.title.trim()
          ? raw.title.trim().slice(0, 200)
          : url.hostname,
      status,
      order: isNonNegativeNumber(raw.order) ? Math.floor(raw.order) : candidates.length,
      source: isPlanItemSource(raw.source) ? raw.source : ("manual" satisfies PlanItemSource),
      scheduledDurationMinutes: isPlanDurationMinutes(raw.scheduledDurationMinutes)
        ? raw.scheduledDurationMinutes
        : LEGACY_PLAN_DURATION_MINUTES,
      completionMode: isPlanCompletionMode(raw.completionMode) ? raw.completionMode : "strict",
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
  const url = normalizePlanUrl(grant.url);
  if (
    !isPlanId(grant.itemId) ||
    !url ||
    !isTimestamp(grant.grantedAt) ||
    !isTimestamp(grant.expiresAt) ||
    grant.expiresAt <= grant.grantedAt
  ) {
    return store;
  }
  const completionMode = isPlanCompletionMode(grant.completionMode)
    ? grant.completionMode
    : "strict";
  const flowContinuationKind =
    completionMode === "flow" &&
    (grant.flowContinuationKind === "minutes" || grant.flowContinuationKind === "video-end")
      ? grant.flowContinuationKind
      : undefined;
  store.activeGrant = {
    itemId: grant.itemId,
    url: url.href,
    origin: url.origin,
    ...(isLegacyIdentity(grant.bvid) ? { bvid: grant.bvid } : {}),
    grantedAt: grant.grantedAt,
    expiresAt: flowContinuationKind === "video-end" ? Number.MAX_SAFE_INTEGER : grant.expiresAt,
    scheduledDurationMinutes: isPlanDurationMinutes(grant.scheduledDurationMinutes)
      ? grant.scheduledDurationMinutes
      : legacyGrantDurationMinutes(grant.grantedAt, grant.expiresAt),
    completionMode,
    ...(flowContinuationKind ? { flowContinuationKind } : {})
  };
  return store;
}

function legacyGrantDurationMinutes(grantedAt: number, expiresAt: number): number {
  const duration = Math.ceil((expiresAt - grantedAt) / 60_000);
  return isPlanDurationMinutes(duration) ? duration : LEGACY_PLAN_DURATION_MINUTES;
}

const LEGACY_SECTIONS: readonly SectionId[] = [
  "home",
  "dynamic",
  "popular",
  "video",
  "live",
  "bangumi",
  "search"
];

export function legacyTargetId(section: SectionId): TargetId {
  return `legacy:bilibili:${section}`;
}

function normalizeTargetNumbers(value: Record<string, unknown>): Record<TargetId, number> {
  const result: Record<TargetId, number> = {};
  for (const [targetId, seconds] of Object.entries(value)) {
    if (isStableTargetId(targetId) && isNonNegativeNumber(seconds)) {
      result[targetId] = Math.round(seconds);
    }
  }
  return result;
}

function projectLegacySections(value: Record<TargetId, number>): Record<SectionId, number> {
  const result = Object.fromEntries(LEGACY_SECTIONS.map((section) => [section, 0])) as Record<
    SectionId,
    number
  >;
  for (const section of LEGACY_SECTIONS) {
    result[section] =
      normalizeSeconds(value[section]) + normalizeSeconds(value[legacyTargetId(section)]);
  }
  return result;
}

function serializeUsageStore(store: UsageStore): {
  schemaVersion: 3;
  days: Record<
    string,
    { date: string; byTarget: Record<TargetId, number>; byPeriod: Record<string, number> }
  >;
} {
  return {
    schemaVersion: 3,
    days: Object.fromEntries(
      Object.entries(store.days).map(([date, day]) => [
        date,
        { date, byTarget: day.byTarget, byPeriod: day.byPeriod }
      ])
    )
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

function isStableTargetId(value: string): boolean {
  return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function isStableRuntimeKey(value: string): boolean {
  return value.length <= 300 && /^[A-Za-z0-9._:|-]+$/.test(value);
}

function isLegacyIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 100;
}

function normalizeSiteModuleStore(value: unknown): SiteModuleStore {
  const store: SiteModuleStore = { schemaVersion: 2, installations: {}, removedModuleIds: [] };
  if (!isRecord(value) || !isRecord(value.installations)) return store;
  if (value.schemaVersion === 2 && Array.isArray(value.removedModuleIds)) {
    const removedModuleIds = new Set<string>();
    for (const moduleId of (value.removedModuleIds as unknown[]).slice(0, 32)) {
      if (typeof moduleId === "string" && isStableTargetId(moduleId)) {
        removedModuleIds.add(moduleId);
      }
    }
    store.removedModuleIds = [...removedModuleIds];
  }
  for (const [id, raw] of Object.entries(value.installations).slice(0, 32)) {
    if (!isStableTargetId(id) || !isRecord(raw)) continue;
    const manifest = normalizeSiteModuleManifest(raw.manifest);
    if (!manifest || manifest.id !== id) continue;
    const source: SiteModuleSource = "bundled";
    const installation: SiteModuleInstallation = {
      manifest,
      source,
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
      installedAt: isTimestamp(raw.installedAt) ? raw.installedAt : 0,
      updatedAt: isTimestamp(raw.updatedAt) ? raw.updatedAt : 0
    };
    store.installations[id] = installation;
  }
  for (const id of store.removedModuleIds) delete store.installations[id];
  return store;
}

export function normalizeSiteModuleManifest(value: unknown): SiteModuleManifest | null {
  if (!isRecord(value) || typeof value.id !== "string" || !isStableTargetId(value.id)) return null;
  if (
    typeof value.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.version)
  ) {
    return null;
  }
  if (typeof value.name !== "string" || !value.name.trim()) return null;
  const hosts = Array.isArray(value.hosts) ? value.hosts.filter(isSafeModuleHost).slice(0, 32) : [];
  const sections = Array.isArray(value.sections)
    ? value.sections
        .filter(isRecord)
        .filter(
          (item) =>
            typeof item.id === "string" &&
            isStableTargetId(item.id) &&
            typeof item.label === "string"
        )
        .slice(0, 64)
        .map((item) => ({
          id: String(item.id),
          label: String(item.label).trim().slice(0, 80),
          ...(typeof item.targetId === "string" && isStableTargetId(item.targetId)
            ? { targetId: item.targetId }
            : {}),
          ...(Array.isArray(item.hosts)
            ? {
                hosts: item.hosts
                  .filter(isSafeModuleHost)
                  .filter((host) => hosts.includes(host))
                  .slice(0, 32)
              }
            : {})
        }))
    : [];
  const allowedCapabilities = new Set(["classify", "content-filter", "plan", "usage-tracking"]);
  const capabilities = Array.isArray(value.capabilities)
    ? [...new Set(value.capabilities.filter((item): item is string => typeof item === "string"))]
        .filter((item) => allowedCapabilities.has(item))
        .slice(0, 8)
    : [];
  return {
    id: String(value.id),
    version: value.version,
    name: value.name.trim().slice(0, 80),
    hosts,
    sections,
    capabilities: capabilities as SiteModuleManifest["capabilities"]
  };
}

function isSafeModuleHost(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 255) return false;
  return /^(https?|\*):\/\/(?:\*\.)?[A-Za-z0-9.-]+(?::\d+)?\/\*$/.test(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function createPlanId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
