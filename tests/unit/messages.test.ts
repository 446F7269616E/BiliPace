import { describe, expect, it } from "vitest";
import { isBilibiliUrl, parseMessageRequest } from "../../src/shared/messages";

describe("message boundary", () => {
  it("accepts a bounded versioned request", () => {
    expect(
      parseMessageRequest({
        version: 1,
        requestId: "request-123",
        type: "GET_USAGE",
        payload: { period: "week", anchorDate: "2026-08-06" }
      })
    ).toEqual({
      requestId: "request-123",
      request: { type: "GET_USAGE", period: "week", anchorDate: "2026-08-06" }
    });
  });

  it("rejects malformed, unknown and off-site messages", () => {
    expect(
      parseMessageRequest({ version: 2, requestId: "x", type: "GET_SETTINGS", payload: {} })
    ).toBeNull();
    expect(
      parseMessageRequest({
        version: 1,
        requestId: "x",
        type: "GET_PAGE_DECISION",
        payload: { url: "https://example.com" }
      })
    ).toBeNull();
    expect(isBilibiliUrl("https://bilibili.com.evil.example/")).toBe(false);
  });

  it("strictly validates plan mutations and navigation identities", () => {
    expect(
      parseMessageRequest({
        version: 1,
        requestId: "plan-1",
        type: "ADD_PLAN_ITEM",
        payload: {
          title: "计划视频",
          url: "https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333"
        }
      })
    ).toEqual({
      requestId: "plan-1",
      request: {
        type: "ADD_PLAN_ITEM",
        title: "计划视频",
        url: "https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333"
      }
    });
    expect(
      parseMessageRequest({
        version: 1,
        requestId: "plan-2",
        type: "GET_PLAN_NAVIGATION_DECISION",
        payload: { bvid: "BV1xx411c7mD" }
      })
    ).toEqual({
      requestId: "plan-2",
      request: { type: "GET_PLAN_NAVIGATION_DECISION", bvid: "BV1xx411c7mD" }
    });

    for (const payload of [
      { url: "https://example.com/video/BV1xx411c7mD" },
      { bvid: "BV-short" },
      { url: "https://www.bilibili.com/video/BV1xx411c7mD", unknown: true },
      { url: "https://www.bilibili.com/video/BV1xx411c7mD", title: "x".repeat(201) }
    ]) {
      expect(
        parseMessageRequest({
          version: 1,
          requestId: "bad-plan",
          type: "ADD_PLAN_ITEM",
          payload
        })
      ).toBeNull();
    }
  });
});
