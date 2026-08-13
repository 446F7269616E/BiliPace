import {
  permissionsContains,
  permissionsRemove,
  scriptingGetRegisteredContentScripts,
  scriptingRegisterContentScript,
  scriptingUnregisterContentScripts
} from "../shared/browser";
import { createDefaultTimePeriod, isStableId } from "../shared/config";
import { SettingsRepository } from "../shared/storage";
import type {
  FocusSettings,
  ManagedSite,
  SiteId,
  SiteModuleManifest,
  SiteTargetSettings,
  TargetId
} from "../shared/types";

const REGISTRATION_PREFIX = "hourleaf-site-";
const MODULE_REGISTRATION_PREFIX = "hourleaf-module-";

export interface EnabledSiteModuleRegistration {
  manifest: SiteModuleManifest;
  contentScript: string;
  enabled: boolean;
}

export interface ResolvedTarget {
  site: ManagedSite;
  target: SiteTargetSettings;
}

export interface AddSiteResult {
  granted: boolean;
  origin: string;
  site?: ManagedSite;
  target?: SiteTargetSettings;
}

export class ManagedSiteService {
  constructor(private readonly settings = new SettingsRepository()) {}

  async list(): Promise<Pick<FocusSettings, "sites" | "targets">> {
    const { sites, targets } = await this.settings.get();
    return { sites, targets };
  }

  /** Persists only an origin already granted by a direct UI user gesture. */
  async addAuthorized(url: string, label?: string, now = Date.now()): Promise<AddSiteResult> {
    const parsed = parseHttpUrl(url);
    if (!parsed) throw new Error("Only HTTP and HTTPS websites can be added");
    const matchPattern = originMatchPattern(parsed.origin);
    const granted = await permissionsContains([matchPattern]).catch(() => false);
    if (!granted) return { granted: false, origin: parsed.origin };

    const siteId = createOpaqueId("site");
    const targetId = createOpaqueId("target");
    const cleanLabel = normalizeLabel(label, parsed.hostname);
    const site: ManagedSite = {
      id: siteId,
      origin: parsed.origin,
      hostname: parsed.hostname,
      label: cleanLabel,
      enabled: true,
      restrictionMode: "strict",
      visitConfirmation: { enabled: false, waitSeconds: 3 },
      targetIds: [targetId],
      createdAt: now,
      updatedAt: now
    };
    const target: SiteTargetSettings = {
      id: targetId,
      siteId,
      label: cleanLabel,
      enabled: true,
      accessPolicy: "timed",
      dailyLimitMinutes: null,
      schedules: [],
      timePeriods: [createDefaultTimePeriod()],
      temporaryAccess: { enabled: true, durationMinutes: 5, maxUsesPerDay: 3 }
    };
    const updated = await this.settings.mutate((current) => {
      if (Object.values(current.sites).some((candidate) => candidate.origin === parsed.origin)) {
        return;
      }
      current.sites[siteId] = site;
      current.targets[targetId] = target;
    });
    const effectiveSite = Object.values(updated.sites).find(
      (candidate) => candidate.origin === parsed.origin
    );
    if (!effectiveSite) throw new Error("Website could not be saved");
    const effectiveTarget = updated.targets[effectiveSite.targetIds[0] ?? ""];
    await this.ensureRegistration(effectiveSite);
    return {
      granted: true,
      origin: parsed.origin,
      site: effectiveSite,
      ...(effectiveTarget ? { target: effectiveTarget } : {})
    };
  }

  async updateSite(
    siteId: SiteId,
    patch: {
      label?: string;
      restrictionMode?: ManagedSite["restrictionMode"];
      visitConfirmation?: ManagedSite["visitConfirmation"];
    },
    now = Date.now()
  ): Promise<ManagedSite> {
    const normalized = await this.settings.mutate((current) => {
      const site = current.sites[siteId];
      if (!site) throw new Error("Website is not configured");
      current.sites[siteId] = {
        ...site,
        ...(patch.label !== undefined ? { label: normalizeLabel(patch.label, site.hostname) } : {}),
        enabled: true,
        ...(patch.restrictionMode ? { restrictionMode: patch.restrictionMode } : {}),
        ...(patch.visitConfirmation ? { visitConfirmation: { ...patch.visitConfirmation } } : {}),
        updatedAt: now
      };
    });
    const updated = normalized.sites[siteId];
    if (!updated) throw new Error("Website is not configured");
    return updated;
  }

  async applyModuleManifest(
    manifest: SiteModuleManifest,
    enabled: boolean,
    contentScript?: string
  ): Promise<void> {
    const updated = await this.settings.mutate((current) => {
      for (const site of Object.values(current.sites)) {
        if (!manifest.hosts.some((pattern) => modulePatternMatches(pattern, site.origin))) continue;
        for (const section of manifest.sections) {
          if (
            section.hosts &&
            !section.hosts.some((pattern) => modulePatternMatches(pattern, site.origin))
          ) {
            continue;
          }
          const moduleTargetId = section.targetId ?? `${manifest.id}:${section.id}`;
          const existing = site.targetIds
            .map((id) => current.targets[id])
            .find(
              (candidate) =>
                candidate?.moduleId === manifest.id && candidate.moduleSectionId === section.id
            );
          if (existing) {
            existing.moduleEnabled = enabled;
            existing.moduleTargetId = moduleTargetId;
            continue;
          }
          const targetId = moduleSiteTargetId(manifest.id, section.id, site.id);
          current.targets[targetId] = {
            id: targetId,
            siteId: site.id,
            label: section.label,
            enabled: true,
            accessPolicy: "timed",
            dailyLimitMinutes: null,
            schedules: [],
            timePeriods: [createDefaultTimePeriod()],
            temporaryAccess: { enabled: true, durationMinutes: 5, maxUsesPerDay: 3 },
            moduleId: manifest.id,
            moduleSectionId: section.id,
            moduleTargetId,
            moduleEnabled: enabled
          };
          site.targetIds.push(targetId);
        }
      }
    });
    for (const site of Object.values(updated.sites)) {
      if (!manifest.hosts.some((pattern) => modulePatternMatches(pattern, site.origin))) continue;
      if (enabled && contentScript) {
        await this.ensureModuleRegistration(site, manifest.id, contentScript);
      } else {
        await scriptingUnregisterContentScripts([moduleRegistrationId(site.id, manifest.id)]).catch(
          () => undefined
        );
      }
    }
  }

  async removeModuleManifest(manifest: SiteModuleManifest): Promise<void> {
    const updated = await this.settings.mutate((current) => {
      for (const site of Object.values(current.sites)) {
        site.targetIds = site.targetIds.filter(
          (targetId) => current.targets[targetId]?.moduleId !== manifest.id
        );
      }
      for (const [targetId, target] of Object.entries(current.targets)) {
        if (target.moduleId === manifest.id) delete current.targets[targetId];
      }
    });
    const existing = await scriptingGetRegisteredContentScripts().catch(() => []);
    const registeredIds = new Set(existing.map((script) => script.id));
    const registrationIds = Object.values(updated.sites)
      .map((site) => moduleRegistrationId(site.id, manifest.id))
      .filter((id) => registeredIds.has(id));
    if (registrationIds.length > 0) await scriptingUnregisterContentScripts(registrationIds);
  }

  async updateTarget(
    targetId: TargetId,
    patch: Partial<
      Pick<
        SiteTargetSettings,
        | "label"
        | "enabled"
        | "accessPolicy"
        | "dailyLimitMinutes"
        | "schedules"
        | "timePeriods"
        | "temporaryAccess"
      >
    >
  ): Promise<SiteTargetSettings> {
    const normalized = await this.settings.mutate((current) => {
      const target = current.targets[targetId];
      if (!target) throw new Error("Website target is not configured");
      current.targets[targetId] = { ...target, ...patch };
    });
    const updated = normalized.targets[targetId];
    if (!updated) throw new Error("Website target is not configured");
    return updated;
  }

  async remove(siteId: SiteId): Promise<{ removed: true; permissionRemoved: boolean }> {
    let site: ManagedSite | undefined;
    const updated = await this.settings.mutate((current) => {
      site = current.sites[siteId];
      if (!site) throw new Error("Website is not configured");
      delete current.sites[siteId];
      for (const targetId of site.targetIds) delete current.targets[targetId];
    });
    if (!site) throw new Error("Website is not configured");
    const removedSite = site;
    await this.unregisterSiteRegistrations(removedSite);
    const originStillUsed = Object.values(updated.sites).some(
      (candidate) => candidate.origin === removedSite.origin
    );
    const permissionRemoved = originStillUsed
      ? false
      : await permissionsRemove([originMatchPattern(removedSite.origin)]);
    return { removed: true, permissionRemoved };
  }

  async resolve(
    url: string,
    requestedTargetId?: TargetId,
    requirePermission = true
  ): Promise<ResolvedTarget | null> {
    const parsed = parseHttpUrl(url);
    if (!parsed) return null;
    const current = await this.settings.get();
    const site = Object.values(current.sites).find(
      (candidate) => candidate.origin === parsed.origin
    );
    if (!site) return null;
    const directTargetId = requestedTargetId ?? site.targetIds[0];
    if (!directTargetId || !isStableId(directTargetId)) return null;
    const target = site.targetIds
      .map((targetId) => current.targets[targetId])
      .find(
        (candidate) =>
          candidate?.id === directTargetId || candidate?.moduleTargetId === directTargetId
      );
    if (!target || target.siteId !== site.id || target.moduleEnabled === false) return null;
    if (
      requirePermission &&
      !(await permissionsContains([originMatchPattern(site.origin)]).catch(() => false))
    ) {
      return null;
    }
    return { site, target };
  }

  /** Reconciles persistent registrations without requesting new permissions. */
  async rebuildRegistrations(
    modules: readonly EnabledSiteModuleRegistration[] = []
  ): Promise<void> {
    const existing = await scriptingGetRegisteredContentScripts().catch(() => []);
    const ownedIds = existing
      .map((script) => script.id)
      .filter(
        (id) => id.startsWith(REGISTRATION_PREFIX) || id.startsWith(MODULE_REGISTRATION_PREFIX)
      );
    if (ownedIds.length > 0) await scriptingUnregisterContentScripts(ownedIds);

    const { sites } = await this.settings.get();
    for (const site of Object.values(sites)) {
      const granted = await permissionsContains([originMatchPattern(site.origin)]).catch(
        () => false
      );
      if (!granted) continue;
      await this.ensureRegistration(site);
      for (const module of modules) {
        if (
          module.enabled &&
          module.manifest.hosts.some((pattern) => modulePatternMatches(pattern, site.origin))
        ) {
          await this.ensureModuleRegistration(site, module.manifest.id, module.contentScript);
        }
      }
    }
  }

  private async ensureRegistration(site: ManagedSite): Promise<void> {
    const id = registrationId(site.id);
    await scriptingUnregisterContentScripts([id]).catch(() => undefined);
    await scriptingRegisterContentScript(id, [originMatchPattern(site.origin)]);
  }

  private async ensureModuleRegistration(
    site: ManagedSite,
    moduleId: string,
    contentScript: string
  ): Promise<void> {
    const id = moduleRegistrationId(site.id, moduleId);
    await scriptingUnregisterContentScripts([id]).catch(() => undefined);
    await scriptingRegisterContentScript(id, [originMatchPattern(site.origin)], contentScript);
  }

  private async unregisterSiteRegistrations(site: ManagedSite): Promise<void> {
    const matchPattern = originMatchPattern(site.origin);
    const existing = await scriptingGetRegisteredContentScripts().catch(() => []);
    const ids = existing
      .filter(
        (script) =>
          (script.id.startsWith(REGISTRATION_PREFIX) ||
            script.id.startsWith(MODULE_REGISTRATION_PREFIX)) &&
          (script.id === registrationId(site.id) || script.matches?.includes(matchPattern))
      )
      .map((script) => script.id);
    if (ids.length > 0) await scriptingUnregisterContentScripts(ids);
  }
}

export function parseHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 4_096) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function originMatchPattern(origin: string): string {
  return `${origin}/*`;
}

export function sameOrigin(left: string, right: string): boolean {
  const leftUrl = parseHttpUrl(left);
  const rightUrl = parseHttpUrl(right);
  return Boolean(leftUrl && rightUrl && leftUrl.origin === rightUrl.origin);
}

function registrationId(siteId: SiteId): string {
  return `${REGISTRATION_PREFIX}${siteId.replace(/[^A-Za-z0-9_-]/g, "-")}`.slice(0, 128);
}

function moduleRegistrationId(siteId: SiteId, moduleId: string): string {
  return `${MODULE_REGISTRATION_PREFIX}${hashText(`${siteId}\u0000${moduleId}`)}`;
}

function createOpaqueId(prefix: "site" | "target"): string {
  const value =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${value}`;
}

function normalizeLabel(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 80)
    : fallback.slice(0, 80);
}

function modulePatternMatches(pattern: string, origin: string): boolean {
  const match = /^(https?):\/\/(\*\.)?([A-Za-z0-9.-]+)(?::(\d+))?\/\*$/.exec(pattern);
  const url = parseHttpUrl(origin);
  if (!match || !url || `${match[1]}:` !== url.protocol) return false;
  if (match[4] && match[4] !== url.port) return false;
  const hostname = match[3]?.toLowerCase();
  if (!hostname) return false;
  return match[2]
    ? url.hostname === hostname || url.hostname.endsWith(`.${hostname}`)
    : url.hostname === hostname;
}

function moduleSiteTargetId(moduleId: string, sectionId: string, siteId: string): TargetId {
  return `module-target:${hashText(`${moduleId}\u0000${sectionId}\u0000${siteId}`)}`;
}

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}
