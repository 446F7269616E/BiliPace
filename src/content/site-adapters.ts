import type { ContentRoot, ContentSiteAdapter, SiteModuleRuntime } from "../modules/contracts";

export type { ContentRoot, ContentSiteAdapter } from "../modules/contracts";

/** The host interprets reviewed declarative profiles; it owns no site selectors. */
export function detectSiteAdapters(document: Document): ContentSiteAdapter[];
export function detectSiteAdapters(
  module: SiteModuleRuntime | null,
  document: Document
): ContentSiteAdapter[];
export function detectSiteAdapters(
  moduleOrDocument: SiteModuleRuntime | Document | null,
  maybeDocument?: Document
): ContentSiteAdapter[] {
  const module = maybeDocument ? (moduleOrDocument as SiteModuleRuntime | null) : null;
  const document = maybeDocument ?? (moduleOrDocument as Document);
  return module?.adapters(document) ?? [];
}

export function collectAdapterRoots(
  module: SiteModuleRuntime | null,
  document: Document
): ContentRoot[] {
  return [
    ...new Set(detectSiteAdapters(module, document).flatMap((adapter) => adapter.roots(document)))
  ];
}
