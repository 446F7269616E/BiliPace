import { runtimeSendMessage } from "./browser";
import type {
  DeepPartial,
  FocusSettings,
  PageDecision,
  PlanItemInput,
  PlanItemPatch,
  PlanItemSource,
  PlanNavigationDecision,
  PlanState,
  TrackingStatus,
  UsagePeriod,
  UsageSummary
} from "./types";
import {
  isBvid,
  isPlanId,
  isPlanItemSource,
  MAX_PLAN_IMPORT_ITEMS,
  MAX_PLAN_ITEMS,
  MAX_PLAN_TITLE_LENGTH,
  normalizePlanItemInput
} from "./plan";

export type SessionEvent = "start" | "heartbeat" | "route" | "stop";

export interface MessageContract {
  GET_SETTINGS: { request: Record<never, unknown>; response: FocusSettings };
  UPDATE_SETTINGS: { request: { patch: DeepPartial<FocusSettings> }; response: FocusSettings };
  RESET_SETTINGS: { request: Record<never, unknown>; response: FocusSettings };
  GET_USAGE: {
    request: { period: UsagePeriod; anchorDate?: string };
    response: UsageSummary;
  };
  CLEAR_USAGE: { request: Record<never, unknown>; response: { cleared: true } };
  GET_PAGE_DECISION: { request: { url: string }; response: PageDecision };
  GRANT_TEMPORARY_ACCESS: { request: { url: string }; response: PageDecision };
  GET_TRACKING_STATUS: { request: Record<never, unknown>; response: TrackingStatus };
  GET_PLAN_STATE: { request: Record<never, unknown>; response: PlanState };
  SET_PLAN_MODE: {
    request: { enabled?: boolean; watchDurationMinutes?: number };
    response: PlanState;
  };
  ADD_PLAN_ITEM: { request: PlanItemInput; response: PlanState };
  UPDATE_PLAN_ITEM: {
    request: { id: string; patch: PlanItemPatch };
    response: PlanState;
  };
  DELETE_PLAN_ITEM: { request: { id: string }; response: PlanState };
  MOVE_PLAN_ITEM: {
    request: { id: string; direction: "up" | "down" };
    response: PlanState;
  };
  REORDER_PLAN_ITEMS: { request: { orderedIds: string[] }; response: PlanState };
  SET_PLAN_ITEM_COMPLETED: {
    request: { id: string; completed: boolean };
    response: PlanState;
  };
  START_PLAN_ITEM: {
    request: { id: string };
    response: { state: PlanState; url: string; expiresAt: number };
  };
  GET_PLAN_NAVIGATION_DECISION: {
    request: { bvid?: string };
    response: PlanNavigationDecision;
  };
  IMPORT_PLAN_ITEMS: {
    request: { items: PlanItemInput[]; source?: PlanItemSource };
    response: { state: PlanState; addedCount: number; skippedCount: number };
  };
  SESSION_UPDATE: {
    request: {
      event: SessionEvent;
      sessionId: string;
      url: string;
      visibility: "visible" | "hidden";
    };
    response: { accepted: boolean };
  };
}

export type MessageType = keyof MessageContract;
export type RequestOf<K extends MessageType> = { type: K } & MessageContract[K]["request"];
export type AnyRequest = { [K in MessageType]: RequestOf<K> }[MessageType];

export type MessageResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface WireRequest {
  version: 1;
  requestId: string;
  type: MessageType;
  payload: Record<string, unknown>;
}

export interface WireResponse<T> {
  version: 1;
  requestId: string;
  result: MessageResult<T>;
}

/** Typed UI/content facade; callers never need to construct the wire envelope. */
export async function sendRequest<K extends MessageType>(
  message: RequestOf<K>
): Promise<MessageContract[K]["response"]> {
  const { type, ...payload } = message;
  const requestId = createRequestId();
  const response = await runtimeSendMessage<WireResponse<MessageContract[K]["response"]>>({
    version: 1,
    requestId,
    type,
    payload
  } satisfies WireRequest);
  if (!response || response.version !== 1 || response.requestId !== requestId) {
    throw new Error("BiliPace background returned an invalid response");
  }
  if (!response.result.ok) throw new Error(response.result.error.message);
  return response.result.data;
}

/** Validates the untrusted cross-context wire boundary and returns a domain request. */
export function parseMessageRequest(
  value: unknown
): { requestId: string; request: AnyRequest } | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (
    typeof value.requestId !== "string" ||
    value.requestId.length < 1 ||
    value.requestId.length > 100
  ) {
    return null;
  }
  if (!isRecord(value.payload) || typeof value.type !== "string") return null;
  const payload = value.payload;

  let request: AnyRequest;
  switch (value.type) {
    case "GET_SETTINGS":
      request = { type: "GET_SETTINGS" };
      break;
    case "RESET_SETTINGS":
      request = { type: "RESET_SETTINGS" };
      break;
    case "CLEAR_USAGE":
      request = { type: "CLEAR_USAGE" };
      break;
    case "GET_TRACKING_STATUS":
      request = { type: "GET_TRACKING_STATUS" };
      break;
    case "GET_PLAN_STATE":
      request = { type: "GET_PLAN_STATE" };
      break;
    case "UPDATE_SETTINGS":
      if (!isRecord(payload.patch) || !isBoundedJson(payload.patch)) return null;
      request = { type: value.type, patch: payload.patch };
      break;
    case "GET_USAGE":
      if (payload.period !== "day" && payload.period !== "week" && payload.period !== "month")
        return null;
      if (payload.anchorDate !== undefined && typeof payload.anchorDate !== "string") return null;
      request = {
        type: value.type,
        period: payload.period,
        ...(typeof payload.anchorDate === "string" ? { anchorDate: payload.anchorDate } : {})
      };
      break;
    case "GET_PAGE_DECISION":
    case "GRANT_TEMPORARY_ACCESS":
      if (!isBilibiliUrl(payload.url)) return null;
      request = { type: value.type, url: payload.url };
      break;
    case "SET_PLAN_MODE": {
      if (!hasOnlyKeys(payload, ["enabled", "watchDurationMinutes"])) return null;
      const hasEnabled = typeof payload.enabled === "boolean";
      const hasDuration = isBoundedInteger(payload.watchDurationMinutes, 1, 360);
      if (
        (!hasEnabled && !hasDuration) ||
        (payload.enabled !== undefined && !hasEnabled) ||
        (payload.watchDurationMinutes !== undefined && !hasDuration)
      ) {
        return null;
      }
      request = {
        type: value.type,
        ...(hasEnabled ? { enabled: payload.enabled as boolean } : {}),
        ...(hasDuration ? { watchDurationMinutes: payload.watchDurationMinutes as number } : {})
      };
      break;
    }
    case "ADD_PLAN_ITEM": {
      const input = parsePlanItemInput(payload);
      if (!input) return null;
      request = { type: value.type, ...input };
      break;
    }
    case "UPDATE_PLAN_ITEM": {
      if (!isPlanId(payload.id) || !isRecord(payload.patch)) return null;
      const patch = parsePlanItemPatch(payload.patch);
      if (!patch) return null;
      request = { type: value.type, id: payload.id, patch };
      break;
    }
    case "DELETE_PLAN_ITEM":
    case "START_PLAN_ITEM":
      if (!hasOnlyKeys(payload, ["id"]) || !isPlanId(payload.id)) return null;
      request = { type: value.type, id: payload.id };
      break;
    case "MOVE_PLAN_ITEM":
      if (
        !hasOnlyKeys(payload, ["id", "direction"]) ||
        !isPlanId(payload.id) ||
        (payload.direction !== "up" && payload.direction !== "down")
      ) {
        return null;
      }
      request = { type: value.type, id: payload.id, direction: payload.direction };
      break;
    case "REORDER_PLAN_ITEMS":
      if (
        !hasOnlyKeys(payload, ["orderedIds"]) ||
        !Array.isArray(payload.orderedIds) ||
        payload.orderedIds.length > MAX_PLAN_ITEMS ||
        !payload.orderedIds.every(isPlanId) ||
        new Set(payload.orderedIds).size !== payload.orderedIds.length
      ) {
        return null;
      }
      request = { type: value.type, orderedIds: [...payload.orderedIds] };
      break;
    case "SET_PLAN_ITEM_COMPLETED":
      if (
        !hasOnlyKeys(payload, ["id", "completed"]) ||
        !isPlanId(payload.id) ||
        typeof payload.completed !== "boolean"
      ) {
        return null;
      }
      request = { type: value.type, id: payload.id, completed: payload.completed };
      break;
    case "GET_PLAN_NAVIGATION_DECISION":
      if (!hasOnlyKeys(payload, ["bvid"])) return null;
      if (payload.bvid !== undefined && !isBvid(payload.bvid)) return null;
      request = {
        type: value.type,
        ...(isBvid(payload.bvid) ? { bvid: payload.bvid } : {})
      };
      break;
    case "IMPORT_PLAN_ITEMS": {
      if (
        !hasOnlyKeys(payload, ["items", "source"]) ||
        !Array.isArray(payload.items) ||
        payload.items.length < 1 ||
        payload.items.length > MAX_PLAN_IMPORT_ITEMS ||
        (payload.source !== undefined && !isPlanItemSource(payload.source))
      ) {
        return null;
      }
      const source = isPlanItemSource(payload.source) ? payload.source : undefined;
      const items = payload.items.map((item) => parsePlanItemInput(item, source));
      if (items.some((item) => item === null)) return null;
      request = {
        type: value.type,
        items: items as PlanItemInput[],
        ...(source ? { source } : {})
      };
      break;
    }
    case "SESSION_UPDATE":
      if (
        (payload.event !== "start" &&
          payload.event !== "heartbeat" &&
          payload.event !== "route" &&
          payload.event !== "stop") ||
        typeof payload.sessionId !== "string" ||
        payload.sessionId.length < 8 ||
        payload.sessionId.length > 100 ||
        !isBilibiliUrl(payload.url) ||
        (payload.visibility !== "visible" && payload.visibility !== "hidden")
      ) {
        return null;
      }
      request = {
        type: value.type,
        event: payload.event,
        sessionId: payload.sessionId,
        url: payload.url,
        visibility: payload.visibility
      };
      break;
    default:
      return null;
  }
  return { requestId: value.requestId, request };
}

export function isBilibiliUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4_096) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)bilibili\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function parsePlanItemInput(value: unknown, fallbackSource?: PlanItemSource): PlanItemInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["title", "url", "bvid", "source"])) return null;
  if (!normalizePlanItemInput(value, fallbackSource)) return null;
  return {
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.bvid === "string" ? { bvid: value.bvid } : {}),
    ...(isPlanItemSource(value.source) ? { source: value.source } : {})
  } as PlanItemInput;
}

function parsePlanItemPatch(value: Record<string, unknown>): PlanItemPatch | null {
  if (!hasOnlyKeys(value, ["title", "url", "bvid", "source"]) || Object.keys(value).length < 1) {
    return null;
  }
  if (
    (value.title !== undefined &&
      (typeof value.title !== "string" || value.title.length > MAX_PLAN_TITLE_LENGTH)) ||
    (value.url !== undefined && typeof value.url !== "string") ||
    (value.bvid !== undefined && !isBvid(value.bvid)) ||
    (value.source !== undefined && !isPlanItemSource(value.source))
  ) {
    return null;
  }
  if (value.url !== undefined || value.bvid !== undefined) {
    const identity = normalizePlanItemInput({
      ...(typeof value.url === "string" ? { url: value.url } : {}),
      ...(isBvid(value.bvid) ? { bvid: value.bvid } : {})
    });
    if (!identity) return null;
  }
  return {
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(isBvid(value.bvid) ? { bvid: value.bvid } : {}),
    ...(isPlanItemSource(value.source) ? { source: value.source } : {})
  };
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

function isBoundedJson(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null || typeof value === "boolean" || typeof value === "number") return true;
  if (typeof value === "string") return value.length <= 1_000;
  if (Array.isArray(value)) {
    return value.length <= 100 && value.every((item) => isBoundedJson(item, depth + 1));
  }
  if (!isRecord(value) || Object.keys(value).length > 100) return false;
  return Object.values(value).every((item) => isBoundedJson(item, depth + 1));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
