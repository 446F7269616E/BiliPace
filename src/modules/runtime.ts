import type { ContentFilterSettings, FocusSettings } from "../shared/types";
import {
  assertValidSiteModuleDescriptor,
  type ContentRoot,
  type ContentSiteAdapter,
  type ModuleContentProfile,
  type ModuleMatch,
  type ModulePlanNavigationAdapter,
  type ModuleRouteDescriptor,
  type SiteModuleDescriptor,
  type SiteModuleRuntime
} from "./contracts";

export function createDeclarativeSiteModule(
  descriptor: SiteModuleDescriptor,
  options: {
    plan?: ModulePlanNavigationAdapter;
    contentSettings?: (settings: FocusSettings) => ContentFilterSettings;
  } = {}
): SiteModuleRuntime {
  assertValidSiteModuleDescriptor(descriptor);
  const labels = new Map(
    descriptor.manifest.sections.map((section) => [section.id, section.label] as const)
  );

  return Object.freeze({
    descriptor,
    ...(options.plan ? { plan: options.plan } : {}),
    match(input: string | URL): ModuleMatch | null {
      const url = parseUrl(input);
      if (!url || url.protocol !== "https:") return null;
      const route = descriptor.routes.find((candidate) => routeMatches(candidate, url));
      if (!route) return null;
      return {
        moduleId: descriptor.manifest.id,
        targetId: route.targetId,
        sectionId: route.sectionId,
        sectionLabel: labels.get(route.sectionId) ?? route.sectionId,
        fallbackUrl: descriptor.fallbackUrl
      };
    },
    adapters(document: Document): ContentSiteAdapter[] {
      return descriptor.contentProfiles
        .map((profile) => profileToAdapter(profile, document))
        .filter((adapter): adapter is ContentSiteAdapter => adapter !== null);
    },
    contentSettings(settings: FocusSettings): ContentFilterSettings {
      return options.contentSettings?.(settings) ?? settings.contentFilters;
    }
  } satisfies SiteModuleRuntime);
}

function routeMatches(route: ModuleRouteDescriptor, url: URL): boolean {
  if (url.hostname.toLowerCase() !== route.match.hostname) return false;
  if (route.match.query) {
    const actualValue = url.searchParams.get(route.match.query.key);
    const expectedValue = route.match.query.value;
    if (
      actualValue === null ||
      (route.match.query.caseInsensitive
        ? actualValue.toLocaleLowerCase() !== expectedValue.toLocaleLowerCase()
        : actualValue !== expectedValue)
    ) {
      return false;
    }
  }
  if (route.match.excludeQueryKeys?.some((key) => url.searchParams.has(key))) return false;
  const path = normalizePath(url.pathname);
  if (!route.match.path) return true;
  return route.match.path.values.some((candidate) =>
    route.match.path?.kind === "exact"
      ? path === normalizePath(candidate)
      : path === normalizePath(candidate) || path.startsWith(`${normalizePath(candidate)}/`)
  );
}

function profileToAdapter(
  profile: ModuleContentProfile,
  document: Document
): ContentSiteAdapter | null {
  const roots = collectRoots(profile, document);
  if (roots.length === 0) return null;
  return {
    id: profile.id,
    roots: (nextDocument) => collectRoots(profile, nextDocument),
    hiddenElementSelectors: profile.hiddenElementSelectors,
    routeScopedFilters: profile.routeScopedFilters,
    videoCardSelectors: profile.videoCardSelectors,
    videoTitleSelectors: profile.videoTitleSelectors,
    searchInputSelectors: profile.searchInputSelectors
  };
}

function collectRoots(profile: ModuleContentProfile, document: Document): ContentRoot[] {
  if (profile.root.kind === "document") return [document];
  const selector = profile.root.hostSelector;
  if (!selector) return [];
  return [...document.querySelectorAll<HTMLElement>(selector)]
    .map((host) => host.shadowRoot)
    .filter((root): root is ShadowRoot => root !== null);
}

function parseUrl(input: string | URL): URL | null {
  try {
    return input instanceof URL ? input : new URL(input);
  } catch {
    return null;
  }
}

function normalizePath(path: string): string {
  if (path === "/") return path;
  return path.replace(/\/+$/u, "");
}
