import type { SiteModuleRuntime } from "./contracts";

interface RegistryState {
  modules: Map<string, SiteModuleRuntime>;
  listeners: Set<() => void>;
}

const REGISTRY_KEY = "__hourleafSiteModuleRegistryV1__";
const scope = globalThis as typeof globalThis & { [REGISTRY_KEY]?: RegistryState };
const state =
  scope[REGISTRY_KEY] ??
  (scope[REGISTRY_KEY] = { modules: new Map<string, SiteModuleRuntime>(), listeners: new Set() });
const { modules, listeners } = state;

/**
 * Registers only already-reviewed local code. Module metadata alone cannot add
 * an executable runtime and this registry never fetches or evaluates code.
 */
export function registerSiteModule(module: SiteModuleRuntime): () => void {
  const moduleId = module.descriptor.manifest.id;
  const existing = modules.get(moduleId);
  if (existing && existing !== module)
    throw new Error(`Site module already registered: ${moduleId}`);
  if (existing === module) return () => unregisterModule(moduleId, module);
  modules.set(moduleId, module);
  notifyRegistryChanged();
  return () => {
    unregisterModule(moduleId, module);
  };
}

export function resolveSiteModule(url: string | URL): SiteModuleRuntime | null {
  for (const module of modules.values()) {
    if (module.match(url)) return module;
  }
  return null;
}

export function listRegisteredSiteModules(): readonly SiteModuleRuntime[] {
  return [...modules.values()];
}

export function subscribeSiteModuleRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function unregisterModule(moduleId: string, module: SiteModuleRuntime): void {
  if (modules.get(moduleId) !== module) return;
  modules.delete(moduleId);
  notifyRegistryChanged();
}

function notifyRegistryChanged(): void {
  for (const listener of listeners) listener();
}
