import { describe, expect, it, vi } from "vitest";
import type { AnalyticsService } from "../../src/shared/analytics";
import { UsageTracker } from "../../src/background/tracker";

describe("usage tracker", () => {
  it("counts a visible active session once and stops while hidden", async () => {
    let now = 0;
    const recordInterval = vi.fn(() => Promise.resolve());
    const tracker = new UsageTracker(
      { recordInterval } as unknown as AnalyticsService,
      () => now,
      null,
      () => true,
      () => ({ targetId: "target:test" })
    );
    const tab = {
      id: 7,
      active: true,
      windowId: 1,
      url: "https://example.com/focus"
    };

    expect(tracker.handleSessionUpdate(tab, "start", "session-123", tab.url, "visible")).toBe(true);
    now = 15_000;
    await tracker.flush();
    await tracker.flush();
    expect(recordInterval).toHaveBeenCalledTimes(1);
    expect(recordInterval).toHaveBeenCalledWith("target:test", 0, 15_000);

    now = 20_000;
    tracker.handleSessionUpdate(tab, "heartbeat", "session-123", tab.url, "hidden");
    now = 35_000;
    await tracker.flush();
    expect(recordInterval).toHaveBeenCalledTimes(2);
    expect(recordInterval).toHaveBeenLastCalledWith("target:test", 15_000, 20_000);
  });

  it("rejects stale events from a replaced session", () => {
    const tracker = new UsageTracker(
      { recordInterval: vi.fn(() => Promise.resolve()) } as unknown as AnalyticsService,
      () => 0,
      null
    );
    const tab = { id: 1, active: true, url: "https://example.com/" };
    tracker.handleSessionUpdate(tab, "start", "session-new", tab.url, "visible");
    expect(tracker.handleSessionUpdate(tab, "stop", "session-old", tab.url, "hidden")).toBe(false);
  });

  it("does not count an interval rejected by the plan/focus eligibility gate", async () => {
    let now = 0;
    const recordInterval = vi.fn(() => Promise.resolve());
    const tracker = new UsageTracker(
      { recordInterval } as unknown as AnalyticsService,
      () => now,
      null,
      () => false,
      () => ({ targetId: "target:test" })
    );
    const tab = {
      id: 9,
      active: true,
      windowId: 1,
      url: "https://example.com/focus"
    };
    tracker.handleSessionUpdate(tab, "start", "session-plan", tab.url, "visible");
    now = 15_000;
    await tracker.flush();
    expect(recordInterval).not.toHaveBeenCalled();
  });
});
