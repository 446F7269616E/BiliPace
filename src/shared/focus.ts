import { AnalyticsService, formatLocalDate } from "./analytics";
import type { FocusSettings } from "./types";
import { shouldBlockSection } from "./schedule";
import { SettingsRepository, TemporaryAccessRepository } from "./storage";
import type { PageDecision, SectionId } from "./types";
import { classifyBilibiliUrl } from "./url";

const ACCESS_HISTORY_DAYS = 35;

export class FocusDecisionService {
  constructor(
    private readonly settingsRepository = new SettingsRepository(),
    private readonly accessRepository = new TemporaryAccessRepository(),
    private readonly analytics = new AnalyticsService()
  ) {}

  async decide(url: string, now = new Date()): Promise<PageDecision> {
    const section = classifyBilibiliUrl(url);
    if (!section) return unmanagedDecision();

    const [settings, access] = await Promise.all([
      this.settingsRepository.get(),
      this.accessRepository.get()
    ]);
    const baseDecision = await this.evaluateBaseDecision(settings, section, now);
    const today = formatLocalDate(now);
    const uses = access.usesByDate[today] ?? 0;
    const usesRemaining = Math.max(0, settings.temporaryAccess.maxUsesPerDay - uses);
    const canRequest =
      baseDecision.blocked && settings.temporaryAccess.enabled && usesRemaining > 0;

    if (!baseDecision.blocked) {
      return {
        section,
        blocked: false,
        reason: baseDecision.reason,
        canRequestTemporaryAccess: false,
        temporaryAccessUsesRemaining: usesRemaining
      };
    }

    const expiresAt = access.expiresAtBySection[section] ?? 0;
    if (expiresAt > now.getTime()) {
      return {
        section,
        blocked: false,
        reason: "temporary-access",
        temporaryAccessExpiresAt: expiresAt,
        canRequestTemporaryAccess: false,
        temporaryAccessUsesRemaining: usesRemaining
      };
    }

    return {
      section,
      blocked: true,
      reason: baseDecision.reason,
      canRequestTemporaryAccess: canRequest,
      temporaryAccessUsesRemaining: usesRemaining
    };
  }

  async grant(url: string, now = new Date()): Promise<PageDecision> {
    const section = classifyBilibiliUrl(url);
    if (!section) return unmanagedDecision();

    const settings = await this.settingsRepository.get();
    const baseDecision = await this.evaluateBaseDecision(settings, section, now);
    if (!baseDecision.blocked || !settings.temporaryAccess.enabled) {
      return this.decide(url, now);
    }

    const today = formatLocalDate(now);
    await this.accessRepository.update((store) => {
      const currentUses = store.usesByDate[today] ?? 0;
      if (currentUses >= settings.temporaryAccess.maxUsesPerDay) return;

      store.usesByDate[today] = currentUses + 1;
      store.expiresAtBySection[section] =
        now.getTime() + settings.temporaryAccess.durationMinutes * 60_000;

      const cutoff = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - ACCESS_HISTORY_DAYS
      );
      const cutoffKey = formatLocalDate(cutoff);
      for (const key of Object.keys(store.usesByDate)) {
        if (key < cutoffKey) delete store.usesByDate[key];
      }
      for (const [storedSection, expiresAt] of Object.entries(store.expiresAtBySection)) {
        if ((expiresAt ?? 0) <= now.getTime() && storedSection !== section) {
          delete store.expiresAtBySection[storedSection as SectionId];
        }
      }
    });

    return this.decide(url, now);
  }

  private async evaluateBaseDecision(
    settings: FocusSettings,
    section: SectionId,
    now: Date
  ): Promise<{
    blocked: boolean;
    reason: "focus-disabled" | "rule-disabled" | "outside-schedule" | "daily-limit" | "blocked";
  }> {
    const scheduleDecision = shouldBlockSection(settings, section, now);
    if (
      scheduleDecision.reason === "focus-disabled" ||
      scheduleDecision.reason === "rule-disabled"
    ) {
      return scheduleDecision;
    }

    const dailyLimitMinutes = settings.sectionRules[section].dailyLimitMinutes;
    // With a quota configured, an empty schedule means "quota only". Without a
    // quota, the established empty-schedule behavior remains an all-day block.
    const hasActiveScheduledBlock =
      scheduleDecision.blocked && settings.sectionRules[section].schedules.length > 0;
    if (hasActiveScheduledBlock) return scheduleDecision;
    if (dailyLimitMinutes === null) return scheduleDecision;
    const usage = await this.analytics.summarize("day", now);
    return usage.bySection[section] >= dailyLimitMinutes * 60
      ? { blocked: true, reason: "daily-limit" }
      : { blocked: false, reason: "outside-schedule" };
  }
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
