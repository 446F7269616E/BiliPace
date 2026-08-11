import {
  LOCAL_DNR_RESOURCE_TYPES,
  LOCAL_MODULE_CAPABILITIES,
  LOCAL_MODULE_SCHEMA_VERSION,
  type LocalDnrResourceType,
  type LocalDnrRule,
  type LocalModuleCapability,
  type LocalModuleDefinition,
  type LocalModuleDomainPolicy,
  type LocalModuleInstallation,
  type LocalModuleStore
} from "./types";

const LIMITS = Object.freeze({
  modules: 32,
  id: 100,
  name: 80,
  description: 320,
  matches: 32,
  selectors: 128,
  selector: 300,
  css: 100_000,
  script: 150_000,
  dnrRules: 1_000,
  urlFilter: 500
});

const CAPABILITIES = new Set<string>(LOCAL_MODULE_CAPABILITIES);
const RESOURCE_TYPES = new Set<string>(LOCAL_DNR_RESOURCE_TYPES);
const DOMAIN_POLICIES = new Set<LocalModuleDomainPolicy>(["timed", "always-allow", "always-block"]);
const DNR_ACTIONS = new Set(["block", "allow", "upgradeScheme"]);

export function normalizeLocalModuleDefinition(value: unknown): LocalModuleDefinition | null {
  if (!isRecord(value) || value.schemaVersion !== LOCAL_MODULE_SCHEMA_VERSION) return null;
  if (!isStableId(value.id) || !isVersion(value.version) || !isText(value.name, LIMITS.name)) {
    return null;
  }
  const description =
    typeof value.description === "string" ? cleanText(value.description, LIMITS.description) : "";
  const matches = normalizeMatches(value.matches);
  if (matches.length === 0) return null;
  const domainPolicy = DOMAIN_POLICIES.has(value.domainPolicy as LocalModuleDomainPolicy)
    ? (value.domainPolicy as LocalModuleDomainPolicy)
    : "timed";
  const hideSelectors = normalizeSelectors(value.hideSelectors);
  if (hideSelectors === null) return null;
  let css = "";
  if (value.css !== undefined) {
    if (
      typeof value.css !== "string" ||
      value.css.length > LIMITS.css ||
      !isSelfContainedCss(value.css)
    ) {
      return null;
    }
    css = value.css;
  }
  let userScript = "";
  if (value.userScript !== undefined) {
    if (typeof value.userScript !== "string" || value.userScript.length > LIMITS.script) {
      return null;
    }
    userScript = value.userScript;
  }
  const dnrRules = normalizeDnrRules(value.dnrRules);
  if (dnrRules === null) return null;
  const inferred = inferCapabilities({ domainPolicy, hideSelectors, css, dnrRules, userScript });
  const declared = Array.isArray(value.capabilities)
    ? value.capabilities.filter(
        (item): item is LocalModuleCapability => typeof item === "string" && CAPABILITIES.has(item)
      )
    : [];
  const capabilities = [...new Set([...declared, ...inferred])];
  return {
    schemaVersion: LOCAL_MODULE_SCHEMA_VERSION,
    id: value.id,
    name: cleanText(value.name, LIMITS.name),
    version: value.version,
    description,
    matches,
    domainPolicy,
    hideSelectors,
    css,
    dnrRules,
    userScript,
    capabilities
  };
}

export function normalizeLocalModuleStore(value: unknown): LocalModuleStore {
  const store: LocalModuleStore = { schemaVersion: 1, installations: {} };
  if (!isRecord(value) || !isRecord(value.installations)) return store;
  for (const [id, raw] of Object.entries(value.installations).slice(0, LIMITS.modules)) {
    if (!isStableId(id) || !isRecord(raw)) continue;
    const definition = normalizeLocalModuleDefinition(raw.definition);
    if (!definition || definition.id !== id) continue;
    const importedAt = isTimestamp(raw.importedAt) ? raw.importedAt : 0;
    const updatedAt = isTimestamp(raw.updatedAt) ? raw.updatedAt : importedAt;
    const installation: LocalModuleInstallation = {
      definition,
      source: "local-file",
      enabled: raw.enabled === true,
      importedAt,
      updatedAt
    };
    store.installations[id] = installation;
  }
  return store;
}

export function localModuleMatches(
  definition: LocalModuleDefinition,
  input: string | URL
): boolean {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    return false;
  }
  return definition.matches.some((pattern) => pattern === `${url.origin}/*`);
}

export function originsFromLocalModule(definition: LocalModuleDefinition): string[] {
  return definition.matches.map((pattern) => pattern.slice(0, -2));
}

function normalizeMatches(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > LIMITS.matches) return [];
  const matches = value.map(normalizeMatch).filter((item): item is string => item !== null);
  return [...new Set(matches)];
}

function normalizeMatch(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300 || !value.endsWith("/*")) return null;
  let url: URL;
  try {
    url = new URL(value.slice(0, -1));
  } catch {
    return null;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    url.hostname.includes("*") ||
    url.hostname.endsWith(".") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  return `${url.origin}/*`;
}

function normalizeSelectors(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > LIMITS.selectors) return null;
  const selectors: string[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      item.length < 1 ||
      item.length > LIMITS.selector ||
      /[{};]/u.test(item)
    ) {
      return null;
    }
    selectors.push(item);
  }
  return [...new Set(selectors)];
}

function normalizeDnrRules(value: unknown): LocalDnrRule[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > LIMITS.dnrRules) return null;
  const rules: LocalDnrRule[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || !DNR_ACTIONS.has(String(raw.action))) return null;
    if (
      typeof raw.urlFilter !== "string" ||
      raw.urlFilter.length < 1 ||
      raw.urlFilter.length > LIMITS.urlFilter ||
      /[\r\n]/u.test(raw.urlFilter)
    ) {
      return null;
    }
    const resourceTypes = Array.isArray(raw.resourceTypes)
      ? [...new Set(raw.resourceTypes)].filter(
          (item): item is LocalDnrResourceType =>
            typeof item === "string" && RESOURCE_TYPES.has(item)
        )
      : [];
    if (resourceTypes.length === 0 || resourceTypes.length > LOCAL_DNR_RESOURCE_TYPES.length) {
      return null;
    }
    rules.push({
      action: raw.action as LocalDnrRule["action"],
      urlFilter: raw.urlFilter,
      resourceTypes
    });
  }
  return rules;
}

function inferCapabilities(input: {
  domainPolicy: LocalModuleDomainPolicy;
  hideSelectors: string[];
  css: string;
  dnrRules: LocalDnrRule[];
  userScript: string;
}): LocalModuleCapability[] {
  const capabilities: LocalModuleCapability[] = [];
  if (input.domainPolicy !== "timed") capabilities.push("domain-policy");
  if (input.hideSelectors.length > 0) capabilities.push("hide-elements");
  if (input.css.trim()) capabilities.push("css");
  if (input.dnrRules.length > 0) capabilities.push("declarative-net-request");
  if (input.userScript.trim()) capabilities.push("user-script");
  return capabilities;
}

function isSelfContainedCss(value: string): boolean {
  return !/[\\]|@import\b|(?:url|src|image|image-set|-webkit-image-set)\s*\(|javascript:|-moz-binding\s*:|behavior\s*:/iu.test(
    value
  );
}

function isStableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= LIMITS.id &&
    /^[a-z0-9][a-z0-9._:-]+$/u.test(value)
  );
}

function isVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value)
  );
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function cleanText(value: string, maxLength: number): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
    })
    .join("")
    .trim()
    .slice(0, maxLength);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
