import assert from 'node:assert/strict';
import test from 'node:test';
import { createPanelLifecycle, ELECTRON_BEHIND_TASKBAR_LEVELS, needsTopmostRepair, panelWindowOps, PINNED_TOPMOST_LEVEL, reducePanel } from './panel-lifecycle.js';

const run = (events, state = createPanelLifecycle()) => events.reduce((current, event) => reducePanel(current, event), state);

test('focus, blur, app switches, UIA gaps, loading and errors never change visibility or z-order', () => {
  const noise = ['focus', 'blur', 'app-switch', 'field-gap', 'loading', 'error', 'renderer-reload', 'display-change'].map((type) => ({ type }));
  const hidden = createPanelLifecycle();
  assert.equal(run(noise, hidden).visible, false);
  const visible = run([{ type: 'writing', key: 'a' }]);
  assert.equal(visible.visible, true);
  const afterNoise = run(noise, visible);
  assert.deepEqual(afterNoise, visible);
  assert.deepEqual(panelWindowOps(visible, afterNoise), []);
});

test('typing, pausing and continuing in the same field produces exactly one show and no hide', () => {
  let state = createPanelLifecycle();
  const ops = [];
  for (const event of [
    { type: 'focus' }, { type: 'writing', key: 'a' }, { type: 'loading' }, { type: 'writing', key: 'a' },
    { type: 'field-gap' }, { type: 'result' }, { type: 'writing', key: 'a' }, { type: 'blur' }, { type: 'writing', key: 'a' },
  ]) {
    const next = reducePanel(state, event);
    ops.push(...panelWindowOps(state, next));
    state = next;
  }
  assert.deepEqual(ops, ['show-inactive']);
});

test('a dismissal holds for the dismissed field and is not fought by later edits there', () => {
  let state = run([{ type: 'writing', key: 'a' }, { type: 'dismiss', key: 'a' }]);
  assert.equal(state.visible, false);
  state = run([{ type: 'writing', key: 'a' }, { type: 'app-switch' }, { type: 'writing', key: 'a' }, { type: 'focus' }], state);
  assert.equal(state.visible, false);
  const elsewhere = reducePanel(state, { type: 'writing', key: 'b' });
  assert.equal(elsewhere.visible, true, 'a genuine edit in a different field is a new writing context');
  const restored = reducePanel(state, { type: 'restore' });
  assert.equal(restored.visible, true);
  assert.equal(restored.dismissedKey, null);
});

test('pause hides the companion; resume does not pop it back until the user writes or restores', () => {
  let state = run([{ type: 'writing', key: 'a' }, { type: 'monitoring', active: false }]);
  assert.equal(state.visible, false);
  state = reducePanel(state, { type: 'monitoring', active: true });
  assert.equal(state.visible, false);
  assert.equal(reducePanel(state, { type: 'writing', key: 'a' }).visible, true);
  assert.equal(reducePanel(state, { type: 'restore' }).visible, true);
});

test('manual sessions take focus only when explicitly opened and return to the companion afterwards', () => {
  const companion = run([{ type: 'writing', key: 'a' }]);
  const manual = reducePanel(companion, { type: 'manual-open' });
  assert.deepEqual(panelWindowOps(companion, manual), ['focus']);
  const done = reducePanel(manual, { type: 'manual-done', monitoring: true });
  assert.equal(done.visible, true);
  assert.equal(done.mode, 'companion');
  assert.deepEqual(panelWindowOps(manual, done), []);

  const fromHidden = reducePanel(createPanelLifecycle(), { type: 'manual-open' });
  assert.deepEqual(panelWindowOps(createPanelLifecycle(), fromHidden), ['show-focus']);
  const closed = reducePanel(fromHidden, { type: 'dismiss' });
  assert.equal(closed.visible, false);
  assert.equal(closed.dismissedKey, null, 'closing a manual popup is not a companion dismissal');
});

test('pinning changes z-order only and companion shows never request focus', () => {
  const state = createPanelLifecycle();
  const unpinned = reducePanel(state, { type: 'pin', pinned: false });
  assert.deepEqual(panelWindowOps(state, unpinned), ['unpin']);
  assert.equal(unpinned.visible, false);
  const shown = reducePanel(unpinned, { type: 'restore' });
  assert.deepEqual(panelWindowOps(unpinned, shown), ['show-inactive', 'raise'], 'an unpinned panel shown on request lands on top');
});

test('unknown events are rejected instead of silently toggling the window', () => {
  assert.throws(() => reducePanel(createPanelLifecycle(), { type: 'force-visible' }), /Unknown panel event/);
});

test('regression: writing in a different field ends a manual selection session in place', () => {
  // Notepad++ selection + shortcut (its editor is not a monitored field: sourceKey ''),
  // then the user types in another app's textbox.
  const manual = reducePanel(createPanelLifecycle(), { type: 'manual-open', sourceKey: '' });
  const noise = run([{ type: 'focus' }, { type: 'blur' }, { type: 'app-switch' }, { type: 'field-gap' }], manual);
  assert.equal(noise.mode, 'manual', 'brief focus changes keep the manual result');
  const live = reducePanel(noise, { type: 'writing', key: 'teams-textbox' });
  assert.equal(live.mode, 'companion');
  assert.equal(live.visible, true);
  assert.equal(live.manualSourceKey, null);
  assert.deepEqual(panelWindowOps(noise, live), [], 'the switch updates content only: no hide, show or focus');
});

test('editing the field the selection came from keeps the manual session', () => {
  const manual = reducePanel(createPanelLifecycle(), { type: 'manual-open', sourceKey: 'npp-field' });
  assert.equal(reducePanel(manual, { type: 'writing', key: 'npp-field' }), manual);
  assert.equal(reducePanel(manual, { type: 'writing', key: 'other' }).mode, 'companion');
});

test('an explicit selection ends an earlier companion dismissal', () => {
  const dismissed = run([{ type: 'writing', key: 'a' }, { type: 'dismiss', key: 'a' }]);
  const manual = reducePanel(dismissed, { type: 'manual-open', sourceKey: '' });
  assert.equal(manual.dismissedKey, null);
  const live = reducePanel(manual, { type: 'writing', key: 'a' });
  assert.equal(live.mode, 'companion');
  assert.equal(live.visible, true);
});

// Regression (Windows repro): the panel was shown and updated with a finished suggestion, but
// it was unpinned and stayed behind the maximized editor, so the writer never saw it.
test('regression: an unpinned panel comes forward (without focus) for new writing and new results', () => {
  let state = createPanelLifecycle({ pinned: false });
  const ops = [];
  const apply = (event) => { const next = reducePanel(state, event); ops.push(...panelWindowOps(state, next)); state = next; };
  apply({ type: 'writing', key: 'a' });
  assert.deepEqual(ops, ['show-inactive', 'raise']);
  ops.length = 0;
  for (let i = 0; i < 10; i += 1) apply({ type: 'writing', key: 'a' });
  ['focus', 'blur', 'app-switch', 'field-gap', 'loading', 'error'].forEach((type) => apply({ type }));
  assert.deepEqual(ops, [], 'continued typing and focus noise do not keep raising the window');
  apply({ type: 'result' });
  assert.deepEqual(ops, ['raise'], 'a new suggestion brings it forward once');
  ops.length = 0;
  apply({ type: 'writing', key: 'b' });
  assert.deepEqual(ops, ['raise'], 'starting to write in another field brings it forward once');
  assert.equal(ops.includes('focus'), false);
});

test('raise is never emitted for a hidden, dismissed, pinned, or manual panel', () => {
  const unpinned = createPanelLifecycle({ pinned: false });
  assert.deepEqual(panelWindowOps(unpinned, reducePanel(unpinned, { type: 'result' })), [], 'hidden: raising would show it (SWP_SHOWWINDOW)');
  const dismissed = run([{ type: 'writing', key: 'a' }, { type: 'dismiss', key: 'a' }], unpinned);
  assert.deepEqual(panelWindowOps(dismissed, run([{ type: 'result' }, { type: 'writing', key: 'a' }], dismissed)), []);
  const pinned = run([{ type: 'writing', key: 'a' }]);
  assert.deepEqual(panelWindowOps(pinned, run([{ type: 'result' }, { type: 'writing', key: 'b' }], pinned)), [], 'always-on-top needs no raise');
  const manual = reducePanel(unpinned, { type: 'manual-open', sourceKey: '' });
  assert.deepEqual(panelWindowOps(manual, reducePanel(manual, { type: 'result' })), []);
});

test('a dismissed field that is restored comes forward again on the next writing', () => {
  let state = run([{ type: 'writing', key: 'a' }, { type: 'dismiss', key: 'a' }, { type: 'restore' }], createPanelLifecycle({ pinned: false }));
  const next = reducePanel(state, { type: 'writing', key: 'a' });
  assert.deepEqual(panelWindowOps(state, next), ['raise']);
});

// Regression: pinned used Electron's default 'floating' level, which Windows-side Electron
// re-inserts behind the taskbar on every activation and can demote out of the topmost band.
test('regression: the pinned level is one Electron keeps above the taskbar (plain HWND_TOPMOST)', () => {
  assert.equal(ELECTRON_BEHIND_TASKBAR_LEVELS.includes(PINNED_TOPMOST_LEVEL), false);
  assert.equal(PINNED_TOPMOST_LEVEL, 'pop-up-menu');
  assert.ok(ELECTRON_BEHIND_TASKBAR_LEVELS.includes('floating'), 'Electron default level is the problematic one');
});

test('topmost repair only for a pinned, visible panel whose native window lost topmost', () => {
  const pinnedVisible = run([{ type: 'writing', key: 'a' }]);
  assert.equal(needsTopmostRepair(pinnedVisible, { visible: true, topmost: false }), true);
  assert.equal(needsTopmostRepair(pinnedVisible, { visible: true, topmost: true }), false);
  assert.equal(needsTopmostRepair(pinnedVisible, { visible: false, topmost: false }), false, 'never shows a hidden window');
  assert.equal(needsTopmostRepair(reducePanel(pinnedVisible, { type: 'pin', pinned: false }), { visible: true, topmost: false }), false, 'unpinned stays a normal window');
  assert.equal(needsTopmostRepair(reducePanel(pinnedVisible, { type: 'dismiss', key: 'a' }), { visible: true, topmost: false }), false);
  assert.equal(needsTopmostRepair(pinnedVisible, undefined), false);
});

test('pinned panel z-order ops across show, manual/live switches, restore and pin toggles', () => {
  let state = createPanelLifecycle({ pinned: true });
  const ops = [];
  const apply = (event) => { const next = reducePanel(state, event); ops.push(...panelWindowOps(state, next)); state = next; };
  apply({ type: 'writing', key: 'a' });
  apply({ type: 'result' });
  apply({ type: 'manual-open', sourceKey: '' });
  apply({ type: 'writing', key: 'b' });
  apply({ type: 'dismiss', key: 'b' });
  apply({ type: 'restore' });
  assert.deepEqual(ops, ['show-inactive', 'focus', 'hide', 'show-inactive'], 'pinned: no moveTop and no z-order changes besides show/hide');
  ops.length = 0;
  apply({ type: 'pin', pinned: false });
  apply({ type: 'pin', pinned: true });
  assert.deepEqual(ops, ['unpin', 'pin']);
});

test('regression: restore brings an already-visible but covered unpinned panel forward', () => {
  const visible = run([{ type: 'writing', key: 'a' }], createPanelLifecycle({ pinned: false }));
  assert.deepEqual(panelWindowOps(visible, reducePanel(visible, { type: 'restore' })), ['raise']);
  const pinned = run([{ type: 'writing', key: 'a' }]);
  assert.deepEqual(panelWindowOps(pinned, reducePanel(pinned, { type: 'restore' })), [], 'pinned is already on top');
});
