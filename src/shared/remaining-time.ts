import type {
  FocusSettings,
  PageDecision,
  SiteTargetSettings,
  TimePeriodSettings,
  UsageSummary
} from "./types";

export interface TargetAllowanceSummary {
  activePeriod: TimePeriodSettings | null;
  usedTodaySeconds: number;
  allowanceUsedSeconds: number;
  limitSeconds: number | null;
  remainingSeconds: number | null;
}

/**
 * Resolves the active allowance from canonical period usage. The deprecated
 * target-level daily limit is deliberately ignored so popup and toolbar badge
 * always match enforcement when a site owns multiple periods.
 */
export function resolveTargetAllowance(
  target: SiteTargetSettings,
  usage: UsageSummary,
  activePeriodId?: string
): TargetAllowanceSummary {
  const activePeriod = activePeriodId
    ? (target.timePeriods.find((period) => period.id === activePeriodId) ?? null)
    : null;
  const usedTodaySeconds = sanitizeSeconds(usage.byTarget[target.id]);
  const allowanceUsedSeconds = activePeriod ? sanitizeSeconds(usage.byPeriod[activePeriod.id]) : 0;
  const limitSeconds =
    activePeriod?.behavior === "timed" && activePeriod.limitMinutes !== null
      ? activePeriod.limitMinutes * 60
      : null;
  return {
    activePeriod,
    usedTodaySeconds,
    allowanceUsedSeconds,
    limitSeconds,
    remainingSeconds:
      limitSeconds === null ? null : Math.max(0, limitSeconds - allowanceUsedSeconds)
  };
}

export function remainingSecondsForDecision(
  target: SiteTargetSettings | undefined,
  usage: UsageSummary,
  decision: PageDecision
): number | null {
  if (!target || decision.targetId !== target.id || !decision.activePeriodId) return null;
  return resolveTargetAllowance(target, usage, decision.activePeriodId).remainingSeconds;
}

export function resolveToolbarBadgeText(
  settings: FocusSettings,
  usage: UsageSummary,
  decision: PageDecision
): string {
  if (!settings.enabled || !settings.showRemainingMinutesOnIcon) return "";
  const target = decision.targetId ? settings.targets[decision.targetId] : undefined;
  return formatRemainingMinutesBadge(remainingSecondsForDecision(target, usage, decision));
}

/** Badge values are capped by the schema's 24-hour maximum and remain at least 1 until exhausted. */
export function formatRemainingMinutesBadge(remainingSeconds: number | null): string {
  if (remainingSeconds === null || !Number.isFinite(remainingSeconds) || remainingSeconds < 0) {
    return "";
  }
  return String(Math.min(1_440, Math.ceil(remainingSeconds / 60)));
}

function sanitizeSeconds(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}
