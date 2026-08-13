import {
  isPlanFlowExtensionMinutes,
  normalizePlanItemInput,
  normalizePlanUrl,
  type NormalizedPlanItemInput
} from "../shared/plan";
import { PlanAccessRepository, PlanQueueRepository, SettingsRepository } from "../shared/storage";
import type {
  PlanItem,
  PlanItemInput,
  PlanItemPatch,
  PlanItemSource,
  PlanModeSettings,
  PlanNavigationDecision,
  PlanState,
  PlanWatchGrant
} from "../shared/types";

export type PlanFlowContinuation = { kind: "minutes"; minutes: number } | { kind: "video-end" };

export interface PlanImportResult {
  state: PlanState;
  addedCount: number;
  skippedCount: number;
}

export class PlanService {
  constructor(
    private readonly settingsRepository = new SettingsRepository(),
    private readonly queueRepository = new PlanQueueRepository(),
    private readonly accessRepository = new PlanAccessRepository(),
    private readonly now: () => number = Date.now
  ) {}

  async getState(): Promise<PlanState> {
    const [settings, queue, access] = await Promise.all([
      this.settingsRepository.get(),
      this.queueRepository.get(),
      this.accessRepository.get()
    ]);
    const validGrant = validGrantForQueue(access.activeGrant, queue.items, this.now());
    const activeGrant = settings.planMode.enabled ? validGrant : undefined;
    let planSettings = settings.planMode;
    const shouldClearGrant = Boolean(access.activeGrant && !activeGrant);
    const shouldDisableMode = settings.planMode.enabled && !activeGrant;
    if (shouldClearGrant || shouldDisableMode) {
      await Promise.all([
        shouldClearGrant
          ? this.accessRepository.update((store) => {
              delete store.activeGrant;
            })
          : Promise.resolve(access),
        shouldDisableMode
          ? this.settingsRepository.update({ planMode: { enabled: false } })
          : Promise.resolve(settings)
      ]);
      planSettings = { ...planSettings, enabled: false };
    }
    return {
      settings: planSettings,
      queue,
      ...(activeGrant ? { activeGrant } : {})
    };
  }

  async setMode(patch: Partial<PlanModeSettings>): Promise<PlanState> {
    await this.settingsRepository.update({ planMode: patch });
    if (patch.enabled === false) {
      await this.accessRepository.update((store) => {
        delete store.activeGrant;
      });
    }
    return this.getState();
  }

  async add(input: PlanItemInput): Promise<PlanState> {
    const normalized = requireNormalizedInput(input);
    await this.queueRepository.update((queue) => {
      if (queue.items.some((item) => item.url === normalized.url)) {
        throw new Error("This page is already in the plan");
      }
      queue.items.push(createPlanItem(normalized, queue.items.length, this.now()));
    });
    return this.getState();
  }

  async update(id: string, patch: PlanItemPatch): Promise<PlanState> {
    let shouldClearGrant = false;
    await this.queueRepository.update((queue) => {
      const item = requireItem(queue.items, id);
      const previousAuthorization = planItemAuthorizationIdentity(item);
      const normalized = requireNormalizedInput({
        url: patch.url ?? item.url,
        ...(patch.bvid !== undefined ? { bvid: patch.bvid } : item.bvid ? { bvid: item.bvid } : {}),
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        title: patch.title ?? item.title,
        source: patch.source ?? item.source,
        scheduledDurationMinutes: patch.scheduledDurationMinutes ?? item.scheduledDurationMinutes,
        completionMode: patch.completionMode ?? item.completionMode
      });
      if (
        queue.items.some((candidate) => candidate.id !== id && candidate.url === normalized.url)
      ) {
        throw new Error("This page is already in the plan");
      }
      Object.assign(item, persistedPlanInput(normalized));
      shouldClearGrant = previousAuthorization !== planItemAuthorizationIdentity(item);
    });
    if (shouldClearGrant) await this.clearGrantForItem(id);
    return this.getState();
  }

  async remove(id: string): Promise<PlanState> {
    await this.queueRepository.update((queue) => {
      const index = queue.items.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("Plan item not found");
      queue.items.splice(index, 1);
    });
    await this.clearGrantForItem(id);
    return this.getState();
  }

  async move(id: string, direction: "up" | "down"): Promise<PlanState> {
    await this.queueRepository.update((queue) => {
      const index = queue.items.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("Plan item not found");
      const destination = direction === "up" ? index - 1 : index + 1;
      if (destination < 0 || destination >= queue.items.length) return;
      const [item] = queue.items.splice(index, 1);
      if (item) queue.items.splice(destination, 0, item);
    });
    return this.getState();
  }

  async reorder(orderedIds: string[]): Promise<PlanState> {
    await this.queueRepository.update((queue) => {
      if (
        orderedIds.length !== queue.items.length ||
        new Set(orderedIds).size !== orderedIds.length ||
        queue.items.some((item) => !orderedIds.includes(item.id))
      ) {
        throw new Error("The new order must include every plan item exactly once");
      }
      const itemById = new Map(queue.items.map((item) => [item.id, item]));
      queue.items = orderedIds.map((id) => itemById.get(id) as PlanItem);
    });
    return this.getState();
  }

  async setCompleted(id: string, completed: boolean): Promise<PlanState> {
    await this.queueRepository.update((queue) => {
      const item = requireItem(queue.items, id);
      item.status = completed ? "completed" : "pending";
      item.completedAt = completed ? this.now() : null;
    });
    if (completed) await this.clearGrantForItem(id);
    return this.getState();
  }

  async start(id: string): Promise<{ state: PlanState; url: string; expiresAt: number }> {
    const [settings, queue] = await Promise.all([
      this.settingsRepository.get(),
      this.queueRepository.get()
    ]);
    const item = requireItem(queue.items, id);
    if (item.status !== "pending") throw new Error("请先将已完成项目恢复为待办");
    const grantedAt = this.now();
    const grant: PlanWatchGrant = {
      itemId: item.id,
      url: item.url,
      origin: item.origin,
      ...(item.bvid ? { bvid: item.bvid } : {}),
      grantedAt,
      expiresAt: grantedAt + item.scheduledDurationMinutes * 60_000,
      scheduledDurationMinutes: item.scheduledDurationMinutes,
      completionMode: item.completionMode
    };
    await this.accessRepository.update((store) => {
      store.activeGrant = grant;
    });
    try {
      await this.settingsRepository.update({ planMode: { enabled: true } });
      if (settings.planMode.autoCompleteOnStart) {
        await this.queueRepository.update((currentQueue) => {
          const startedItem = requireItem(currentQueue.items, item.id);
          startedItem.status = "completed";
          startedItem.completedAt = this.now();
        });
      }
    } catch (error) {
      await Promise.all([
        this.accessRepository.update((store) => {
          if (store.activeGrant?.itemId === item.id) delete store.activeGrant;
        }),
        this.settingsRepository.update({ planMode: { enabled: false } })
      ]);
      throw error;
    }
    return { state: await this.getState(), url: item.url, expiresAt: grant.expiresAt };
  }

  async decideNavigation(url?: string, legacyIdentity?: string): Promise<PlanNavigationDecision> {
    const navigationUrl = normalizePlanUrl(url)?.href;
    const settings = await this.settingsRepository.get();
    if (!settings.planMode.enabled) {
      return { planModeEnabled: false, allowed: true, reason: "disabled" };
    }
    if (!navigationUrl && !legacyIdentity) {
      return { planModeEnabled: true, allowed: false, reason: "not-video" };
    }

    const [queue, access] = await Promise.all([
      this.queueRepository.get(),
      this.accessRepository.get()
    ]);
    const grant = access.activeGrant;
    if (!grant) {
      await this.settingsRepository.update({ planMode: { enabled: false } });
      return {
        planModeEnabled: false,
        allowed: true,
        reason: "disabled",
        ...(navigationUrl ? { url: navigationUrl } : {}),
        ...(legacyIdentity ? { bvid: legacyIdentity } : {})
      };
    }
    if (grant.flowContinuationKind !== "video-end" && grant.expiresAt <= this.now()) {
      if (grant.completionMode === "flow" && !grant.flowContinuationKind) {
        return {
          planModeEnabled: true,
          allowed: false,
          reason: "expired",
          itemId: grant.itemId,
          completionMode: "flow",
          expiredAt: grant.expiresAt,
          flowDecisionRequired: true,
          ...(navigationUrl ? { url: navigationUrl } : {}),
          ...(legacyIdentity ? { bvid: legacyIdentity } : {})
        };
      }
      await Promise.all([
        this.accessRepository.update((store) => {
          delete store.activeGrant;
        }),
        this.settingsRepository.update({ planMode: { enabled: false } })
      ]);
      return {
        planModeEnabled: true,
        allowed: grant.completionMode === "lenient",
        reason: "expired",
        itemId: grant.itemId,
        completionMode: grant.completionMode,
        expiredAt: grant.expiresAt,
        ...(grant.completionMode === "flow" ? { flowDecisionRequired: false } : {}),
        ...(navigationUrl ? { url: navigationUrl } : {}),
        ...(legacyIdentity ? { bvid: legacyIdentity } : {})
      };
    }
    const item = queue.items.find(
      (candidate) => candidate.id === grant.itemId && candidate.url === grant.url
    );
    const identityMatches = navigationUrl
      ? grant.url === navigationUrl
      : Boolean(legacyIdentity && grant.bvid === legacyIdentity);
    if (!item || !identityMatches) {
      if (!item) {
        await Promise.all([
          this.accessRepository.update((store) => {
            delete store.activeGrant;
          }),
          this.settingsRepository.update({ planMode: { enabled: false } })
        ]);
      }
      return {
        planModeEnabled: true,
        allowed: false,
        reason: "not-authorized",
        completionMode: grant.completionMode,
        ...(navigationUrl ? { url: navigationUrl } : {}),
        ...(legacyIdentity ? { bvid: legacyIdentity } : {})
      };
    }
    return {
      planModeEnabled: true,
      allowed: true,
      reason: "authorized",
      itemId: item.id,
      url: item.url,
      origin: item.origin,
      ...(item.bvid ? { bvid: item.bvid } : {}),
      expiresAt: grant.expiresAt,
      completionMode: grant.completionMode,
      ...(grant.flowContinuationKind ? { flowContinuationKind: grant.flowContinuationKind } : {})
    };
  }

  async continueFlow(
    itemId: string,
    continuation: PlanFlowContinuation,
    expectedUrl?: string
  ): Promise<{
    state: PlanState;
    url: string;
    expiresAt: number;
    continuationKind: PlanFlowContinuation["kind"];
  }> {
    const [queue, access] = await Promise.all([
      this.queueRepository.get(),
      this.accessRepository.get()
    ]);
    const item = requireItem(queue.items, itemId);
    const grant = access.activeGrant;
    const normalizedExpectedUrl = expectedUrl ? normalizePlanUrl(expectedUrl)?.href : undefined;
    if (
      !grant ||
      grant.itemId !== item.id ||
      grant.url !== item.url ||
      grant.completionMode !== "flow" ||
      grant.flowContinuationKind !== undefined ||
      grant.expiresAt > this.now() ||
      (expectedUrl !== undefined && normalizedExpectedUrl !== grant.url)
    ) {
      throw new Error("This plan item is not waiting for a flow decision");
    }
    if (continuation.kind === "minutes" && !isPlanFlowExtensionMinutes(continuation.minutes)) {
      throw new Error("Flow extension must be between 1 and 15 minutes");
    }
    const grantedAt = this.now();
    const expiresAt =
      continuation.kind === "minutes"
        ? grantedAt + continuation.minutes * 60_000
        : Number.MAX_SAFE_INTEGER;
    await this.accessRepository.update((store) => {
      const activeGrant = store.activeGrant;
      if (
        !activeGrant ||
        activeGrant.itemId !== item.id ||
        activeGrant.url !== item.url ||
        activeGrant.completionMode !== "flow" ||
        activeGrant.flowContinuationKind !== undefined ||
        activeGrant.expiresAt > grantedAt
      ) {
        throw new Error("The flow decision is no longer active");
      }
      store.activeGrant = {
        ...activeGrant,
        grantedAt,
        expiresAt,
        flowContinuationKind: continuation.kind
      };
    });
    try {
      await this.settingsRepository.update({ planMode: { enabled: true } });
    } catch (error) {
      await this.accessRepository.update((store) => {
        if (store.activeGrant?.itemId === item.id && store.activeGrant.expiresAt === expiresAt) {
          delete store.activeGrant;
        }
      });
      throw error;
    }
    return {
      state: await this.getState(),
      url: item.url,
      expiresAt,
      continuationKind: continuation.kind
    };
  }

  async revokeFlow(itemId: string, expectedUrl?: string): Promise<PlanState> {
    const normalizedExpectedUrl = expectedUrl ? normalizePlanUrl(expectedUrl)?.href : undefined;
    await this.accessRepository.update((store) => {
      const grant = store.activeGrant;
      if (
        !grant ||
        grant.itemId !== itemId ||
        grant.completionMode !== "flow" ||
        (expectedUrl !== undefined && normalizedExpectedUrl !== grant.url)
      ) {
        throw new Error("This flow continuation is no longer active");
      }
      delete store.activeGrant;
    });
    await this.settingsRepository.update({ planMode: { enabled: false } });
    return this.getState();
  }

  async importItems(
    inputs: PlanItemInput[],
    source: PlanItemSource = "manual"
  ): Promise<PlanImportResult> {
    const normalized = inputs.map((input) => requireNormalizedInput(input, source));
    let addedCount = 0;
    let skippedCount = 0;
    await this.queueRepository.update((queue) => {
      const seen = new Set(queue.items.map((item) => item.url));
      for (const input of normalized) {
        if (seen.has(input.url) || queue.items.length >= 500) {
          skippedCount += 1;
          continue;
        }
        seen.add(input.url);
        queue.items.push(createPlanItem(input, queue.items.length, this.now()));
        addedCount += 1;
      }
    });
    return { state: await this.getState(), addedCount, skippedCount };
  }

  private async clearGrantForItem(id: string): Promise<void> {
    let cleared = false;
    await this.accessRepository.update((store) => {
      if (store.activeGrant?.itemId !== id) return;
      delete store.activeGrant;
      cleared = true;
    });
    if (cleared) await this.settingsRepository.update({ planMode: { enabled: false } });
  }
}

function validGrantForQueue(
  grant: PlanWatchGrant | undefined,
  items: PlanItem[],
  now: number
): PlanWatchGrant | undefined {
  if (
    !grant ||
    (grant.flowContinuationKind !== "video-end" &&
      grant.expiresAt <= now &&
      (grant.completionMode !== "flow" || grant.flowContinuationKind !== undefined))
  ) {
    return undefined;
  }
  return items.some((item) => item.id === grant.itemId && item.url === grant.url)
    ? grant
    : undefined;
}

function requireItem(items: PlanItem[], id: string): PlanItem {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error("Plan item not found");
  return item;
}

function requireNormalizedInput(
  input: unknown,
  fallbackSource?: PlanItemSource
): NormalizedPlanItemInput {
  const normalized = normalizePlanItemInput(input, fallbackSource);
  if (!normalized) throw new Error("Invalid website URL, title, duration, or source");
  return normalized;
}

function createPlanItem(input: NormalizedPlanItemInput, order: number, addedAt: number): PlanItem {
  return {
    id: createId(),
    ...persistedPlanInput(input),
    status: "pending",
    order,
    addedAt,
    completedAt: null
  };
}

function persistedPlanInput(
  input: NormalizedPlanItemInput
): Pick<
  PlanItem,
  "url" | "origin" | "title" | "source" | "bvid" | "scheduledDurationMinutes" | "completionMode"
> {
  return {
    url: input.url,
    origin: input.origin,
    title: input.title,
    source: input.source,
    scheduledDurationMinutes: input.scheduledDurationMinutes,
    completionMode: input.completionMode,
    ...(input.bvid ? { bvid: input.bvid } : {})
  };
}

function planItemAuthorizationIdentity(item: PlanItem): string {
  return `${item.url}\n${item.bvid ?? ""}\n${item.scheduledDurationMinutes}\n${item.completionMode}`;
}

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
