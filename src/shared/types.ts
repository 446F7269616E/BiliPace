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

/** Stable opaque identifiers. They must never contain a visited URL path. */
export type SiteId = string;
export type TargetId = string;
export type SiteModuleId = string;

export const SITE_MODULE_CAPABILITIES = [
  "classify",
  "content-filter",
  "plan",
  "usage-tracking"
] as const;
export type SiteModuleCapability = (typeof SITE_MODULE_CAPABILITIES)[number];

export interface SiteModuleSection {
  id: string;
  label: string;
  targetId?: TargetId;
  /** Optional subset of manifest hosts where this section can occur. */
  hosts?: string[];
}

/**
 * Declarative metadata only. Installing this record never downloads or executes
 * code; executable modules must be reviewed and shipped inside the browser
 * store package.
 */
export interface SiteModuleManifest {
  id: SiteModuleId;
  version: string;
  name: string;
  hosts: string[];
  sections: SiteModuleSection[];
  capabilities: SiteModuleCapability[];
}

export type SiteModuleSource = "bundled";

export interface SiteModuleInstallation {
  manifest: SiteModuleManifest;
  source: SiteModuleSource;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
}

export interface SiteModuleStore {
  schemaVersion: 2;
  installations: Record<SiteModuleId, SiteModuleInstallation>;
  /** A tombstone prevents a user-deleted preinstalled module from reappearing. */
  removedModuleIds: SiteModuleId[];
}

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

export interface ManagedSite {
  id: SiteId;
  /** URL origin only, for example https://example.com. Paths are discarded. */
  origin: string;
  hostname: string;
  label: string;
  enabled: boolean;
  targetIds: TargetId[];
  createdAt: number;
  updatedAt: number;
}

export interface SiteTargetSettings {
  id: TargetId;
  siteId: SiteId;
  label: string;
  enabled: boolean;
  /** Direct domain list behavior; omitted legacy values are treated as timed. */
  accessPolicy?: "timed" | "always-allow" | "always-block";
  dailyLimitMinutes: number | null;
  schedules: TimeAccessRule[];
  temporaryAccess: TemporaryAccessSettings;
  moduleId?: SiteModuleId;
  moduleSectionId?: string;
  /** Runtime descriptor target mapped to this site's private settings target. */
  moduleTargetId?: TargetId;
  moduleEnabled?: boolean;
}

export interface TemporaryAccessSettings {
  enabled: boolean;
  durationMinutes: number;
  maxUsesPerDay: number;
}

export interface PlanModeSettings {
  enabled: boolean;
  /** Minutes granted after explicitly starting the current planned page. */
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

export interface LegacyBilibiliCapsule {
  schemaVersion: 2;
  sectionRules: Record<SectionId, SectionRule>;
  planMode: PlanModeSettings;
  contentFilters: ContentFilterSettings;
}

export interface LegacySettingsCapsules {
  /** Preserved for the optional Bilibili module; ignored by the generic core. */
  bilibili?: LegacyBilibiliCapsule;
}

export interface FocusSettings {
  schemaVersion: 3;
  enabled: boolean;
  sites: Record<SiteId, ManagedSite>;
  targets: Record<TargetId, SiteTargetSettings>;
  legacyCapsules: LegacySettingsCapsules;
  /** @deprecated Compatibility mirror for the optional Bilibili module/UI. */
  sectionRules: Record<SectionId, SectionRule>;
  /** @deprecated New targets carry their own temporary access policy. */
  temporaryAccess: TemporaryAccessSettings;
  /** @deprecated Owned by the optional Bilibili module. */
  planMode: PlanModeSettings;
  /** @deprecated Owned by the optional Bilibili module. */
  contentFilters: ContentFilterSettings;
}

export type DeepPartial<T> = T extends readonly (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export interface DailyUsage {
  date: string;
  byTarget: Record<TargetId, number>;
  /** @deprecated Derived legacy projection; not persisted in schema v2. */
  bySection: Record<SectionId, number>;
}

export interface UsageStore {
  schemaVersion: 2;
  days: Record<string, DailyUsage>;
}

export type UsagePeriod = "day" | "week" | "month";

export interface UsageSummary {
  period: UsagePeriod;
  startDate: string;
  endDate: string;
  totalSeconds: number;
  byTarget: Record<TargetId, number>;
  /** @deprecated Derived legacy projection for old UI builds. */
  bySection: Record<SectionId, number>;
  byDay: DailyUsage[];
}

export interface TemporaryAccessStore {
  schemaVersion: 2;
  expiresAtByTarget: Partial<Record<TargetId, number>>;
  usesByDateAndTarget: Record<string, Partial<Record<TargetId, number>>>;
  /** @deprecated Read-only migration mirrors. */
  expiresAtBySection: Partial<Record<SectionId, number>>;
  /** @deprecated Global legacy counters, retained without adding new writes. */
  usesByDate: Record<string, number>;
}

export const PLAN_ITEM_SOURCES = ["manual", "watch-later", "favorite"] as const;
export type PlanItemSource = (typeof PLAN_ITEM_SOURCES)[number];
export type PlanItemStatus = "pending" | "completed";

export interface PlanItem {
  /** Extension-generated stable identifier. */
  id: string;
  /** @deprecated Opaque legacy identity retained for migrated Bilibili queues. */
  bvid?: string;
  /** User-submitted canonical HTTP(S) URL. */
  url: string;
  origin: string;
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

/** A user-submitted HTTP(S) URL is required for new generic plan items. */
export type PlanItemInput = PlanItemInputMetadata &
  ({ url: string; bvid?: string } | { bvid: string; url?: string });

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
  url: string;
  origin: string;
  /** @deprecated Opaque legacy identity. */
  bvid?: string;
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
  url?: string;
  origin?: string;
  /** @deprecated Opaque legacy identity. */
  bvid?: string;
  expiresAt?: number;
}

export interface PageDecision {
  siteId?: SiteId;
  targetId?: TargetId;
  /** @deprecated Present only for legacy Bilibili targets. */
  section: SectionId | null;
  blocked: boolean;
  reason:
    | "not-managed"
    | "focus-disabled"
    | "rule-disabled"
    | "outside-schedule"
    | "daily-limit"
    | "temporary-access"
    | "domain-allow"
    | "domain-block"
    | "blocked";
  temporaryAccessExpiresAt?: number;
  canRequestTemporaryAccess: boolean;
  temporaryAccessUsesRemaining: number;
}

export interface TrackingStatus {
  siteId?: SiteId;
  targetId?: TargetId;
  /** @deprecated Present only for legacy Bilibili targets. */
  section: SectionId | null;
  isTracking: boolean;
  idleState: "active" | "idle" | "locked" | "unsupported";
  windowFocused: boolean;
}
