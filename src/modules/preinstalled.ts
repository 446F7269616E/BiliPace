import type { SiteModuleManifest } from "../shared/types";

export interface PreinstalledSiteModuleDefinition {
  manifest: SiteModuleManifest;
  /** Local package file registered only while the module is enabled. */
  contentScript: string;
}

/**
 * Metadata-only catalog for code reviewed and shipped inside Hourleaf.
 * Adding a module here never grants its website permissions or enables it.
 */
/**
 * Store builds deliberately contain no site-specific executable modules.
 * Optional examples live in the GitHub catalog and can only enter the runtime
 * after the user downloads and imports local files.
 */
export const PREINSTALLED_SITE_MODULES: readonly PreinstalledSiteModuleDefinition[] = Object.freeze(
  []
);

export const PREINSTALLED_SITE_MODULE_MANIFESTS = Object.freeze(
  PREINSTALLED_SITE_MODULES.map(({ manifest }) => manifest)
) satisfies readonly SiteModuleManifest[];

export function findPreinstalledSiteModule(moduleId: string): SiteModuleManifest | null {
  return PREINSTALLED_SITE_MODULE_MANIFESTS.find((manifest) => manifest.id === moduleId) ?? null;
}
