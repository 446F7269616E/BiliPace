import { BILIBILI_SITE_MODULE_MANIFEST } from "../modules/bilibili/metadata";
import { sendRequest } from "../shared/messages";
import type { SiteModuleStore } from "../shared/types";

export type ModuleAction = "restore" | "enable" | "disable";

export async function getSiteModules(): Promise<SiteModuleStore | null> {
  try {
    return await sendRequest({ type: "GET_SITE_MODULES" });
  } catch {
    return null;
  }
}

export async function addManagedSite(url: string): Promise<void> {
  const result = await sendRequest({ type: "ADD_MANAGED_SITE", url });
  if (!result.granted) throw new Error("未获得网站权限");
}

export async function updateManagedSite(siteId: string, enabled: boolean): Promise<void> {
  await sendRequest({ type: "UPDATE_MANAGED_SITE", siteId, patch: { enabled } });
}

export async function removeManagedSite(siteId: string): Promise<void> {
  await sendRequest({ type: "REMOVE_MANAGED_SITE", siteId });
}

export async function setSiteModuleState(moduleId: string, action: ModuleAction): Promise<void> {
  if (action === "restore") {
    await sendRequest({ type: "RESTORE_SITE_MODULE", moduleId });
    return;
  }
  if (action === "enable") {
    const store = await getSiteModules();
    if (!store?.installations[moduleId]) await setSiteModuleState(moduleId, "restore");
  }
  await sendRequest({ type: "SET_SITE_MODULE_ENABLED", moduleId, enabled: action === "enable" });
}

export async function removeSiteModule(moduleId: string): Promise<void> {
  await sendRequest({ type: "UNINSTALL_SITE_MODULE", moduleId });
}

export async function requestBilibiliModulePermissions(): Promise<boolean> {
  return requestWebsitePermissions([...BILIBILI_SITE_MODULE_MANIFEST.hosts]);
}

export async function addBilibiliModuleSites(): Promise<void> {
  for (const pattern of BILIBILI_SITE_MODULE_MANIFEST.hosts) {
    await addManagedSite(pattern.slice(0, -2));
  }
}

export function normalizeWebsiteInput(value: string): {
  origin: string;
  permissionPattern: string;
} {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2_048) throw new Error("请输入有效域名或网址");
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("请输入有效域名或网址");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new Error("仅支持 HTTP 和 HTTPS 网站");
  }
  return { origin: url.origin, permissionPattern: `${url.origin}/*` };
}

export async function requestWebsitePermission(pattern: string): Promise<boolean> {
  return requestWebsitePermissions([pattern]);
}

async function requestWebsitePermissions(patterns: string[]): Promise<boolean> {
  const api = globalThis as typeof globalThis & {
    browser?: PermissionApi;
    chrome?: PermissionApi;
  };
  if (api.browser?.permissions?.request) {
    return Boolean(await api.browser.permissions.request({ origins: patterns }));
  }
  const permissions = api.chrome?.permissions;
  if (!permissions?.request) return false;
  return new Promise<boolean>((resolve) => permissions.request?.({ origins: patterns }, resolve));
}

export async function hasWebsitePermission(pattern: string): Promise<boolean | null> {
  const api = globalThis as typeof globalThis & {
    browser?: PermissionApi;
    chrome?: PermissionApi;
  };
  if (api.browser?.permissions?.contains) {
    return Boolean(await api.browser.permissions.contains({ origins: [pattern] }));
  }
  const permissions = api.chrome?.permissions;
  if (!permissions?.contains) return null;
  return new Promise<boolean>((resolve) => permissions.contains?.({ origins: [pattern] }, resolve));
}

interface PermissionApi {
  permissions?: {
    request(
      permissions: { origins: string[] },
      callback?: (granted: boolean) => void
    ): Promise<boolean> | void;
    contains(
      permissions: { origins: string[] },
      callback?: (granted: boolean) => void
    ): Promise<boolean> | void;
  };
}
