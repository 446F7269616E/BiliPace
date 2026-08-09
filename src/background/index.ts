import { AnalyticsService, parseLocalDate } from "../shared/analytics";
import { ManagedSiteService, sameOrigin } from "../core/sites";
import {
  getExtensionApi,
  runtimeAddMessageListener,
  type ExtensionMessageSender
} from "../shared/browser";
import { FocusDecisionService } from "../shared/focus";
import { isHttpUrl, parseMessageRequest, type AnyRequest } from "../shared/messages";
import { SettingsRepository, SiteModuleRepository } from "../shared/storage";
import type { DeepPartial, FocusSettings, UsagePeriod } from "../shared/types";
import { PlanService } from "./plan";
import { UsageTracker } from "./tracker";

const api = getExtensionApi();
const settings = new SettingsRepository();
const analytics = new AnalyticsService();
const managedSites = new ManagedSiteService(settings);
const modules = new SiteModuleRepository();
const resolveManagedTarget = async (url: string, targetId?: string) => {
  const resolved = await managedSites.resolve(url, targetId);
  return resolved ? { siteId: resolved.site.id, target: resolved.target } : null;
};
const focus = new FocusDecisionService(settings, undefined, analytics, resolveManagedTarget);
const plan = new PlanService(settings);
const tracker = new UsageTracker(
  analytics,
  Date.now,
  api,
  (url, at, targetId) =>
    Promise.all([focus.decide(url, new Date(at), targetId), plan.decideNavigation(url)]).then(
      ([focusDecision, planDecision]) => !focusDecision.blocked && planDecision.allowed
    ),
  async (url, targetId) => {
    const resolved = await managedSites.resolve(url, targetId);
    return resolved ? { siteId: resolved.site.id, targetId: resolved.target.id } : null;
  }
);

if (api) {
  runtimeAddMessageListener(async (rawMessage, sender) => {
    const parsed = parseMessageRequest(rawMessage);
    if (!parsed || !isTrustedSender(sender)) return undefined;
    try {
      const data = await handleMessage(parsed.request, sender);
      return {
        version: 1,
        requestId: parsed.requestId,
        result: { ok: true, data }
      };
    } catch (error: unknown) {
      return {
        version: 1,
        requestId: parsed.requestId,
        result: {
          ok: false,
          error: {
            code: "REQUEST_FAILED",
            message: error instanceof Error ? error.message : "Unknown Hourleaf error"
          }
        }
      };
    }
  });

  void tracker.start().catch((error: unknown) => {
    console.warn("Hourleaf usage tracking could not start", error);
  });
  void managedSites.rebuildRegistrations().catch((error: unknown) => {
    console.warn("Hourleaf could not rebuild website registrations", error);
  });
}

export async function handleMessage(
  message: AnyRequest,
  sender?: ExtensionMessageSender
): Promise<unknown> {
  switch (message.type) {
    case "GET_SETTINGS":
      return settings.get();
    case "UPDATE_SETTINGS":
      assertSettingsPatch(message.patch);
      return settings.update(message.patch);
    case "RESET_SETTINGS":
      for (const siteId of Object.keys((await managedSites.list()).sites)) {
        await managedSites.remove(siteId);
      }
      return settings.reset();
    case "GET_USAGE":
      assertPeriod(message.period);
      await tracker.flush();
      return analytics.summarize(message.period, parseLocalDate(message.anchorDate) ?? new Date());
    case "CLEAR_USAGE":
      await analytics.clear();
      return { cleared: true as const };
    case "GET_PAGE_DECISION":
      assertUrl(message.url);
      await assertAuthorizedConfiguredUrl(message.url, message.targetId, sender);
      return focus.decide(message.url, new Date(), message.targetId);
    case "GRANT_TEMPORARY_ACCESS":
      assertUrl(message.url);
      await assertAuthorizedConfiguredUrl(message.url, message.targetId, sender);
      return focus.grant(message.url, new Date(), message.targetId);
    case "GET_MANAGED_SITES":
      assertExtensionPageSender(sender);
      return managedSites.list();
    case "ADD_MANAGED_SITE": {
      assertExtensionPageSender(sender);
      const result = await managedSites.addAuthorized(message.url, message.label);
      if (result.granted) {
        const moduleStore = await modules.get();
        for (const installation of Object.values(moduleStore.installations)) {
          if (installation.enabled) {
            await managedSites.applyModuleManifest(installation.manifest, true);
          }
        }
      }
      return result;
    }
    case "UPDATE_MANAGED_SITE":
      assertExtensionPageSender(sender);
      return managedSites.updateSite(message.siteId, message.patch);
    case "UPDATE_SITE_TARGET":
      assertExtensionPageSender(sender);
      return managedSites.updateTarget(message.targetId, message.patch);
    case "REMOVE_MANAGED_SITE":
      assertExtensionPageSender(sender);
      return managedSites.remove(message.siteId);
    case "GET_SITE_MODULES":
      assertExtensionPageSender(sender);
      return modules.get();
    case "INSTALL_SITE_MODULE":
      assertExtensionPageSender(sender);
      {
        const store = await modules.install(message.manifest, message.source);
        const installation = store.installations[message.manifest.id];
        if (!installation) throw new Error("Site module manifest was rejected");
        await managedSites.applyModuleManifest(installation.manifest, true);
        return store;
      }
    case "SET_SITE_MODULE_ENABLED": {
      assertExtensionPageSender(sender);
      const store = await modules.get();
      const installation = store.installations[message.moduleId];
      if (!installation) throw new Error("Site module is not installed");
      await managedSites.applyModuleManifest(installation.manifest, message.enabled);
      return modules.setEnabled(message.moduleId, message.enabled);
    }
    case "UNINSTALL_SITE_MODULE": {
      assertExtensionPageSender(sender);
      const store = await modules.get();
      const installation = store.installations[message.moduleId];
      if (installation) await managedSites.applyModuleManifest(installation.manifest, false);
      return modules.uninstall(message.moduleId);
    }
    case "GET_TRACKING_STATUS":
      await tracker.flush();
      return tracker.getStatus();
    case "GET_PLAN_STATE":
      assertExtensionPageSender(sender);
      return plan.getState();
    case "SET_PLAN_MODE":
      assertExtensionPageSender(sender);
      return plan.setMode({
        ...(message.enabled !== undefined ? { enabled: message.enabled } : {}),
        ...(message.watchDurationMinutes !== undefined
          ? { watchDurationMinutes: message.watchDurationMinutes }
          : {})
      });
    case "ADD_PLAN_ITEM":
      assertExtensionPageSender(sender);
      return plan.add(message);
    case "UPDATE_PLAN_ITEM":
      assertExtensionPageSender(sender);
      return plan.update(message.id, message.patch);
    case "DELETE_PLAN_ITEM":
      assertExtensionPageSender(sender);
      return plan.remove(message.id);
    case "MOVE_PLAN_ITEM":
      assertExtensionPageSender(sender);
      return plan.move(message.id, message.direction);
    case "REORDER_PLAN_ITEMS":
      assertExtensionPageSender(sender);
      return plan.reorder(message.orderedIds);
    case "SET_PLAN_ITEM_COMPLETED":
      assertExtensionPageSender(sender);
      return plan.setCompleted(message.id, message.completed);
    case "START_PLAN_ITEM":
      assertExtensionPageSender(sender);
      return plan.start(message.id);
    case "GET_PLAN_NAVIGATION_DECISION":
      if (sender?.tab) {
        if (!message.url) throw new Error("Website plan checks require their current URL");
        await assertAuthorizedConfiguredUrl(message.url, undefined, sender);
      }
      return plan.decideNavigation(message.url, message.bvid);
    case "IMPORT_PLAN_ITEMS":
      assertExtensionPageSender(sender);
      return plan.importItems(message.items, message.source);
    case "SESSION_UPDATE": {
      if (!sender?.tab) throw new Error("Session updates require a website tab");
      const resolved = await assertAuthorizedConfiguredUrl(message.url, message.targetId, sender);
      return {
        accepted: tracker.handleSessionUpdate(
          sender.tab,
          message.event,
          message.sessionId,
          message.url,
          message.visibility,
          resolved.target.id
        )
      };
    }
    default:
      return assertNever(message);
  }
}

function assertExtensionPageSender(sender?: ExtensionMessageSender): void {
  // Direct calls without a sender are used by deterministic unit tests. An
  // extension page may itself live in a browser tab, so `sender.tab` does not
  // distinguish it from a content script; the trusted extension URL does.
  if (sender && !isExtensionPageSender(sender)) {
    throw new Error("Plan data is available only to extension pages");
  }
}

function isTrustedSender(sender: ExtensionMessageSender): boolean {
  if (api?.runtime.id && sender.id && sender.id !== api.runtime.id) return false;
  if (isExtensionPageSender(sender)) return true;
  if (sender.tab) return isHttpUrl(sender.url ?? sender.tab.url);
  return sender.id === api?.runtime.id;
}

function isExtensionPageSender(sender: ExtensionMessageSender): boolean {
  const extensionRoot = api?.runtime.getURL?.("");
  return Boolean(extensionRoot && sender.url?.startsWith(extensionRoot));
}

function assertUrl(url: unknown): asserts url is string {
  if (!isHttpUrl(url)) throw new Error("Invalid URL");
}

async function assertAuthorizedConfiguredUrl(
  url: string,
  targetId: string | undefined,
  sender?: ExtensionMessageSender
) {
  const senderUrl = sender?.url ?? sender?.tab?.url;
  if (sender?.tab && (!senderUrl || !sameOrigin(senderUrl, url))) {
    throw new Error("Website messages cannot cross origins");
  }
  const resolved = await managedSites.resolve(url, targetId, true);
  if (!resolved) throw new Error("Website is not configured or its permission is missing");
  return resolved;
}

function assertPeriod(period: unknown): asserts period is UsagePeriod {
  if (period !== "day" && period !== "week" && period !== "month") {
    throw new Error("Invalid usage period");
  }
}

function assertSettingsPatch(value: unknown): asserts value is DeepPartial<FocusSettings> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid settings patch");
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported request: ${String(value)}`);
}
