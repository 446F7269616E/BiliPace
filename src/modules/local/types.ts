export const LOCAL_MODULE_SCHEMA_VERSION = 1 as const;

export const LOCAL_MODULE_CAPABILITIES = [
  "domain-policy",
  "hide-elements",
  "css",
  "declarative-net-request",
  "user-script"
] as const;

export type LocalModuleCapability = (typeof LOCAL_MODULE_CAPABILITIES)[number];
export type LocalModuleDomainPolicy = "timed" | "always-allow" | "always-block";

export const LOCAL_DNR_RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "xmlhttprequest",
  "ping",
  "media",
  "websocket",
  "other"
] as const;

export type LocalDnrResourceType = (typeof LOCAL_DNR_RESOURCE_TYPES)[number];
export type LocalDnrActionType = "block" | "allow" | "upgradeScheme";

/**
 * Store-safe DNR subset. Runtime IDs and initiator domains are owned by the
 * core, so an imported module cannot affect pages outside its declared hosts.
 */
export interface LocalDnrRule {
  action: LocalDnrActionType;
  urlFilter: string;
  resourceTypes: LocalDnrResourceType[];
}

/**
 * A fully self-contained module produced from files explicitly chosen by the
 * user. No field is treated as a URL to fetch executable content from.
 */
export interface LocalModuleDefinition {
  schemaVersion: typeof LOCAL_MODULE_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  description: string;
  /** Exact HTTP(S) origin match patterns. Wildcard hosts are intentionally rejected. */
  matches: string[];
  domainPolicy: LocalModuleDomainPolicy;
  hideSelectors: string[];
  css: string;
  dnrRules: LocalDnrRule[];
  userScript: string;
  capabilities: LocalModuleCapability[];
}

export interface LocalModuleInstallation {
  definition: LocalModuleDefinition;
  source: "local-file";
  enabled: boolean;
  importedAt: number;
  updatedAt: number;
}

export interface LocalModuleStore {
  schemaVersion: 1;
  installations: Record<string, LocalModuleInstallation>;
}

export type LocalModuleRuntimeState =
  "available" | "permission-required" | "unsupported" | "disabled-by-platform";

export type LocalModulePlatform = "chromium" | "firefox" | "safari" | "unknown";

export interface LocalModuleRuntimeStatus {
  userScripts: LocalModuleRuntimeState;
  declarativeNetRequest: "available" | "unsupported";
  warnings: string[];
}

export interface LocalModuleSnapshot {
  store: LocalModuleStore;
  runtime: LocalModuleRuntimeStatus;
}

export interface LocalPageRules {
  css: string;
  hideSelectors: string[];
  moduleIds: string[];
}

export interface LocalModuleFile {
  name: string;
  text: string;
}
