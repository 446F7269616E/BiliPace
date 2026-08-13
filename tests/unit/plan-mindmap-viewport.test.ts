import { describe, expect, it } from "vitest";
import {
  clampMindmapScale,
  fitMindmapTransform,
  getMindmapConnectorMetrics,
  MAX_MINDMAP_SCALE,
  MIN_MINDMAP_SCALE,
  zoomMindmapAt
} from "../../src/plan/mindmap-viewport";

describe("plan mind map viewport", () => {
  it("fits and centers a scene with bounded scale", () => {
    const fitted = fitMindmapTransform(
      { width: 1000, height: 600 },
      { width: 1600, height: 800 },
      40
    );
    expect(fitted.x).toBeCloseTo(40);
    expect(fitted.y).toBeCloseTo(70);
    expect(fitted.scale).toBe(0.575);
  });

  it("never zooms beyond the supported bounds", () => {
    expect(clampMindmapScale(0.001)).toBe(MIN_MINDMAP_SCALE);
    expect(clampMindmapScale(99)).toBe(MAX_MINDMAP_SCALE);
    expect(clampMindmapScale(Number.NaN)).toBe(1);
  });

  it("fits an extremely wide 500-item scene inside the viewport", () => {
    const viewport = { width: 1400, height: 700 };
    const scene = { width: 150_000, height: 620 };
    const fitted = fitMindmapTransform(viewport, scene, 32);

    expect(fitted.scale).toBeCloseTo((viewport.width - 64) / scene.width);
    expect(fitted.x).toBeCloseTo(32);
    expect(scene.width * fitted.scale).toBeLessThanOrEqual(viewport.width - 64);
  });

  it("connects the real centers of unequal collapsed and expanded branches", () => {
    expect(getMindmapConnectorMetrics({ top: 12, height: 240 }, { top: 276, height: 44 })).toEqual({
      top: 132,
      height: 166
    });
  });

  it("keeps the scene point under the pointer stable while zooming", () => {
    const before = { x: 100, y: 50, scale: 1 };
    const anchor = { x: 300, y: 250 };
    const after = zoomMindmapAt(before, 1.5, anchor);

    expect(after).toEqual({ x: 0, y: -50, scale: 1.5 });
    expect((anchor.x - after.x) / after.scale).toBe((anchor.x - before.x) / before.scale);
    expect((anchor.y - after.y) / after.scale).toBe((anchor.y - before.y) / before.scale);
  });
});
