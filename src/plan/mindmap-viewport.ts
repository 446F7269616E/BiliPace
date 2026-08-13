export interface MindmapTransform {
  x: number;
  y: number;
  scale: number;
}

export interface MindmapSize {
  width: number;
  height: number;
}

export interface MindmapPoint {
  x: number;
  y: number;
}

export interface MindmapVerticalBounds {
  top: number;
  height: number;
}

export interface MindmapConnectorMetrics {
  top: number;
  height: number;
}

/** Small enough to provide a true overview for the maximum 500-item queue. */
export const MIN_MINDMAP_SCALE = 0.005;
export const MAX_MINDMAP_SCALE = 1.6;

export function clampMindmapScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_MINDMAP_SCALE, Math.max(MIN_MINDMAP_SCALE, scale));
}

export function getMindmapConnectorMetrics(
  first: MindmapVerticalBounds,
  last: MindmapVerticalBounds
): MindmapConnectorMetrics {
  const firstCenter = first.top + first.height / 2;
  const lastCenter = last.top + last.height / 2;
  return {
    top: Math.min(firstCenter, lastCenter),
    height: Math.abs(lastCenter - firstCenter)
  };
}

export function fitMindmapTransform(
  viewport: MindmapSize,
  scene: MindmapSize,
  padding = 32
): MindmapTransform {
  const safeViewportWidth = Math.max(1, viewport.width);
  const safeViewportHeight = Math.max(1, viewport.height);
  const safeSceneWidth = Math.max(1, scene.width);
  const safeSceneHeight = Math.max(1, scene.height);
  const availableWidth = Math.max(1, safeViewportWidth - padding * 2);
  const availableHeight = Math.max(1, safeViewportHeight - padding * 2);
  const scale = clampMindmapScale(
    Math.min(1, availableWidth / safeSceneWidth, availableHeight / safeSceneHeight)
  );

  return {
    x: (safeViewportWidth - safeSceneWidth * scale) / 2,
    y: (safeViewportHeight - safeSceneHeight * scale) / 2,
    scale
  };
}

export function zoomMindmapAt(
  transform: MindmapTransform,
  requestedScale: number,
  anchor: MindmapPoint
): MindmapTransform {
  const scale = clampMindmapScale(requestedScale);
  const currentScale = clampMindmapScale(transform.scale);
  const sceneX = (anchor.x - transform.x) / currentScale;
  const sceneY = (anchor.y - transform.y) / currentScale;

  return {
    x: anchor.x - sceneX * scale,
    y: anchor.y - sceneY * scale,
    scale
  };
}
