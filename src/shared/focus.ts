import { AnalyticsService, formatLocalDate } from "./analytics";
import { shouldBlockTarget } from "./schedule";
import { SettingsRepository, TemporaryAccessRepository } from "./storage";
import type {
  FocusSettings,
  PageDecision,
  SectionId,
  SiteId,
  SiteTargetSettings,
  TargetId
} from "./types";

const ACCESS_HISTORY_DAYS = 35;

export interface FocusTarget {
  siteId?: SiteId;
  target: SiteTargetSettings;
  legacySection?: SectionId;
}

export type FocusTargetResolver = (
  url: string,
  requestedTargetId?: TargetId
) => FocusTarget | null | Promise<FocusTarget | null>;

export class FocusDecisionService {
  constructor(
    private readonly settingsRepository = new SettingsRepository(),
    private readonly accessRepository = new TemporaryAccessRepository(),
    private readonly analytics = new AnalyticsService(),
    private readonly targetResolver?: FocusTargetResolver
  ) {}

  async decide(url: string, now = new Date(), requestedTargetId?: TargetId): Promise<PageDecision> {
    const settings = await this.settingsRepository.get();
    const resolved = await this.resolveTarget(settings, url, requestedTargetId);
    if (!resolved) return unmanagedDecision();
    const access = await this.accessRepository.get();
    const baseDecision = await this.evaluateBaseDecision(settings, resolved.target, now);
    const today = formatLocalDate(now);
    const uses =
      access.usesByDateAndTarget[today]?.[resolved.target.id] ??
      (resolved.legacySection ? (access.usesByDate[today] ?? 0) : 0);
    const policy = resolved.target.temporaryAccess;
    const usesRemaining = Math.max(0, policy.maxUsesPerDay - uses);
    const canRequest = baseDecision.blocked && policy.enabled && usesRemaining > 0;
    const identity = decisionIdentity(resolved);

    if (!baseDecision.blocked) {
      return {
        ...identity,
        blocked: false,
        reason: baseDecision.reason,
        canRequestTemporaryAccess: false,
        temporaryAccessUsesRemaining: usesRemaining
      };
    }

    if (baseDecision.reason === "domain-block") {
      return {
        ...identity,
        blocked: true,
        reason: "domain-block",
        canRequestTemporaryAccess: false,
        temporaryAccessUsesRemaining: usesRemaining
      };
    }

    const expiresAt = access.expiresAtByTarget[resolved.target.id] ?? 0;
    if (expiresAt > now.getTime()) {
      return {
        ...identity,
        blocked: false,
        reason: "temporary-access",
        temporaryAccessExpiresAt: expiresAt,
        canRequestTemporaryAccess: false,
        temporaryAccessUsesRemaining: usesRemaining
      };
    }
    return {
      ...identity,
      blocked: true,
      reason: baseDecision.reason,
      canRequestTemporaryAccess: canRequest,
      temporaryAccessUsesRemaining: usesRemaining
    };
  }

  async grant(url: string, now = new Date(), requestedTargetId?: TargetId): Promise<PageDecision> {
    const settings = await this.settingsRepository.get();
    const resolved = await this.resolveTarget(settings, url, requestedTargetId);
    if (!resolved) return unmanagedDecision();
    const baseDecision = await this.evaluateBaseDecision(settings, resolved.target, now);
    const policy = resolved.target.temporaryAccess;
    if (!baseDecision.blocked || baseDecision.reason === "domain-block" || !policy.enabled) {
      return this.decide(url, now, requestedTargetId);
    }

    const today = formatLocalDate(now);
    await this.accessRepository.update((store) => {
      const counts = (store.usesByDateAndTarget[today] ??= {});
      const currentUses = counts[resolved.target.id] ?? 0;
      if (currentUses >= policy.maxUsesPerDay) return;
      counts[resolved.target.id] = currentUses + 1;
      store.expiresAtByTarget[resolved.target.id] = now.getTime() + policy.durationMinutes * 60_000;

      const cutoff = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - ACCESS_HISTORY_DAYS
      );
      const cutoffKey = formatLocalDate(cutoff);
      for (const key of Object.keys(store.usesByDateAndTarget)) {
        if (key < cutoffKey) delete store.usesByDateAndTarget[key];
      }
      for (const [targetId, expiresAt] of Object.entries(store.expiresAtByTarget)) {
        if ((expiresAt ?? 0) <= now.getTime() && targetId !== resolved.target.id) {
          delete store.expiresAtByTarget[targetId];
        }
      }
    });
    return this.decide(url, now, requestedTargetId);
  }

  private async evaluateBaseDecision(
    settings: FocusSettings,
    target: SiteTargetSettings,
    now: Date
  ): Promise<{
    blocked: boolean;
    reason:
      | "focus-disabled"
      | "rule-disabled"
      | "domain-allow"
      | "domain-block"
      | "outside-schedule"
      | "daily-limit"
      | "blocked";
  }> {
    if (!settings.enabled) return { blocked: false, reason: "focus-disabled" };
    if (!target.enabled) return { blocked: false, reason: "rule-disabled" };
    if (target.accessPolicy === "always-allow") {
      return { blocked: false, reason: "domain-allow" };
    }
    if (target.accessPolicy === "always-block") {
      return { blocked: true, reason: "domain-block" };
    }
    const scheduleDecision = shouldBlockTarget(settings.enabled, target, now);
    if (
      scheduleDecision.reason === "focus-disabled" ||
      scheduleDecision.reason === "rule-disabled"
    ) {
      return scheduleDecision;
    }
    if (scheduleDecision.explicit) return scheduleDecision;
    if (target.dailyLimitMinutes === null) return scheduleDecision;
    const usage = await this.analytics.summarize("day", now);
    return (usage.byTarget[target.id] ?? 0) >= target.dailyLimitMinutes * 60
      ? { blocked: true, reason: "daily-limit" }
      : { blocked: false, reason: "outside-schedule" };
  }

  private async resolveTarget(
    settings: FocusSettings,
    url: string,
    requestedTargetId?: TargetId
  ): Promise<FocusTarget | null> {
    if (this.targetResolver) return this.targetResolver(url, requestedTargetId);
    let origin: string;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      origin = parsed.origin;
    } catch {
      return null;
    }
    const site = Object.values(settings.sites).find((candidate) => candidate.origin === origin);
    if (!site || !site.enabled) return null;
    const targetId = requestedTargetId ?? site.targetIds[0];
    const target = targetId ? settings.targets[targetId] : undefined;
    return target && target.siteId === site.id ? { siteId: site.id, target } : null;
  }
}

function decisionIdentity(
  target: FocusTarget
): Pick<PageDecision, "siteId" | "targetId" | "section"> {
  return {
    ...(target.siteId ? { siteId: target.siteId } : {}),
    targetId: target.target.id,
    section: target.legacySection ?? null
  };
}

function unmanagedDecision(): PageDecision {
  return {
    section: null,
    blocked: false,
    reason: "not-managed",
    canRequestTemporaryAccess: false,
    temporaryAccessUsesRemaining: 0
  };
}
