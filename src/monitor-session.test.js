import assert from 'node:assert/strict';
import test from 'node:test';
import { createMonitorSession, shouldAutoHideAssistantOnBlur, transitionMonitorSession } from './monitor-session.js';

const field = (key, text, processName = 'teams') => ({ key, text, processName });

test('monitor panel stays available during focus gaps but manual panels still auto-hide', () => {
  assert.equal(shouldAutoHideAssistantOnBlur({ busy: false, monitoring: true, phase: 'searching', hasMonitorSelection: false }), false);
  assert.equal(shouldAutoHideAssistantOnBlur({ busy: false, monitoring: true, phase: 'idle', hasMonitorSelection: false }), true);
  assert.equal(shouldAutoHideAssistantOnBlur({ busy: false, monitoring: false, phase: 'searching', hasMonitorSelection: false }), true);
  assert.equal(shouldAutoHideAssistantOnBlur({ busy: false, monitoring: true, phase: 'focused', hasMonitorSelection: true }), false);
  assert.equal(shouldAutoHideAssistantOnBlur({ busy: true, monitoring: false, phase: 'idle', hasMonitorSelection: false }), false);
});

test('focus and edits move through explicit phases with stale reviews invalidated', () => {
  let session = createMonitorSession();
  session = transitionMonitorSession(session, { type: 'field', snapshot: field('a', ''), edited: false });
  assert.equal(session.phase, 'focused');
  const firstRevision = session.revision;
  session = transitionMonitorSession(session, { type: 'field', snapshot: field('a', 'A changed message.'), edited: true });
  assert.equal(session.phase, 'editing');
  assert.ok(session.revision > firstRevision);
  const revision = session.revision;
  session = transitionMonitorSession(session, { type: 'reviewing', revision });
  assert.equal(session.phase, 'reviewing');
  session = transitionMonitorSession(session, { type: 'field', snapshot: field('a', 'A changed message.'), edited: false });
  assert.equal(session.phase, 'reviewing');
  session = transitionMonitorSession(session, { type: 'searching' });
  assert.equal(session.phase, 'searching');
  session = transitionMonitorSession(session, { type: 'suggestion', revision });
  assert.equal(session.phase, 'searching');
});

test('dismissal is stable for a field, switching fields clears it, and restore is explicit', () => {
  let session = transitionMonitorSession(createMonitorSession(), { type: 'field', snapshot: field('a', 'Draft'), edited: false });
  session = transitionMonitorSession(session, { type: 'dismiss' });
  session = transitionMonitorSession(session, { type: 'field', snapshot: field('a', 'Updated draft'), edited: true });
  assert.equal(session.phase, 'dismissed');
  session = transitionMonitorSession(session, { type: 'restore' });
  assert.equal(session.phase, 'focused');
  session = transitionMonitorSession(session, { type: 'field', snapshot: field('b', ''), edited: false });
  assert.equal(session.phase, 'focused');
  assert.equal(session.dismissedKey, '');
});

test('same-field focus recovery does not change revision unless returning from search', () => {
  let session = transitionMonitorSession(createMonitorSession(), { type: 'field', snapshot: field('a', 'Draft'), edited: false });
  const revision = session.revision;
  session = transitionMonitorSession(session, { type: 'field', snapshot: field('a', 'Draft'), edited: false });
  assert.equal(session.revision, revision);
  session = transitionMonitorSession(session, { type: 'searching' });
  session = transitionMonitorSession(session, { type: 'field', snapshot: field('a', 'Draft'), edited: false });
  assert.ok(session.revision > revision);
  assert.equal(session.phase, 'focused');
});
