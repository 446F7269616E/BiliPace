import { AnalyticsService, formatLocalDate } from "./analytics";
import { PeriodRuntimeRepository, SettingsRepository } from "./storage";
import type {
  FocusSettings,
  PeriodRuntimeEntry,
  PeriodRuntimeStatus,
  SiteTargetSettings,
  TimePeriodSettings
} from "./types";

const RUNTIME_RETENTION_DAYS = 35;
const FLOW_EXTENSION_MAX_MINUTES = 15;

export type PeriodFlowContinuation = { kind: "minutes"; minutes: number } | { kind: "video-end" };

export class PeriodRuntimeService {
  constructor(
    private readonly settingsRepository = new SettingsRepository(),
    private readonly repository = new PeriodRuntimeRepository(),
    private readonly analytics = new AnalyticsService(),
    private readonly now: () => number = Date.now
  ) {}

  async getEntry(
    targetId: string,
    periodId: string,
    at = new Date(this.now())
  ): Promise<PeriodRuntimeEntry> {
    const date = formatLocalDate(at);
    const store = await this.repository.get();
    return (
      store.entries[runtimeKey(date, targetId, periodId)] ?? createEntry(date, targetId, periodId)
    );
  }

  async getStatus(targetId: string, periodId: string): Promise<PeriodRuntimeStatus> {
    const now = new Date(this.now());
    const [settings, entry, usage] = await Promise.all([
      this.settingsRepository.get(),
      this.getEntry(targetId, periodId, now),
      this.analytics.summarize("day", now)
    ]);
    const { target, period } = requirePeriod(settings, targetId, periodId);
    const method = settings.endPage.groupUnlock.method;
    const groupCount = Math.max(1, period.groupCount);
    const unlockedGroups = Math.min(groupCount, Math.max(1, entry.unlockedGroups));
    const usedSeconds = usage.byPeriod[period.id] ?? 0;
    const groupSeconds = period.limitMinutes ? (period.limitMinutes * 60) / groupCount : Infinity;
    const canUnlock =
      period.behavior === "timed" &&
      period.limitMinutes !== null &&
      unlockedGroups < groupCount &&
      usedSeconds >= groupSeconds * unlockedGroups;
    const waitEndsAt = entry.waitStartedAt
      ? entry.waitStartedAt + settings.endPage.groupUnlock.waitMinutes * 60_000
      : undefined;
    return {
      date: entry.date,
      targetId: target.id,
      periodId: period.id,
      method,
      unlockedGroups,
      groupCount,
      canUnlock,
      ...(entry.waitStartedAt ? { waitStartedAt: entry.waitStartedAt } : {}),
      ...(waitEndsAt ? { waitEndsAt } : {}),
      ...(method === "math" ? { mathChallenge: mathChallenge(entry) } : {}),
      ...(method === "password"
        ? { passwordConfigured: settings.endPage.groupUnlock.passwordVerifier.length === 64 }
        : {})
    };
  }

  async startWait(targetId: string, periodId: string): Promise<PeriodRuntimeStatus> {
    const settings = await this.settingsRepository.get();
    requirePeriod(settings, targetId, periodId);
    if (settings.endPage.groupUnlock.method !== "wait") {
      throw new Error("The selected group unlock method does not require waiting");
    }
    const now = new Date(this.now());
    const date = formatLocalDate(now);
    await this.repository.update((store) => {
      pruneRuntime(store.entries, now);
      const key = runtimeKey(date, targetId, periodId);
      const entry = store.entries[key] ?? createEntry(date, targetId, periodId);
      entry.waitStartedAt ??= now.getTime();
      store.entries[key] = entry;
    });
    return this.getStatus(targetId, periodId);
  }

  async unlock(targetId: string, periodId: string, proof?: string): Promise<PeriodRuntimeStatus> {
    const nowMs = this.now();
    const now = new Date(nowMs);
    const [settings, status] = await Promise.all([
      this.settingsRepository.get(),
      this.getStatus(targetId, periodId)
    ]);
    if (!status.canUnlock) throw new Error("The next usage group is not ready to unlock");
    const method = settings.endPage.groupUnlock.method;
    if (method === "wait" && (!status.waitEndsAt || nowMs < status.waitEndsAt)) {
      throw new Error("The waiting period has not finished");
    }
    if (method === "math") {
      const challenge = status.mathChallenge;
      if (!challenge || Number(proof) !== challenge.left + challenge.right) {
        throw new Error("The math answer is incorrect");
      }
    }
    if (method === "password") {
      const verifier = settings.endPage.groupUnlock.passwordVerifier;
      if (verifier.length !== 64 || proof !== verifier)
        throw new Error("The password is incorrect");
    }
    const date = formatLocalDate(now);
    await this.repository.update((store) => {
      const key = runtimeKey(date, targetId, periodId);
      const entry = store.entries[key] ?? createEntry(date, targetId, periodId);
      const currentUnlockedGroups = Math.min(status.groupCount, Math.max(1, entry.unlockedGroups));
      if (currentUnlockedGroups !== status.unlockedGroups) {
        throw new Error("The usage group changed; refresh before unlocking again");
      }
      entry.unlockedGroups = Math.min(status.groupCount, entry.unlockedGroups + 1);
      delete entry.waitStartedAt;
      store.entries[key] = entry;
      pruneRuntime(store.entries, now);
    });
    return this.getStatus(targetId, periodId);
  }

  async grantFlow(
    targetId: string,
    periodId: string,
    continuation: PeriodFlowContinuation
  ): Promise<PeriodRuntimeEntry> {
    const nowMs = this.now();
    const now = new Date(nowMs);
    const settings = await this.settingsRepository.get();
    const { target, period } = requirePeriod(settings, targetId, periodId);
    const site = settings.sites[target.siteId];
    if (site?.restrictionMode !== "flow" || period.behavior !== "timed" || !period.limitMinutes) {
      throw new Error("This period is not waiting for a flow decision");
    }
    if (
      continuation.kind === "minutes" &&
      (!Number.isInteger(continuation.minutes) ||
        continuation.minutes < 1 ||
        continuation.minutes > FLOW_EXTENSION_MAX_MINUTES)
    ) {
      throw new Error("Flow extension must be between 1 and 15 minutes");
    }
    const usage = await this.analytics.summarize("day", now);
    if ((usage.byPeriod[period.id] ?? 0) < period.limitMinutes * 60) {
      throw new Error("The period allowance has not ended");
    }
    const date = formatLocalDate(now);
    let next = createEntry(date, target.id, period.id);
    await this.repository.update((store) => {
      const key = runtimeKey(date, target.id, period.id);
      const entry = store.entries[key] ?? createEntry(date, target.id, period.id);
      if (entry.flowUsed) throw new Error("The flow continuation has already been used");
      entry.flowUsed = true;
      entry.flowContinuationKind = continuation.kind;
      if (continuation.kind === "minutes") {
        entry.flowExpiresAt = nowMs + continuation.minutes * 60_000;
      } else {
        // Video continuations end only when the content script reports that the
        // selected video ended. They are not a disguised 15-minute extension.
        delete entry.flowExpiresAt;
      }
      store.entries[key] = entry;
      next = { ...entry };
      pruneRuntime(store.entries, now);
    });
    return next;
  }

  async revokeFlow(targetId: string, periodId: string): Promise<PeriodRuntimeEntry> {
    const now = new Date(this.now());
    const date = formatLocalDate(now);
    let next = createEntry(date, targetId, periodId);
    await this.repository.update((store) => {
      const key = runtimeKey(date, targetId, periodId);
      const entry = store.entries[key] ?? createEntry(date, targetId, periodId);
      entry.flowUsed = true;
      entry.flowExpiresAt = this.now();
      delete entry.flowContinuationKind;
      store.entries[key] = entry;
      next = { ...entry };
    });
    return next;
  }
}

function requirePeriod(
  settings: FocusSettings,
  targetId: string,
  periodId: string
): { target: SiteTargetSettings; period: TimePeriodSettings } {
  const target = settings.targets[targetId];
  const period = target?.timePeriods.find((candidate) => candidate.id === periodId);
  if (!target || !period) throw new Error("The configured time period no longer exists");
  return { target, period };
}

function runtimeKey(date: string, targetId: string, periodId: string): string {
  return `${date}|${targetId}|${periodId}`;
}

function createEntry(date: string, targetId: string, periodId: string): PeriodRuntimeEntry {
  return { date, targetId, periodId, unlockedGroups: 1 };
}

function mathChallenge(entry: PeriodRuntimeEntry): { left: number; right: number } {
  let seed = entry.unlockedGroups * 17;
  for (const character of `${entry.date}:${entry.targetId}:${entry.periodId}`) {
    seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  }
  return { left: 10 + (seed % 40), right: 10 + ((seed >>> 6) % 40) };
}

function pruneRuntime(entries: Record<string, PeriodRuntimeEntry>, now: Date): void {
  const cutoff = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - RUNTIME_RETENTION_DAYS
  );
  const cutoffKey = formatLocalDate(cutoff);
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.date < cutoffKey) delete entries[key];
  }
}
