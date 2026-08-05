import { normalizePlanItemInput, type NormalizedPlanItemInput } from "../shared/plan";
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
    const activeGrant = validGrantForQueue(access.activeGrant, queue.items, this.now());
    if (access.activeGrant && !activeGrant) {
      await this.accessRepository.update((store) => {
        delete store.activeGrant;
      });
    }
    return {
      settings: settings.planMode,
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
      if (queue.items.some((item) => item.bvid === normalized.bvid)) {
        throw new Error("This video is already in the plan");
      }
      queue.items.push(createPlanItem(normalized, queue.items.length, this.now()));
    });
    return this.getState();
  }

  async update(id: string, patch: PlanItemPatch): Promise<PlanState> {
    let previousBvid = "";
    let nextBvid = "";
    await this.queueRepository.update((queue) => {
      const item = requireItem(queue.items, id);
      previousBvid = item.bvid;
      const changesIdentity = patch.bvid !== undefined || patch.url !== undefined;
      const normalized = requireNormalizedInput({
        ...(changesIdentity ? {} : { bvid: item.bvid }),
        ...(patch.bvid !== undefined ? { bvid: patch.bvid } : {}),
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        title: patch.title ?? item.title,
        source: patch.source ?? item.source
      });
      if (
        queue.items.some((candidate) => candidate.id !== id && candidate.bvid === normalized.bvid)
      ) {
        throw new Error("This video is already in the plan");
      }
      nextBvid = normalized.bvid;
      Object.assign(item, normalized);
    });
    if (previousBvid !== nextBvid) await this.clearGrantForItem(id);
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
    if (!settings.planMode.enabled) throw new Error("Plan mode is not enabled");
    const item = requireItem(queue.items, id);
    if (item.status !== "pending")
      throw new Error("Completed items must be restored before watching");
    const grantedAt = this.now();
    const grant: PlanWatchGrant = {
      itemId: item.id,
      bvid: item.bvid,
      grantedAt,
      expiresAt: grantedAt + settings.planMode.watchDurationMinutes * 60_000
    };
    await this.accessRepository.update((store) => {
      store.activeGrant = grant;
    });
    return { state: await this.getState(), url: item.url, expiresAt: grant.expiresAt };
  }

  async decideNavigation(bvid?: string): Promise<PlanNavigationDecision> {
    const settings = await this.settingsRepository.get();
    if (!settings.planMode.enabled) {
      return { planModeEnabled: false, allowed: true, reason: "disabled" };
    }
    if (!bvid) {
      return { planModeEnabled: true, allowed: false, reason: "not-video" };
    }

    const [queue, access] = await Promise.all([
      this.queueRepository.get(),
      this.accessRepository.get()
    ]);
    const grant = access.activeGrant;
    if (!grant) {
      return { planModeEnabled: true, allowed: false, reason: "not-authorized", bvid };
    }
    if (grant.expiresAt <= this.now()) {
      await this.accessRepository.update((store) => {
        delete store.activeGrant;
      });
      return { planModeEnabled: true, allowed: false, reason: "expired", bvid };
    }
    const item = queue.items.find(
      (candidate) =>
        candidate.id === grant.itemId &&
        candidate.bvid === grant.bvid &&
        candidate.status === "pending"
    );
    if (!item || grant.bvid !== bvid) {
      if (!item) {
        await this.accessRepository.update((store) => {
          delete store.activeGrant;
        });
      }
      return { planModeEnabled: true, allowed: false, reason: "not-authorized", bvid };
    }
    return {
      planModeEnabled: true,
      allowed: true,
      reason: "authorized",
      bvid,
      expiresAt: grant.expiresAt
    };
  }

  async importItems(
    inputs: PlanItemInput[],
    source: PlanItemSource = "manual"
  ): Promise<PlanImportResult> {
    const normalized = inputs.map((input) => requireNormalizedInput(input, source));
    let addedCount = 0;
    let skippedCount = 0;
    await this.queueRepository.update((queue) => {
      const seen = new Set(queue.items.map((item) => item.bvid));
      for (const input of normalized) {
        if (seen.has(input.bvid) || queue.items.length >= 500) {
          skippedCount += 1;
          continue;
        }
        seen.add(input.bvid);
        queue.items.push(createPlanItem(input, queue.items.length, this.now()));
        addedCount += 1;
      }
    });
    return { state: await this.getState(), addedCount, skippedCount };
  }

  private async clearGrantForItem(id: string): Promise<void> {
    await this.accessRepository.update((store) => {
      if (store.activeGrant?.itemId === id) delete store.activeGrant;
    });
  }
}

function validGrantForQueue(
  grant: PlanWatchGrant | undefined,
  items: PlanItem[],
  now: number
): PlanWatchGrant | undefined {
  if (!grant || grant.expiresAt <= now) return undefined;
  return items.some(
    (item) => item.id === grant.itemId && item.bvid === grant.bvid && item.status === "pending"
  )
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
  if (!normalized) throw new Error("Invalid Bilibili video URL, BVID, title, or source");
  return normalized;
}

function createPlanItem(input: NormalizedPlanItemInput, order: number, addedAt: number): PlanItem {
  return {
    id: createId(),
    ...input,
    status: "pending",
    order,
    addedAt,
    completedAt: null
  };
}

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
