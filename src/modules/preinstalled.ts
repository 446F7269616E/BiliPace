import type { SiteModuleManifest } from "../shared/types";
import { BILIBILI_SITE_MODULE_MANIFEST } from "./bilibili/metadata";

export interface PreinstalledSiteModuleDefinition {
  manifest: SiteModuleManifest;
  /** Local package file registered only while the module is enabled. */
  contentScript: string;
}

/**
 * Metadata-only catalog for code reviewed and shipped inside Hourleaf.
 * Adding a module here never grants its website permissions or enables it.
 */
export const PREINSTALLED_SITE_MODULES = Object.freeze([
  {
    manifest: BILIBILI_SITE_MODULE_MANIFEST,
    contentScript: "modules/bilibili.js"
  }
]) satisfies readonly PreinstalledSiteModuleDefinition[];

export const PREINSTALLED_SITE_MODULE_MANIFESTS = Object.freeze(
  PREINSTALLED_SITE_MODULES.map(({ manifest }) => manifest)
) satisfies readonly SiteModuleManifest[];

export function findPreinstalledSiteModule(moduleId: string): SiteModuleManifest | null {
  return PREINSTALLED_SITE_MODULE_MANIFESTS.find((manifest) => manifest.id === moduleId) ?? null;
}
