import { RawUsageRepository } from "./storage";
import {
  SECTION_IDS,
  type DailyUsage,
  type SectionId,
  type UsagePeriod,
  type TargetId,
  type UsageSummary
} from "./types";

const RETENTION_DAYS = 400;

export class AnalyticsService {
  constructor(private readonly repository = new RawUsageRepository()) {}

  /** Records an elapsed interval and splits it correctly if it crosses local midnight. */
  async recordInterval(
    targetId: TargetId,
    startMs: number,
    endMs: number,
    periodId?: string
  ): Promise<void> {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;

    await this.repository.update((store) => {
      let cursor = startMs;
      while (cursor < endMs) {
        const cursorDate = new Date(cursor);
        const nextMidnight = new Date(
          cursorDate.getFullYear(),
          cursorDate.getMonth(),
          cursorDate.getDate() + 1
        ).getTime();
        const segmentEnd = Math.min(endMs, nextMidnight);
        const seconds = (segmentEnd - cursor) / 1000;
        const date = formatLocalDate(cursorDate);
        const day = store.days[date] ?? createEmptyDay(date);
        day.byTarget[targetId] = (day.byTarget[targetId] ?? 0) + seconds;
        if (periodId) day.byPeriod[periodId] = (day.byPeriod[periodId] ?? 0) + seconds;
        const legacySection = legacySectionForTarget(targetId);
        if (legacySection) day.bySection[legacySection] += seconds;
        store.days[date] = day;
        cursor = segmentEnd;
      }

      pruneOldDays(store.days, new Date(endMs), RETENTION_DAYS);
    });
  }

  async summarize(period: UsagePeriod, anchor = new Date()): Promise<UsageSummary> {
    const store = await this.repository.get();
    const { start, end } = getPeriodRange(period, anchor);
    const bySection = createEmptySections();
    const byTarget: Record<TargetId, number> = {};
    const byPeriod: Record<string, number> = {};
    const byDay: DailyUsage[] = [];

    for (const date of iterateDates(start, end)) {
      const key = formatLocalDate(date);
      const stored = store.days[key];
      const day = stored
        ? {
            date: key,
            byTarget: Object.fromEntries(
              Object.entries(stored.byTarget).map(([targetId, seconds]) => [
                targetId,
                Math.round(seconds)
              ])
            ),
            byPeriod: Object.fromEntries(
              Object.entries(stored.byPeriod).map(([periodId, seconds]) => [
                periodId,
                Math.round(seconds)
              ])
            ),
            bySection: Object.fromEntries(
              SECTION_IDS.map((section) => [section, Math.round(stored.bySection[section])])
            ) as Record<SectionId, number>
          }
        : createEmptyDay(key);
      byDay.push(day);
      for (const [targetId, seconds] of Object.entries(day.byTarget)) {
        byTarget[targetId] = (byTarget[targetId] ?? 0) + seconds;
      }
      for (const [periodId, seconds] of Object.entries(day.byPeriod)) {
        byPeriod[periodId] = (byPeriod[periodId] ?? 0) + seconds;
      }
      for (const section of SECTION_IDS) bySection[section] += day.bySection[section];
    }

    const totalSeconds = Object.values(byTarget).reduce((total, seconds) => total + seconds, 0);
    return {
      period,
      startDate: formatLocalDate(start),
      endDate: formatLocalDate(end),
      totalSeconds,
      byTarget,
      byPeriod,
      bySection,
      byDay
    };
  }

  async clear(): Promise<void> {
    await this.repository.clear();
  }
}

export function getPeriodRange(period: UsagePeriod, anchor: Date): { start: Date; end: Date } {
  const safeAnchor = Number.isNaN(anchor.getTime()) ? new Date() : anchor;
  let start: Date;
  let end: Date;

  if (period === "week") {
    const mondayOffset = (safeAnchor.getDay() + 6) % 7;
    start = new Date(
      safeAnchor.getFullYear(),
      safeAnchor.getMonth(),
      safeAnchor.getDate() - mondayOffset
    );
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  } else if (period === "month") {
    start = new Date(safeAnchor.getFullYear(), safeAnchor.getMonth(), 1);
    end = new Date(safeAnchor.getFullYear(), safeAnchor.getMonth() + 1, 0);
  } else {
    start = new Date(safeAnchor.getFullYear(), safeAnchor.getMonth(), safeAnchor.getDate());
    end = new Date(start);
  }
  return { start, end };
}

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return formatLocalDate(date) === value ? date : null;
}

export function createEmptyDay(date: string): DailyUsage {
  return { date, byTarget: {}, byPeriod: {}, bySection: createEmptySections() };
}

function createEmptySections(): Record<SectionId, number> {
  return { home: 0, dynamic: 0, popular: 0, video: 0, live: 0, bangumi: 0, search: 0 };
}

function legacySectionForTarget(targetId: TargetId): SectionId | null {
  const direct = SECTION_IDS.find((section) => section === targetId);
  if (direct) return direct;
  return SECTION_IDS.find((section) => targetId === `legacy:bilibili:${section}`) ?? null;
}

function* iterateDates(start: Date, end: Date): Generator<Date> {
  const cursor = new Date(start);
  while (cursor <= end) {
    yield new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
  }
}

function pruneOldDays(days: Record<string, DailyUsage>, now: Date, retentionDays: number): void {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - retentionDays);
  const cutoffKey = formatLocalDate(cutoff);
  for (const key of Object.keys(days)) {
    if (key < cutoffKey) delete days[key];
  }
}
