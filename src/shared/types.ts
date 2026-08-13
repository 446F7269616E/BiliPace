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

export const RESTRICTION_MODES = ["lenient", "flow", "strict"] as const;
export type RestrictionMode = (typeof RESTRICTION_MODES)[number];

export const TIME_PERIOD_BEHAVIORS = ["timed", "always-allow", "always-block"] as const;
export type TimePeriodBehavior = (typeof TIME_PERIOD_BEHAVIORS)[number];

/** A website target can own multiple independent, local-time allowance periods. */
export interface TimePeriodSettings {
  id: string;
  name: string;
  enabled: boolean;
  days: Weekday[];
  startTime: TimeOfDay;
  endTime: TimeOfDay;
  behavior: TimePeriodBehavior;
  /** Required only for timed periods. */
  limitMinutes: number | null;
  /** The timed allowance is divided evenly into this many sequential groups. */
  groupCount: number;
}

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
  /** @deprecated Compatibility mirror. Website availability is controlled by time periods. */
  enabled: boolean;
  restrictionMode: RestrictionMode;
  /** Optional confirmation gate shown before an otherwise allowed visit. */
  visitConfirmation?: VisitConfirmationSettings;
  targetIds: TargetId[];
  createdAt: number;
  updatedAt: number;
}

export interface VisitConfirmationSettings {
  enabled: boolean;
  /** Independent delay before the user may confirm opening this website. */
  waitSeconds: number;
}

export interface SiteTargetSettings {
  id: TargetId;
  siteId: SiteId;
  label: string;
  /** @deprecated Compatibility mirror. Runtime availability uses each time period's switch. */
  enabled: boolean;
  /** @deprecated Schema-v4 migration mirror. Runtime availability uses timePeriods only. */
  accessPolicy?: "timed" | "always-allow" | "always-block";
  dailyLimitMinutes: number | null;
  schedules: TimeAccessRule[];
  /** Canonical schema v4 configuration. Legacy schedules remain migration mirrors. */
  timePeriods: TimePeriodSettings[];
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
  /** Default copied into newly-created plan items. */
  defaultCompletionMode: PlanCompletionMode;
  autoCompleteOnStart: boolean;
}

export const PLAN_COMPLETION_MODES = ["lenient", "flow", "strict"] as const;
export type PlanCompletionMode = (typeof PLAN_COMPLETION_MODES)[number];

export type UiLocalePreference = "system" | "zh-CN" | "en";
export type EndPageView = "dashboard" | "message" | "minimal";
export type GroupUnlockMethod = "none" | "wait" | "math" | "password";

export interface EndPageSettings {
  view: EndPageView;
  motivationalMessage: string;
  groupUnlock: {
    method: GroupUnlockMethod;
    waitMinutes: number;
    /** SHA-256 verifier; an empty value means that no password has been configured. */
    passwordVerifier: string;
  };
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
  schemaVersion: 4;
  enabled: boolean;
  /** Shows the active website allowance as a per-tab toolbar badge. */
  showRemainingMinutesOnIcon: boolean;
  locale: UiLocalePreference;
  endPage: EndPageSettings;
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
  /** Independent usage totals keyed by stable TimePeriodSettings.id. */
  byPeriod: Record<string, number>;
  /** @deprecated Derived legacy projection; not persisted in schema v2. */
  bySection: Record<SectionId, number>;
}

export interface UsageStore {
  schemaVersion: 3;
  days: Record<string, DailyUsage>;
}

export type UsagePeriod = "day" | "week" | "month";

export interface UsageSummary {
  period: UsagePeriod;
  startDate: string;
  endDate: string;
  totalSeconds: number;
  byTarget: Record<TargetId, number>;
  byPeriod: Record<string, number>;
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

export interface PeriodRuntimeEntry {
  date: string;
  targetId: TargetId;
  periodId: string;
  unlockedGroups: number;
  waitStartedAt?: number;
  /** A flow continuation can be granted only once per period and local day. */
  flowUsed?: boolean;
  /** Present only for bounded minute continuations; video-end has no timer deadline. */
  flowExpiresAt?: number;
  flowContinuationKind?: "minutes" | "video-end";
}

export interface PeriodRuntimeStore {
  schemaVersion: 1;
  entries: Record<string, PeriodRuntimeEntry>;
}

export interface PeriodRuntimeStatus {
  date: string;
  targetId: TargetId;
  periodId: string;
  method: GroupUnlockMethod;
  unlockedGroups: number;
  groupCount: number;
  canUnlock: boolean;
  waitStartedAt?: number;
  waitEndsAt?: number;
  mathChallenge?: { left: number; right: number };
  passwordConfigured?: boolean;
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
  scheduledDurationMinutes: number;
  completionMode: PlanCompletionMode;
  addedAt: number;
  completedAt: number | null;
}

interface PlanItemInputMetadata {
  title?: string;
  source?: PlanItemSource;
}

/** A user-submitted HTTP(S) URL is required for new generic plan items. */
export type PlanItemInput = PlanItemInputMetadata & {
  scheduledDurationMinutes: number;
  completionMode: PlanCompletionMode;
} & ({ url: string; bvid?: string } | { bvid: string; url?: string });

export interface PlanItemPatch extends PlanItemInputMetadata {
  url?: string;
  bvid?: string;
  scheduledDurationMinutes?: number;
  completionMode?: PlanCompletionMode;
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
  /** Number.MAX_SAFE_INTEGER while a video-end continuation awaits explicit STOP. */
  expiresAt: number;
  scheduledDurationMinutes: number;
  completionMode: PlanCompletionMode;
  flowContinuationKind?: "minutes" | "video-end";
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
  itemId?: string;
  url?: string;
  origin?: string;
  /** @deprecated Opaque legacy identity. */
  bvid?: string;
  expiresAt?: number;
  expiredAt?: number;
  completionMode?: PlanCompletionMode;
  flowDecisionRequired?: boolean;
  flowContinuationKind?: "minutes" | "video-end";
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
    | "period-limit"
    | "group-boundary"
    | "flow-extension"
    | "visit-confirmation"
    | "temporary-access"
    | "domain-allow"
    | "domain-block"
    | "blocked";
  activePeriodId?: string;
  restrictionMode?: RestrictionMode;
  groupIndex?: number;
  groupCount?: number;
  groupBoundary?: boolean;
  needsFlowChoice?: boolean;
  needsReminder?: boolean;
  needsVisitConfirmation?: boolean;
  visitConfirmationWaitSeconds?: number;
  flowContinuationKind?: "minutes" | "video-end";
  flowExpiresAt?: number;
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
