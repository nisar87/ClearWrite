export const PANEL_DEFAULT_WIDTH = 390;
export const PANEL_DEFAULT_HEIGHT = 530;

export function clampPanelBounds(bounds, workArea, margin = 8) {
  const maxWidth = Math.max(1, workArea.width - margin * 2);
  const maxHeight = Math.max(1, workArea.height - margin * 2);
  const width = Math.min(Math.max(320, Number(bounds.width) || PANEL_DEFAULT_WIDTH), maxWidth);
  const height = Math.min(Math.max(420, Number(bounds.height) || PANEL_DEFAULT_HEIGHT), maxHeight);
  const minX = workArea.x + margin;
  const minY = workArea.y + margin;
  return {
    x: Math.round(Math.max(minX, Math.min(Number(bounds.x) || minX, workArea.x + workArea.width - width - margin))),
    y: Math.round(Math.max(minY, Math.min(Number(bounds.y) || minY, workArea.y + workArea.height - height - margin))),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function initialPanelBounds(point, workArea, width = PANEL_DEFAULT_WIDTH, height = PANEL_DEFAULT_HEIGHT, margin = 8) {
  const x = point.x + 16;
  const y = point.y + 16;
  return clampPanelBounds({ x, y, width, height }, workArea, margin);
}
