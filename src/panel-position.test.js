import assert from 'node:assert/strict';
import test from 'node:test';
import { clampPanelBounds, initialPanelBounds } from './panel-position.js';

test('initial panel placement stays on the display containing the cursor', () => {
  assert.deepEqual(
    initialPanelBounds({ x: 15900, y: 4200 }, { x: 12800, y: 2146, width: 3840, height: 2160 }),
    { x: 15916, y: 3768, width: 390, height: 530 },
  );
});

test('saved panel bounds are clamped when a monitor layout changes', () => {
  assert.deepEqual(
    clampPanelBounds({ x: 15828, y: 3134, width: 752, height: 956 }, { x: 0, y: 0, width: 1920, height: 1080 }),
    { x: 1160, y: 116, width: 752, height: 956 },
  );
});

test('panel position supports monitors with negative origins', () => {
  assert.deepEqual(
    initialPanelBounds({ x: -1600, y: 500 }, { x: -1920, y: 0, width: 1920, height: 1080 }),
    { x: -1584, y: 516, width: 390, height: 530 },
  );
});
