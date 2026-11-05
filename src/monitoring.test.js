import assert from 'node:assert/strict';
import test from 'node:test';
import { isMonitoringActive, isProcessAllowed, monitoringPauseDeadline, normalizeProcessNames } from './monitoring.js';
import { isRemoteSessionApp } from './monitoring.js';
import { createMonitorWatchdog } from './monitor-watchdog.js';

test('monitor watchdog expires once, is renewed by heartbeats and stops on shutdown', () => {
  let callback, cancelled = [], fired = 0, count = 0;
  const watchdog = createMonitorWatchdog(() => fired++, { timers: { setTimeout(fn) { callback = fn; return ++count; }, clearTimeout(id) { cancelled.push(id); } } });
  assert.equal(count, 1);
  const stale = callback;
  watchdog.ping();
  assert.equal(count, 2);
  assert.ok(cancelled.includes(1));
  stale();
  assert.equal(fired, 0);
  callback();
  assert.equal(fired, 1);
  watchdog.ping();
  assert.equal(count, 2);
  watchdog.stop();
  const stopped = createMonitorWatchdog(() => fired++, { timers: { setTimeout(fn) { callback = fn; return ++count; }, clearTimeout(id) { cancelled.push(id); } } });
  stopped.stop();
  callback();
  assert.equal(fired, 1);
  stopped.ping();
  assert.equal(count, 3);
  assert.ok(cancelled.includes(3));
});

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

test('remote desktop and VM viewers are recognised as sessions whose fields cannot be read', () => {
  assert.equal(isRemoteSessionApp('mstsc'), true);
  assert.equal(isRemoteSessionApp('MSTSC.EXE'), true);
  assert.equal(isRemoteSessionApp('vmconnect'), true);
  assert.equal(isRemoteSessionApp('notepad'), false);
  assert.equal(isRemoteSessionApp(undefined), false);
});
