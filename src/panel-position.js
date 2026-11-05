// Panel placement in ONE coordinate system: Electron DIPs.
// Field rectangles from UI Automation arrive in physical pixels and are converted to DIPs
// (screen.screenToDipRect) before they reach these functions.
//
// Remembered positions are stored per display as a fraction of that display's free work
// area, plus a DIP size. Storing a fraction instead of absolute virtual-desktop
// coordinates keeps the position valid when scaling changes, a display is re-arranged,
// or the virtual desktop has negative or very large origins, and it can never leave the
// panel stranded off-screen.

export const PANEL_DEFAULT_WIDTH = 380;
export const PANEL_DEFAULT_HEIGHT = 480;
export const PANEL_MIN_WIDTH = 320;
export const PANEL_MIN_HEIGHT = 340;
export const PANEL_MAX_WIDTH = 720;
export const PANEL_MAX_HEIGHT = 960;
export const PANEL_MARGIN = 8;

const finite = (value, fallback) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : fallback);

export function clampPanelSize(size, workArea, margin = PANEL_MARGIN) {
  const maxWidth = Math.max(1, Math.min(PANEL_MAX_WIDTH, workArea.width - margin * 2));
  const maxHeight = Math.max(1, Math.min(PANEL_MAX_HEIGHT, workArea.height - margin * 2));
  return {
    width: Math.round(Math.min(Math.max(PANEL_MIN_WIDTH, finite(size?.width, PANEL_DEFAULT_WIDTH)), maxWidth)),
    height: Math.round(Math.min(Math.max(PANEL_MIN_HEIGHT, finite(size?.height, PANEL_DEFAULT_HEIGHT)), maxHeight)),
  };
}

// Keeps the whole panel inside one work area.
export function clampPanelBounds(bounds, workArea, margin = PANEL_MARGIN) {
  const { width, height } = clampPanelSize(bounds, workArea, margin);
  const minX = workArea.x + margin;
  const minY = workArea.y + margin;
  const maxX = Math.max(minX, workArea.x + workArea.width - width - margin);
  const maxY = Math.max(minY, workArea.y + workArea.height - height - margin);
  return {
    x: Math.round(Math.max(minX, Math.min(finite(bounds?.x, minX), maxX))),
    y: Math.round(Math.max(minY, Math.min(finite(bounds?.y, minY), maxY))),
    width,
    height,
  };
}

function contains(rect, point) {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

function distanceToRect(rect, point) {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return dx * dx + dy * dy;
}

// The display that contains the centre of `rect` (DIP), or the nearest one.
export function displayForRect(displays, rect) {
  if (!Array.isArray(displays) || !displays.length) return undefined;
  if (!rect || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key]))) return undefined;
  const centre = { x: rect.x + Math.max(0, rect.width) / 2, y: rect.y + Math.max(0, rect.height) / 2 };
  return displays.find((display) => contains(display.bounds, centre)) ||
    [...displays].sort((a, b) => distanceToRect(a.bounds, centre) - distanceToRect(b.bounds, centre))[0];
}

export function placementFromBounds(bounds, display, margin = PANEL_MARGIN) {
  const workArea = display.workArea;
  const clamped = clampPanelBounds(bounds, workArea, margin);
  const freeX = workArea.width - clamped.width - margin * 2;
  const freeY = workArea.height - clamped.height - margin * 2;
  return {
    displayId: String(display.id),
    rx: freeX > 0 ? Math.min(1, Math.max(0, (clamped.x - workArea.x - margin) / freeX)) : 0,
    ry: freeY > 0 ? Math.min(1, Math.max(0, (clamped.y - workArea.y - margin) / freeY)) : 0,
    width: clamped.width,
    height: clamped.height,
  };
}

export function boundsFromPlacement(placement, display, margin = PANEL_MARGIN) {
  const workArea = display.workArea;
  const { width, height } = clampPanelSize(placement, workArea, margin);
  const rx = Math.min(1, Math.max(0, finite(placement?.rx, 1)));
  const ry = Math.min(1, Math.max(0, finite(placement?.ry, 1)));
  return clampPanelBounds({
    x: workArea.x + margin + rx * (workArea.width - width - margin * 2),
    y: workArea.y + margin + ry * (workArea.height - height - margin * 2),
    width,
    height,
  }, workArea, margin);
}

// Default for a display the panel has never been placed on: the bottom-right corner of
// its work area, which keeps the panel off the text being written.
export function defaultPlacement(display, last) {
  return { displayId: String(display.id), rx: 1, ry: 1, width: last?.width ?? PANEL_DEFAULT_WIDTH, height: last?.height ?? PANEL_DEFAULT_HEIGHT };
}

// Chooses the bounds for showing the panel.
//   targetRect  DIP rect of the field/selection, if known
//   current     the panel's current bounds when it is already visible
//   placements  { [displayId]: placement } remembered per display
//   last        the most recently used placement (any display)
// Rules:
//   1. If the panel is visible and already on the target's display, keep it exactly where it
//      is (only re-clamped), so it never jumps while the user writes.
//   2. Otherwise use the display containing the target; without a target, the display of the
//      last placement, then the primary display.
//   3. On that display use its remembered placement, else the last placement's relative
//      position, else the default corner.
export function resolvePanelBounds({ displays, primaryId, targetRect, current, placements = {}, last }) {
  const byId = (id) => displays.find((display) => String(display.id) === String(id));
  const currentDisplay = current ? displayForRect(displays, current) : undefined;
  const targetDisplay = targetRect ? displayForRect(displays, targetRect) : undefined;
  if (current && currentDisplay && (!targetDisplay || targetDisplay.id === currentDisplay.id)) {
    return { bounds: clampPanelBounds(current, currentDisplay.workArea), displayId: String(currentDisplay.id) };
  }
  const display = targetDisplay || byId(last?.displayId) || byId(primaryId) || displays[0];
  const placement = placements[String(display.id)] || (last ? { ...last, displayId: String(display.id) } : defaultPlacement(display));
  return { bounds: boundsFromPlacement(placement, display), displayId: String(display.id) };
}

// Reads saved preferences. Supports the legacy absolute `panelBounds` field.
export function migratePanelPreferences(raw, displays) {
  const placements = {};
  let last;
  if (raw?.panelPlacements && typeof raw.panelPlacements === 'object') {
    for (const [id, value] of Object.entries(raw.panelPlacements)) {
      if (!/^[\w.-]{1,40}$/.test(id) || !value || typeof value !== 'object') continue;
      if (!['rx', 'ry', 'width', 'height'].every((key) => Number.isFinite(value[key]))) continue;
      placements[id] = { displayId: id, rx: Math.min(1, Math.max(0, value.rx)), ry: Math.min(1, Math.max(0, value.ry)), width: value.width, height: value.height };
    }
  }
  const lastId = typeof raw?.panelLastDisplayId === 'string' ? raw.panelLastDisplayId : undefined;
  if (lastId && placements[lastId]) last = placements[lastId];
  if (!Object.keys(placements).length && raw?.panelBounds && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(raw.panelBounds[key]))) {
    const display = displayForRect(displays, raw.panelBounds);
    if (display) {
      last = placementFromBounds(raw.panelBounds, display);
      placements[last.displayId] = last;
    }
  }
  if (!last) last = Object.values(placements)[0];
  return { placements, last };
}
