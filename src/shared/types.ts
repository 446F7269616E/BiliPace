export const SECTION_IDS = [
  "home",
  "dynamic",
  "popular",
  "video",
  "live",
  "bangumi",
  "search"
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_LABELS: Readonly<Record<SectionId, string>> = {
  home: "首页",
  dynamic: "动态",
  popular: "热门",
  video: "视频",
  live: "直播",
  bangumi: "番剧影视",
  search: "搜索"
};

/** JavaScript weekday: Sunday = 0, Monday = 1, ... Saturday = 6. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 24-hour local time in HH:mm format. */
export type TimeOfDay = string;

export const TIME_ACCESS_EFFECTS = ["allow", "block"] as const;
export type TimeAccessEffect = (typeof TIME_ACCESS_EFFECTS)[number];

export interface TimeAccessRule {
  id: string;
  name: string;
  enabled: boolean;
  /** A matching allow rule is an explicit exception to matching block rules. */
  effect: TimeAccessEffect;
  days: Weekday[];
  startTime: TimeOfDay;
  endTime: TimeOfDay;
}

export interface SectionRule {
  enabled: boolean;
  /** null disables the quota; otherwise block after this many minutes today. */
  dailyLimitMinutes: number | null;
  /** No schedules means all-day block, or quota-only when a daily limit is set. */
  schedules: TimeAccessRule[];
}

export interface TemporaryAccessSettings {
  enabled: boolean;
  durationMinutes: number;
  maxUsesPerDay: number;
}

export interface PlanModeSettings {
  enabled: boolean;
  /** Minutes granted after explicitly starting the current planned video. */
  watchDurationMinutes: number;
}

export const CONTENT_FILTER_IDS = [
  "home-feed",
  "dynamic-feed",
  "related-videos",
  "comments",
  "search-suggestions",
  "ads",
  "top-navigation"
] as const;

export type ContentFilterId = (typeof CONTENT_FILTER_IDS)[number];

export interface VideoCardFilterSettings {
  enabled: boolean;
  /** Case-insensitive plain-text matches. Persisted values are trimmed and bounded. */
  keywords: string[];
  /** User-authored patterns accepted only after a conservative safety check. */
  regexPatterns: string[];
}

export interface ContentFilterSettings {
  enabled: boolean;
  hiddenElements: Record<ContentFilterId, boolean>;
  videoCards: VideoCardFilterSettings;
  slashToSearch: boolean;
}

export interface FocusSettings {
  schemaVersion: 2;
  enabled: boolean;
  sectionRules: Record<SectionId, SectionRule>;
  temporaryAccess: TemporaryAccessSettings;
  planMode: PlanModeSettings;
  contentFilters: ContentFilterSettings;
}

export type DeepPartial<T> = T extends readonly (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export interface DailyUsage {
  date: string;
  bySection: Record<SectionId, number>;
}

export interface UsageStore {
  schemaVersion: 1;
  days: Record<string, DailyUsage>;
}

export type UsagePeriod = "day" | "week" | "month";

export interface UsageSummary {
  period: UsagePeriod;
  startDate: string;
  endDate: string;
  totalSeconds: number;
  bySection: Record<SectionId, number>;
  byDay: DailyUsage[];
}

export interface TemporaryAccessStore {
  schemaVersion: 1;
  expiresAtBySection: Partial<Record<SectionId, number>>;
  usesByDate: Record<string, number>;
}

export const PLAN_ITEM_SOURCES = ["manual", "watch-later", "favorite"] as const;
export type PlanItemSource = (typeof PLAN_ITEM_SOURCES)[number];
export type PlanItemStatus = "pending" | "completed";

export interface PlanItem {
  /** Extension-generated stable identifier. */
  id: string;
  /** Canonical, case-sensitive Bilibili video identity. */
  bvid: string;
  /** Canonical URL derived from bvid; arbitrary URLs are never persisted. */
  url: string;
  title: string;
  status: PlanItemStatus;
  order: number;
  source: PlanItemSource;
  addedAt: number;
  completedAt: number | null;
}

interface PlanItemInputMetadata {
  title?: string;
  source?: PlanItemSource;
}

/** At least one validated video identity is required when creating/importing. */
export type PlanItemInput = PlanItemInputMetadata &
  ({ bvid: string; url?: string } | { url: string; bvid?: string });

export interface PlanItemPatch extends PlanItemInputMetadata {
  url?: string;
  bvid?: string;
}

export interface PlanQueueStore {
  schemaVersion: 1;
  items: PlanItem[];
}

export interface PlanWatchGrant {
  itemId: string;
  bvid: string;
  grantedAt: number;
  expiresAt: number;
}

export interface PlanAccessStore {
  schemaVersion: 1;
  activeGrant?: PlanWatchGrant;
}

export interface PlanState {
  settings: PlanModeSettings;
  queue: PlanQueueStore;
  activeGrant?: PlanWatchGrant;
}

export interface PlanNavigationDecision {
  planModeEnabled: boolean;
  allowed: boolean;
  reason: "disabled" | "authorized" | "not-authorized" | "expired" | "not-video";
  bvid?: string;
  expiresAt?: number;
}

export interface PageDecision {
  section: SectionId | null;
  blocked: boolean;
  reason:
    | "not-managed"
    | "focus-disabled"
    | "rule-disabled"
    | "outside-schedule"
    | "daily-limit"
    | "temporary-access"
    | "blocked";
  temporaryAccessExpiresAt?: number;
  canRequestTemporaryAccess: boolean;
  temporaryAccessUsesRemaining: number;
}

export interface TrackingStatus {
  section: SectionId | null;
  isTracking: boolean;
  idleState: "active" | "idle" | "locked" | "unsupported";
  windowFocused: boolean;
}
