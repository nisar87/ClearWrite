import test from 'node:test';
import assert from 'node:assert/strict';
import { badgePlacement, cardPlacement } from './inline-popups.js';

const area = { x: 0, y: 0, width: 1920, height: 1040 };

test('the widget sits inside the bottom-right corner of a multi-line field', () => {
  assert.deepEqual(badgePlacement({ x: 100, y: 100, width: 600, height: 300 }, area, 30), { x: 664, y: 364, width: 30, height: 30 });
});

test('the widget sits beside a single-line field and stays on screen', () => {
  assert.deepEqual(badgePlacement({ x: 100, y: 100, width: 400, height: 28 }, area, 30), { x: 504, y: 99, width: 30, height: 30 });
  assert.equal(badgePlacement({ x: 1600, y: 10, width: 320, height: 28 }, area, 30).x, 1890);
});

test('the card opens below the word, or above it near the bottom of the screen', () => {
  assert.deepEqual(cardPlacement([200, 300, 60, 18], area, 300, 150), { x: 200, y: 324, width: 300, height: 150 });
  assert.equal(cardPlacement([200, 1000, 60, 18], area, 300, 150).y, 844);
  assert.equal(cardPlacement([1800, 300, 60, 18], area, 300, 150).x, 1620);
});
