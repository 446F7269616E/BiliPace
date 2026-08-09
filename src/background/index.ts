import { AnalyticsService, parseLocalDate } from "../shared/analytics";
import {
  getExtensionApi,
  runtimeAddMessageListener,
  type ExtensionMessageSender
} from "../shared/browser";
import { FocusDecisionService } from "../shared/focus";
import { isBilibiliUrl, parseMessageRequest, type AnyRequest } from "../shared/messages";
import { SettingsRepository } from "../shared/storage";
import type { DeepPartial, FocusSettings, UsagePeriod } from "../shared/types";
import { extractBvidFromVideoUrl } from "../shared/plan";
import { PlanService } from "./plan";
import { UsageTracker } from "./tracker";

const api = getExtensionApi();
const settings = new SettingsRepository();
const analytics = new AnalyticsService();
const focus = new FocusDecisionService(settings, undefined, analytics);
const plan = new PlanService(settings);
const tracker = new UsageTracker(analytics, Date.now, api, (url, at) =>
  Promise.all([
    focus.decide(url, new Date(at)),
    plan.decideNavigation(extractBvidFromVideoUrl(url) ?? undefined)
  ]).then(([focusDecision, planDecision]) => !focusDecision.blocked && planDecision.allowed)
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
            message: error instanceof Error ? error.message : "Unknown BiliPace error"
          }
        }
      };
    }
  });

  void tracker.start().catch((error: unknown) => {
    console.warn("BiliPace usage tracking could not start", error);
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
      return focus.decide(message.url);
    case "GRANT_TEMPORARY_ACCESS":
      assertUrl(message.url);
      return focus.grant(message.url);
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
      return plan.decideNavigation(message.bvid);
    case "IMPORT_PLAN_ITEMS":
      assertExtensionPageSender(sender);
      return plan.importItems(message.items, message.source);
    case "SESSION_UPDATE":
      if (!sender?.tab || !isBilibiliUrl(sender.url ?? sender.tab.url)) {
        throw new Error("Session updates are accepted only from Bilibili content scripts");
      }
      return {
        accepted: tracker.handleSessionUpdate(
          sender.tab,
          message.event,
          message.sessionId,
          message.url,
          message.visibility
        )
      };
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
  if (sender.tab) return isBilibiliUrl(sender.url ?? sender.tab.url);
  return sender.id === api?.runtime.id;
}

function isExtensionPageSender(sender: ExtensionMessageSender): boolean {
  const extensionRoot = api?.runtime.getURL?.("");
  return Boolean(extensionRoot && sender.url?.startsWith(extensionRoot));
}

function assertUrl(url: unknown): asserts url is string {
  if (typeof url !== "string" || url.length > 4_096) throw new Error("Invalid URL");
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
