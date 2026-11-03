import assert from 'node:assert/strict';
import test from 'node:test';
import { isMonitoringActive, isProcessAllowed, monitoringPauseDeadline, normalizeProcessNames } from './monitoring.js';

test('app process names are normalized and deduplicated', () => {
  assert.deepEqual(normalizeProcessNames([' Chrome.exe ', 'chrome', '', 'ms-teams']), ['chrome', 'ms-teams']);
  assert.throws(() => normalizeProcessNames(['bad/name']), /process names/);
  assert.throws(() => normalizeProcessNames(Array.from({ length: 41 }, (_, index) => `app${index}`)), /up to 40/);
});

test('timed pauses expire at the requested local deadline', () => {
  const now = new Date(2026, 0, 1, 10, 30).getTime();
  assert.equal(monitoringPauseDeadline('hour', now), now + 60 * 60 * 1000);
  const tomorrow = new Date(2026, 0, 2, 0, 0).getTime();
  assert.equal(monitoringPauseDeadline('tomorrow', now), tomorrow);
  assert.throws(() => monitoringPauseDeadline('week', now), /supported/);
});

test('temporary pause overrides the enabled preference until it expires', () => {
  assert.equal(isMonitoringActive(false, 0, 100), false);
  assert.equal(isMonitoringActive(true, 101, 100), false);
  assert.equal(isMonitoringActive(true, 100, 100), true);
});

test('app restrictions always honor protected and user-excluded processes', () => {
  assert.equal(isProcessAllowed('notepad.exe', true, ['notepad']), true);
  assert.equal(isProcessAllowed('chrome', true, ['notepad']), false);
  assert.equal(isProcessAllowed('powershell', false, []), false);
  assert.equal(isProcessAllowed('custom-editor', false, [], ['custom-editor']), false);
});
