import { AnalyticsService, formatLocalDate } from "./analytics";
import { evaluateTimePeriods } from "./schedule";
import { PeriodRuntimeService } from "./period-runtime";
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
    private readonly targetResolver?: FocusTargetResolver,
    private readonly periodRuntime = new PeriodRuntimeService(
      settingsRepository,
      undefined,
      analytics
    )
  ) {}

  async decide(url: string, now = new Date(), requestedTargetId?: TargetId): Promise<PageDecision> {
    const settings = await this.settingsRepository.get();
    const resolved = await this.resolveTarget(settings, url, requestedTargetId);
    if (!resolved) return unmanagedDecision();
    const access = await this.accessRepository.get();
    const baseDecision = await this.evaluateBaseDecision(settings, resolved, now);
    const today = formatLocalDate(now);
    const uses =
      access.usesByDateAndTarget[today]?.[resolved.target.id] ??
      (resolved.legacySection ? (access.usesByDate[today] ?? 0) : 0);
    const policy = resolved.target.temporaryAccess;
    const usesRemaining = Math.max(0, policy.maxUsesPerDay - uses);
    // Canonical time-period decisions are final. Temporary access remains only
    // as a dormant migration capability for the legacy daily-limit reason and
    // must never bypass always-block, period limits, or group boundaries.
    const temporaryAccessEligible = baseDecision.reason === "daily-limit";
    const canRequest =
      baseDecision.blocked && temporaryAccessEligible && policy.enabled && usesRemaining > 0;
    const identity = decisionIdentity(resolved);

    if (!baseDecision.blocked) {
      return {
        ...identity,
        ...baseDecision.details,
        blocked: false,
        reason: baseDecision.reason,
        canRequestTemporaryAccess: false,
        temporaryAccessUsesRemaining: usesRemaining
      };
    }

    if (baseDecision.reason === "domain-block") {
      return {
        ...identity,
        ...baseDecision.details,
        blocked: true,
        reason: "domain-block",
        canRequestTemporaryAccess: false,
        temporaryAccessUsesRemaining: usesRemaining
      };
    }

    const expiresAt = access.expiresAtByTarget[resolved.target.id] ?? 0;
    if (temporaryAccessEligible && expiresAt > now.getTime()) {
      return {
        ...identity,
        ...baseDecision.details,
        blocked: false,
        reason: "temporary-access",
        temporaryAccessExpiresAt: expiresAt,
        canRequestTemporaryAccess: false,
        temporaryAccessUsesRemaining: usesRemaining
      };
    }
    return {
      ...identity,
      ...baseDecision.details,
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
    const baseDecision = await this.evaluateBaseDecision(settings, resolved, now);
    const policy = resolved.target.temporaryAccess;
    if (baseDecision.reason !== "daily-limit" || !baseDecision.blocked || !policy.enabled) {
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
    resolved: FocusTarget,
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
      | "period-limit"
      | "group-boundary"
      | "flow-extension"
      | "blocked";
    details?: Pick<
      PageDecision,
      | "activePeriodId"
      | "restrictionMode"
      | "groupIndex"
      | "groupCount"
      | "groupBoundary"
      | "needsFlowChoice"
      | "needsReminder"
      | "flowContinuationKind"
      | "flowExpiresAt"
    >;
  }> {
    const target = resolved.target;
    if (!settings.enabled) return { blocked: false, reason: "focus-disabled" };
    const usage = await this.analytics.summarize("day", now);
    const site = resolved.siteId ? settings.sites[resolved.siteId] : undefined;
    const restrictionMode = site?.restrictionMode ?? "strict";
    const preliminaryDecision = evaluateTimePeriods(
      settings.enabled,
      target,
      now,
      usage.byPeriod,
      1,
      false
    );
    const runtimeEntry = preliminaryDecision.activePeriod
      ? await this.periodRuntime.getEntry(target.id, preliminaryDecision.activePeriod.id, now)
      : undefined;
    const activeFlow =
      runtimeEntry?.flowContinuationKind === "video-end" ||
      (runtimeEntry?.flowContinuationKind === "minutes" &&
        runtimeEntry.flowExpiresAt !== undefined &&
        runtimeEntry.flowExpiresAt > now.getTime());
    if (runtimeEntry && activeFlow) {
      return {
        blocked: false,
        reason: "flow-extension",
        details: {
          activePeriodId: runtimeEntry.periodId,
          restrictionMode,
          flowContinuationKind: runtimeEntry.flowContinuationKind,
          ...(runtimeEntry.flowExpiresAt !== undefined
            ? { flowExpiresAt: runtimeEntry.flowExpiresAt }
            : {})
        }
      };
    }
    const periodDecision = evaluateTimePeriods(
      settings.enabled,
      target,
      now,
      usage.byPeriod,
      runtimeEntry?.unlockedGroups ?? 1,
      settings.endPage.groupUnlock.method !== "none"
    );
    const details: Pick<
      PageDecision,
      | "activePeriodId"
      | "restrictionMode"
      | "groupIndex"
      | "groupCount"
      | "groupBoundary"
      | "needsFlowChoice"
      | "needsReminder"
      | "flowContinuationKind"
      | "flowExpiresAt"
    > = {
      ...(periodDecision.activePeriod ? { activePeriodId: periodDecision.activePeriod.id } : {}),
      restrictionMode,
      ...(periodDecision.groupIndex !== undefined ? { groupIndex: periodDecision.groupIndex } : {}),
      ...(periodDecision.groupCount !== undefined ? { groupCount: periodDecision.groupCount } : {}),
      ...(periodDecision.groupBoundary ? { groupBoundary: true } : {})
    };
    if (periodDecision.reason === "period-limit") {
      if (restrictionMode === "lenient") {
        return {
          blocked: false,
          reason: "period-limit",
          details: { ...details, needsReminder: true }
        };
      }
      return {
        blocked: true,
        reason: "period-limit",
        details: {
          ...details,
          ...(restrictionMode === "flow" && runtimeEntry?.flowUsed !== true
            ? { needsFlowChoice: true }
            : {})
        }
      };
    }
    return { blocked: periodDecision.blocked, reason: periodDecision.reason, details };
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
    if (!site) return null;
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
