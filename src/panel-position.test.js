import assert from 'node:assert/strict';
import test from 'node:test';
import { boundsFromPlacement, clampPanelBounds, displayForRect, migratePanelPreferences, placementFromBounds, resolvePanelBounds } from './panel-position.js';

// Three displays in Electron DIPs with mixed scaling and a negative origin:
//   1: 1920x1080 @100% primary, taskbar at the bottom
//   2: 3840x2160 @150% -> 2560x1440 DIP, to the right and offset upward
//   3: 1920x1200 @125% -> 1536x960 DIP, to the left (negative X), taskbar on the left
const displays = [
  { id: 1, scaleFactor: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 } },
  { id: 2, scaleFactor: 1.5, bounds: { x: 1920, y: -180, width: 2560, height: 1440 }, workArea: { x: 1920, y: -180, width: 2560, height: 1392 } },
  { id: 3, scaleFactor: 1.25, bounds: { x: -1536, y: 0, width: 1536, height: 960 }, workArea: { x: -1488, y: 0, width: 1488, height: 960 } },
];
const inside = (bounds, area) => bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height;

test('the panel opens on the display containing the field, not on the remembered display', () => {
  const placements = { 1: { displayId: '1', rx: 0.5, ry: 0.5, width: 380, height: 480 } };
  const { bounds, displayId } = resolvePanelBounds({ displays, primaryId: 1, targetRect: { x: 2600, y: 200, width: 600, height: 30 }, placements, last: placements[1] });
  assert.equal(displayId, '2');
  assert.ok(inside(bounds, displays[1].workArea));
});

test('a visible panel on the field\'s display does not move while the user writes', () => {
  const current = { x: 2100, y: 300, width: 380, height: 480 };
  const { bounds } = resolvePanelBounds({ displays, primaryId: 1, targetRect: { x: 3000, y: 900, width: 400, height: 20 }, current });
  assert.deepEqual(bounds, current);
});

test('remembered positions are relative to each work area and survive scaling and layout changes', () => {
  const dragged = { x: 1920 + 2560 - 380 - 8, y: -180 + 8, width: 380, height: 480 };
  const placement = placementFromBounds(dragged, displays[1]);
  assert.equal(placement.displayId, '2');
  assert.equal(placement.rx, 1);
  assert.equal(placement.ry, 0);
  assert.deepEqual(boundsFromPlacement(placement, displays[1]), dragged);
  const rescaled = { ...displays[1], bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1032 } };
  const moved = boundsFromPlacement(placement, rescaled);
  assert.deepEqual(moved, { x: 1920 + 1920 - 380 - 8, y: 8, width: 380, height: 480 });
});

test('negative-origin displays and left-side taskbars are respected', () => {
  const { bounds, displayId } = resolvePanelBounds({ displays, primaryId: 1, targetRect: { x: -1000, y: 400, width: 300, height: 30 } });
  assert.equal(displayId, '3');
  assert.ok(inside(bounds, displays[2].workArea));
  assert.ok(bounds.x >= -1488 + 8, 'never under the left taskbar');
});

test('regression: unplugging a display never leaves the panel stranded', () => {
  const twoDisplays = displays.filter((display) => display.id !== 2);
  const stranded = { x: 4000, y: 900, width: 380, height: 480 };
  const { bounds, displayId } = resolvePanelBounds({ displays: twoDisplays, primaryId: 1, current: stranded });
  assert.equal(displayId, '1');
  assert.ok(inside(bounds, displays[0].workArea));
  const fromMissing = resolvePanelBounds({ displays: twoDisplays, primaryId: 1, placements: { 2: { displayId: '2', rx: 0, ry: 0, width: 380, height: 480 } }, last: { displayId: '2', rx: 0.25, ry: 0, width: 380, height: 480 } });
  assert.equal(fromMissing.displayId, '1');
  assert.ok(inside(fromMissing.bounds, displays[0].workArea));
});

test('a panel spanning two displays is assigned to one and clamped fully inside it', () => {
  const spanning = { x: 1800, y: 400, width: 380, height: 480 };
  const display = displayForRect(displays, spanning);
  assert.equal(display.id, 2);
  const clamped = clampPanelBounds(spanning, display.workArea);
  assert.ok(inside(clamped, display.workArea));
});

test('size is limited to sensible bounds and to small work areas at high scaling', () => {
  const laptop150 = { x: 0, y: 0, width: 910, height: 480 };
  const clamped = clampPanelBounds({ x: 0, y: 0, width: 2000, height: 2000 }, laptop150);
  assert.ok(clamped.width <= 720 && clamped.height <= 480 - 16);
  const tiny = clampPanelBounds({ x: 0, y: 0, width: 10, height: 10 }, displays[0].workArea);
  assert.deepEqual([tiny.width, tiny.height], [320, 340]);
  assert.equal(clampPanelBounds({ x: 0, y: 0, width: 380, height: 480 }, displays[0].workArea).x, 8, 'x=0 is a real coordinate, not missing');
});

test('legacy absolute panelBounds are migrated to a per-display placement', () => {
  const { placements, last } = migratePanelPreferences({ panelBounds: { x: 2496, y: 919, width: 362, height: 471 } }, displays);
  assert.equal(last.displayId, '2');
  assert.ok(placements['2']);
  const restored = boundsFromPlacement(last, displays[1]);
  assert.deepEqual([restored.width, restored.height], [362, 471]);
  assert.ok(inside(restored, displays[1].workArea));
  const invalid = migratePanelPreferences({ panelPlacements: { '../x': { rx: 0, ry: 0, width: 1, height: 1 }, 2: { rx: 'a' } } }, displays);
  assert.deepEqual(invalid.placements, {});
});
