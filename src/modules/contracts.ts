import type {
  ContentFilterSettings,
  FocusSettings,
  SiteModuleManifest,
  TargetId
} from "../shared/types";

export type { SiteModuleManifest } from "../shared/types";

export const SITE_MODULE_DEFINITION_SCHEMA_VERSION = 1 as const;

export type ContentRoot = Document | ShadowRoot;

export interface ModuleRouteConstraint {
  /** Exact, lowercase hostname. Wildcards and regular expressions are rejected. */
  hostname: string;
  path?: { kind: "exact" | "prefix"; values: readonly string[] };
  query?: { key: string; value: string; caseInsensitive?: boolean };
  /** Prevents a broader fallback route from accepting an unknown module view. */
  excludeQueryKeys?: readonly string[];
}

export interface ModuleRouteDescriptor {
  targetId: TargetId;
  sectionId: string;
  match: ModuleRouteConstraint;
}

export interface ModuleContentRootDescriptor {
  id: string;
  kind: "document" | "open-shadow";
  /** Used only for an open shadow root and evaluated in the top-level document. */
  hostSelector?: string;
}

export interface ModuleContentProfile {
  id: string;
  root: ModuleContentRootDescriptor;
  hiddenElementSelectors: Readonly<Record<string, readonly string[]>>;
  routeScopedFilters: Readonly<Record<string, readonly string[]>>;
  videoCardSelectors: readonly string[];
  videoTitleSelectors: readonly string[];
  searchInputSelectors: readonly string[];
}

export interface ModuleLifecycleDescriptor {
  target: "document" | "window";
  event: string;
}

export interface SiteModuleDescriptor {
  schemaVersion: typeof SITE_MODULE_DEFINITION_SCHEMA_VERSION;
  manifest: SiteModuleManifest;
  /** A safe page used only when history has no previous entry. */
  fallbackUrl: string;
  routes: readonly ModuleRouteDescriptor[];
  contentProfiles: readonly ModuleContentProfile[];
  lifecycle: readonly ModuleLifecycleDescriptor[];
  distribution: {
    artifactName: string;
    /** Executable code is reviewed and packaged separately; it is never fetched by this runtime. */
    execution: "bundled-reviewed";
  };
}

export interface ModuleMatch {
  moduleId: string;
  targetId: TargetId;
  sectionId: string;
  sectionLabel: string;
  fallbackUrl: string;
}

export interface ContentSiteAdapter {
  id: string;
  roots(document: Document): ContentRoot[];
  hiddenElementSelectors: Readonly<Record<string, readonly string[]>>;
  routeScopedFilters: Readonly<Record<string, readonly string[]>>;
  videoCardSelectors: readonly string[];
  videoTitleSelectors: readonly string[];
  searchInputSelectors: readonly string[];
}

export interface ModulePlanNavigationAdapter {
  createNavigationRequest(url: string): {
    type: "GET_PLAN_NAVIGATION_DECISION";
    url: string;
    bvid?: string;
  };
}

export interface SiteModuleRuntime {
  readonly descriptor: SiteModuleDescriptor;
  readonly plan?: ModulePlanNavigationAdapter;
  match(url: string | URL): ModuleMatch | null;
  adapters(document: Document): ContentSiteAdapter[];
  contentSettings(settings: FocusSettings): ContentFilterSettings;
}

const LIMITS = Object.freeze({
  id: 100,
  label: 80,
  version: 32,
  hosts: 32,
  sections: 64,
  routes: 128,
  profiles: 16,
  selectorsPerField: 64,
  selector: 240,
  lifecycle: 16,
  artifactName: 120
});

/**
 * Produces deterministic JSON for release hashing/signing. Object keys are
 * sorted recursively and arrays keep their reviewed declaration order.
 */
export function createSiteModuleHashInput(descriptor: SiteModuleDescriptor): string {
  assertValidSiteModuleDescriptor(descriptor);
  return stableStringify(descriptor);
}

export function assertValidSiteModuleDescriptor(descriptor: SiteModuleDescriptor): void {
  if (descriptor.schemaVersion !== SITE_MODULE_DEFINITION_SCHEMA_VERSION) invalid("schemaVersion");
  assertStableId(descriptor.manifest.id, "manifest.id");
  assertText(descriptor.manifest.version, LIMITS.version, "manifest.version");
  assertText(descriptor.manifest.name, LIMITS.label, "manifest.name");
  assertBoundedArray(descriptor.manifest.hosts, LIMITS.hosts, "manifest.hosts");
  for (const pattern of descriptor.manifest.hosts) assertHttpsMatchPattern(pattern);
  assertBoundedArray(descriptor.manifest.sections, LIMITS.sections, "manifest.sections");
  for (const section of descriptor.manifest.sections) {
    assertStableId(section.id, "section.id");
    assertText(section.label, LIMITS.label, "section.label");
    const targetId = (section as { targetId?: unknown }).targetId;
    if (targetId !== undefined) assertStableId(targetId, "section.targetId");
    if (section.hosts) {
      assertBoundedArray(section.hosts, LIMITS.hosts, "section.hosts");
      for (const host of section.hosts) {
        assertHttpsMatchPattern(host);
        if (!descriptor.manifest.hosts.includes(host)) invalid("section.hosts");
      }
    }
  }
  assertBoundedArray(descriptor.manifest.capabilities, 16, "manifest.capabilities");

  const fallback = parseHttpsUrl(descriptor.fallbackUrl, "fallbackUrl");
  if (!descriptor.manifest.hosts.some((pattern) => matchesManifestPattern(fallback, pattern))) {
    invalid("fallbackUrl host");
  }

  assertBoundedArray(descriptor.routes, LIMITS.routes, "routes");
  const sectionIds = new Set(descriptor.manifest.sections.map((section) => section.id));
  const targetIdBySection = new Map(
    descriptor.manifest.sections.flatMap((section) => {
      const targetId = (section as { targetId?: unknown }).targetId;
      return typeof targetId === "string" ? [[section.id, targetId] as const] : [];
    })
  );
  for (const route of descriptor.routes) {
    assertStableId(route.targetId, "route.targetId");
    if (!sectionIds.has(route.sectionId)) invalid("route.sectionId");
    const declaredTargetId = targetIdBySection.get(route.sectionId);
    if (declaredTargetId && declaredTargetId !== route.targetId) invalid("route.targetId");
    assertHostname(route.match.hostname);
    if (route.match.path) {
      assertBoundedArray(route.match.path.values, 64, "route.path.values");
      for (const value of route.match.path.values) assertPath(value);
    }
    if (route.match.query) {
      assertStableId(route.match.query.key, "route.query.key");
      assertText(route.match.query.value, LIMITS.label, "route.query.value");
      if (
        route.match.query.caseInsensitive !== undefined &&
        route.match.query.caseInsensitive !== true
      ) {
        invalid("route.query.caseInsensitive");
      }
    }
    if (route.match.excludeQueryKeys) {
      assertBoundedArray(route.match.excludeQueryKeys, 16, "route.excludeQueryKeys");
      for (const key of route.match.excludeQueryKeys) assertStableId(key, "route.excludeQueryKeys");
    }
  }

  assertBoundedArray(descriptor.contentProfiles, LIMITS.profiles, "contentProfiles");
  for (const profile of descriptor.contentProfiles) {
    assertStableId(profile.id, "profile.id");
    assertStableId(profile.root.id, "profile.root.id");
    if (profile.root.kind === "open-shadow") {
      assertSelector(profile.root.hostSelector, "profile.root.hostSelector");
    } else if (profile.root.hostSelector !== undefined) {
      invalid("document root selector");
    }
    assertSelectorRecord(profile.hiddenElementSelectors, "hiddenElementSelectors");
    for (const [filterId, sectionIdsForFilter] of Object.entries(profile.routeScopedFilters)) {
      assertStableId(filterId, "routeScopedFilters key");
      assertBoundedArray(sectionIdsForFilter, LIMITS.sections, "routeScopedFilters value");
      if (sectionIdsForFilter.some((sectionId) => !sectionIds.has(sectionId))) {
        invalid("routeScopedFilters section");
      }
    }
    assertSelectors(profile.videoCardSelectors, "videoCardSelectors");
    assertSelectors(profile.videoTitleSelectors, "videoTitleSelectors");
    assertSelectors(profile.searchInputSelectors, "searchInputSelectors");
  }

  assertBoundedArray(descriptor.lifecycle, LIMITS.lifecycle, "lifecycle");
  for (const lifecycle of descriptor.lifecycle) {
    if (lifecycle.target !== "document" && lifecycle.target !== "window")
      invalid("lifecycle target");
    assertText(lifecycle.event, LIMITS.id, "lifecycle.event");
    if (!/^[A-Za-z][A-Za-z0-9:._-]*$/u.test(lifecycle.event)) invalid("lifecycle.event");
  }
  assertText(descriptor.distribution.artifactName, LIMITS.artifactName, "artifactName");
  if (descriptor.distribution.execution !== "bundled-reviewed") invalid("distribution.execution");
}

function assertSelectorRecord(
  value: Readonly<Record<string, readonly string[]>>,
  field: string
): void {
  const entries = Object.entries(value);
  assertBoundedArray(entries, 64, field);
  for (const [id, selectors] of entries) {
    assertStableId(id, `${field} key`);
    assertSelectors(selectors, field);
  }
}

function assertSelectors(values: readonly string[], field: string): void {
  assertBoundedArray(values, LIMITS.selectorsPerField, field);
  for (const selector of values) assertSelector(selector, field);
}

function assertSelector(value: unknown, field: string): asserts value is string {
  assertText(value, LIMITS.selector, field);
  if (/[{};]/u.test(value)) invalid(field);
}

function assertHttpsMatchPattern(value: string): void {
  if (!/^https:\/\/(?:\*\.)?[a-z0-9.-]+\/\*$/u.test(value)) invalid("host pattern");
  const host = value.slice("https://".length, -2).replace(/^\*\./u, "");
  assertHostname(host);
}

function matchesManifestPattern(url: URL, pattern: string): boolean {
  const hostPattern = pattern.slice("https://".length, -2).toLowerCase();
  if (hostPattern.startsWith("*.")) {
    const suffix = hostPattern.slice(2);
    return url.hostname === suffix || url.hostname.endsWith(`.${suffix}`);
  }
  return url.hostname === hostPattern;
}

function parseHttpsUrl(value: string, field: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) invalid(field);
    return url;
  } catch {
    throw new Error(`Invalid site module descriptor field: ${field}`);
  }
}

function assertHostname(value: string): void {
  if (value.length > 253 || !/^[a-z0-9.-]+$/u.test(value) || value.includes("..")) {
    invalid("hostname");
  }
}

function assertPath(value: string): void {
  if (!value.startsWith("/") || value.length > 240 || /[?#]/u.test(value)) invalid("path");
}

function assertStableId(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > LIMITS.id ||
    !/^[a-z0-9._:-]+$/u.test(value)
  ) {
    invalid(field);
  }
}

function assertText(value: unknown, maxLength: number, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    invalid(field);
  }
}

function assertBoundedArray<T>(value: readonly T[], maxLength: number, field: string): void {
  if (!Array.isArray(value) || value.length > maxLength) invalid(field);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function invalid(field: string): never {
  throw new Error(`Invalid site module descriptor field: ${field}`);
}
