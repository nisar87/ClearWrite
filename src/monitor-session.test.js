import assert from 'node:assert/strict';
import test from 'node:test';
import { createDebouncer, createMonitorSession, LIVE_ACTIONS, MANUAL_ACTIONS, createReviewCache, isCurrentRevision, monitorView, REVIEW_DEBOUNCE_MS, transitionMonitorSession } from './monitor-session.js';

const field = (key, text, extra = {}) => ({ key, text, processName: 'notepad', replaceSupported: true, ...extra });
const step = (session, ...events) => events.reduce((current, event) => transitionMonitorSession(current, event), session);

test('offline skipped checks and unresolved findings are never reported as clean', () => {
  const session = step(createMonitorSession(), { type: 'field', snapshot: field('a', 'Some draft text'), edited: true });
  const viewFor = (suggestion) => monitorView(step(session, { type: 'suggestion', revision: session.revision, suggestion: { text: session.text, source: 'local', ...suggestion } }));
  const skipped = viewFor({ supported: false, note: 'Language is uncertain' });
  assert.equal(skipped.statusLine, 'Offline check skipped');
  assert.notEqual(skipped.status, 'clean');
  const unresolved = viewFor({ supported: true, findings: [{ original: 'draft', appliedLocally: false }], needsChoice: 1 });
  assert.equal(unresolved.statusLine, 'Possible mistakes need your review');
  assert.equal(unresolved.canApply, false);
  assert.equal(unresolved.canCopy, false);
  const clean = viewFor({ supported: true, findings: [], needsChoice: 0 });
  assert.equal(clean.status, 'clean');
});

test('focus and edits move through explicit phases; every edit invalidates older work', () => {
  let session = step(createMonitorSession(), { type: 'field', snapshot: field('a', ''), edited: false });
  assert.equal(session.phase, 'focused');
  const focusRevision = session.revision;
  session = step(session, { type: 'field', snapshot: field('a', 'A changed message.'), edited: true });
  assert.equal(session.phase, 'editing');
  assert.ok(session.revision > focusRevision);
  const revision = session.revision;
  session = step(session, { type: 'reviewing', revision });
  assert.equal(session.phase, 'reviewing');
  session = step(session, { type: 'field', snapshot: field('a', 'A changed message!'), edited: true });
  assert.equal(session.phase, 'editing');
  const stale = step(session, { type: 'suggestion', revision, suggestion: { text: 'old result' } });
  assert.equal(stale.suggestion, null, 'a result for an older draft is ignored');
  assert.equal(stale.phase, 'editing');
});

test('regression: an unchanged snapshot after a UIA gap keeps the in-flight review current', () => {
  let session = step(createMonitorSession(), { type: 'field', snapshot: field('a', 'Teh draft text here.'), edited: true });
  const revision = session.revision;
  session = step(session, { type: 'reviewing', revision });
  session = step(session,
    { type: 'away', reason: 'unsupported' },
    { type: 'field', snapshot: field('a', 'Teh draft text here.', { x: 10 }), edited: false });
  assert.equal(session.revision, revision);
  assert.equal(session.phase, 'reviewing');
  assert.equal(isCurrentRevision(session, revision), true);
  session = step(session, { type: 'suggestion', revision, suggestion: { text: 'The draft text here.' } });
  assert.equal(session.phase, 'suggestion');
});

test('regression: switching apps and coming back keeps the suggestion instead of wiping it', () => {
  let session = step(createMonitorSession(), { type: 'field', snapshot: field('a', 'Teh draft text.'), edited: true });
  const revision = session.revision;
  session = step(session, { type: 'reviewing', revision }, { type: 'suggestion', revision, suggestion: { text: 'The draft text.' } });
  session = step(session, { type: 'away', reason: 'app' }, { type: 'away', reason: 'unsupported' });
  assert.equal(session.phase, 'away');
  assert.equal(session.suggestion.text, 'The draft text.');
  session = step(session, { type: 'field', snapshot: field('a', 'Teh draft text.'), edited: false });
  assert.equal(session.phase, 'suggestion');
  assert.equal(session.revision, revision);
});

test('a result that completes while the user is away is kept for the original field only', () => {
  let session = step(createMonitorSession(), { type: 'field', snapshot: field('a', 'Teh draft.'), edited: true });
  const revision = session.revision;
  session = step(session, { type: 'reviewing', revision }, { type: 'away', reason: 'app' },
    { type: 'suggestion', revision, suggestion: { text: 'The draft.' } });
  assert.equal(session.phase, 'away');
  assert.equal(session.phaseBeforeAway, 'suggestion');
  const other = step(session, { type: 'field', snapshot: field('b', 'Another field.'), edited: false });
  assert.equal(other.suggestion, null, 'a different field never shows the first field\'s result');
  assert.ok(other.revision > revision);
});

test('text changed while away counts as an edit and invalidates the previous suggestion', () => {
  let session = step(createMonitorSession(), { type: 'field', snapshot: field('a', 'Teh draft.'), edited: true });
  const revision = session.revision;
  session = step(session, { type: 'suggestion', revision, suggestion: { text: 'The draft.' } }, { type: 'away', reason: 'app' },
    { type: 'field', snapshot: field('a', 'Teh draft, edited.'), edited: false });
  assert.equal(session.phase, 'editing');
  assert.equal(session.suggestion, null);
});

test('apply and undo bump the revision so in-flight work cannot overwrite them', () => {
  let session = step(createMonitorSession(), { type: 'field', snapshot: field('a', 'Teh draft.'), edited: true });
  let revision = session.revision;
  session = step(session, { type: 'suggestion', revision, suggestion: { text: 'The draft.' } }, { type: 'applied', revision, text: 'The draft.' });
  assert.equal(session.phase, 'applied');
  assert.equal(session.text, 'The draft.');
  assert.deepEqual(session.applied, { before: 'Teh draft.', after: 'The draft.' });
  assert.equal(step(session, { type: 'suggestion', revision, suggestion: { text: 'late' } }).phase, 'applied');
  revision = session.revision;
  session = step(session, { type: 'undone', revision });
  assert.equal(session.text, 'Teh draft.');
  assert.equal(session.applied, null);
});

test('focusing a field without editing does not echo its content into the panel', () => {
  const session = step(createMonitorSession(), { type: 'field', snapshot: field('r', 'An email I am only reading.'), edited: false });
  const view = monitorView(session);
  assert.equal(view.text, '');
  assert.equal(view.suggestion, null);
  assert.equal(view.canCopy, false);
});

test('the companion view never exposes a suggestion for another revision and disables unsafe actions', () => {
  let session = step(createMonitorSession(), { type: 'field', snapshot: field('a', 'Teh draft.'), edited: true });
  const revision = session.revision;
  session = step(session, { type: 'reviewing', revision });
  let view = monitorView(session, { connected: true, provider: 'gemini' });
  assert.equal(view.status, 'working');
  assert.equal(view.text, 'Teh draft.', 'current text stays visible while analysis runs');
  assert.equal(view.canApply, false);
  assert.equal(view.canCopy, false);
  session = step(session, { type: 'suggestion', revision, suggestion: { text: 'The draft.', source: 'ai' } });
  view = monitorView(session, { connected: true });
  assert.equal(view.canApply, true);
  assert.equal(view.canCopy, true);
  const clean = monitorView(step(session, { type: 'field', snapshot: field('a', 'The draft.'), edited: true }));
  assert.equal(clean.suggestion, null);
  const document = monitorView(step(createMonitorSession(), { type: 'field', snapshot: field('d', 'Teh doc.', { replaceSupported: false }), edited: true }, { type: 'suggestion', revision: 1, suggestion: { text: 'The doc.' } }));
  assert.equal(document.canApply, false, 'documents are copy-only to avoid replacing more than intended');
  assert.equal(document.canCopy, true);
});

test('review cache deduplicates per field and evicts least recently used drafts', () => {
  const cache = createReviewCache(2);
  cache.set('a', 'one', 1);
  cache.set('a', 'two', 2);
  assert.equal(cache.get('a', 'one'), 1);
  cache.set('b', 'one', 3);
  assert.equal(cache.get('a', 'two'), undefined);
  assert.equal(cache.get('a', 'one'), 1);
  assert.equal(cache.get('b', 'one'), 3);
  assert.equal(cache.get('c', 'one'), undefined);
});

// A tiny deterministic clock passed to createDebouncer(delay, timers). It avoids
// node:test MockTimers, whose enable() signature differs between Node releases.
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) { const id = nextId++; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = until;
    },
  };
}

test('debounce sends one request after the writer pauses, not one per keystroke', () => {
  const clock = fakeClock();
  const debouncer = createDebouncer(REVIEW_DEBOUNCE_MS, clock);
  let calls = 0;
  for (let key = 0; key < 20; key += 1) {
    debouncer.schedule(() => { calls += 1; });
    clock.tick(180);
  }
  assert.equal(calls, 0);
  assert.equal(debouncer.pending, true);
  clock.tick(REVIEW_DEBOUNCE_MS);
  assert.equal(calls, 1);
  assert.equal(debouncer.pending, false);
  debouncer.schedule(() => { calls += 1; });
  debouncer.cancel();
  clock.tick(REVIEW_DEBOUNCE_MS * 2);
  assert.equal(calls, 1, 'cancel (field change, dismiss, pause) drops the pending request');
});

test('live-field actions are offered with usable text and never include Suggest a reply', () => {
  assert.deepEqual([...LIVE_ACTIONS], ['correct', 'clearer', 'professional', 'friendly']);
  assert.ok(MANUAL_ACTIONS.includes('reply'));
  assert.equal(LIVE_ACTIONS.includes('reply'), false);
  const focused = monitorView(step(createMonitorSession(), { type: 'field', snapshot: field('a', 'Text I am only reading here.'), edited: false }));
  assert.deepEqual(focused.actions, [], 'no actions for a field that was only focused');
  let session = step(createMonitorSession(), { type: 'field', snapshot: field('a', 'Teh draft I am writing.'), edited: true });
  const editing = monitorView(session, { connected: true });
  assert.deepEqual(editing.actions, [...LIVE_ACTIONS]);
  assert.equal(editing.revision, session.revision, 'the view carries the revision an action must target');
  const revision = session.revision;
  session = step(session, { type: 'suggestion', revision, suggestion: { source: 'ai', action: 'clearer', text: 'The draft I am writing, rephrased.' } });
  const result = monitorView(session, { connected: true });
  assert.deepEqual(result.actions, [...LIVE_ACTIONS], 'actions stay available after a result');
});

test('a rewrite result is tied to its revision and is copy-only for documents', () => {
  let session = step(createMonitorSession(), { type: 'field', snapshot: field('d', 'Teh whole document text.', { replaceSupported: false }), edited: true });
  const revision = session.revision;
  session = step(session, { type: 'reviewing', revision });
  const edited = step(session, { type: 'field', snapshot: field('d', 'Teh whole document text!', { replaceSupported: false }), edited: true });
  assert.equal(step(edited, { type: 'suggestion', revision, suggestion: { source: 'ai', action: 'professional', text: 'Old rewrite.' } }).suggestion, null);
  const done = monitorView(step(session, { type: 'suggestion', revision, suggestion: { source: 'ai', action: 'professional', text: 'The whole document text, polished.' } }));
  assert.equal(done.canCopy, true);
  assert.equal(done.canApply, false);
});

test('regression: a remote session explains why no panel appears instead of a generic wait', () => {
  const session = transitionMonitorSession(createMonitorSession(), { type: 'away', reason: 'remote' });
  assert.match(monitorView(session).statusLine, /Remote Desktop/);
});

test('the editing status only promises a check for text that will actually be checked', () => {
  const at = (text) => monitorView(transitionMonitorSession(transitionMonitorSession(createMonitorSession(), { type: 'field', snapshot: field('a', 'Some earlier draft text.'), edited: false }), { type: 'field', snapshot: field('a', text), edited: true }));
  assert.match(at('').statusLine, /Start typing/);
  assert.equal(at('').status, 'quiet');
  assert.match(at('Hi').statusLine, /Keep typing/);
  assert.match(at('i has a eror in this sentense').statusLine, /Will check when you pause/);
});

test('rich documents offer Apply fixes only for suggestions made of individual edits', async () => {
  const { supportsSpanApply } = await import('./monitor-session.js');
  const doc = { replaceSupported: false, reader: 'text', runtimeId: '42.7' };
  assert.equal(supportsSpanApply(doc), true);
  assert.equal(supportsSpanApply({ ...doc, reader: 'uia3-value' }), false, 'UIA3 runtime ids cannot be matched by the helper');
  assert.equal(supportsSpanApply({ ...doc, replaceSupported: true }), false);
  const edits = [{ original: 'Teh', suggestions: ['The'], edits: [{ start: 0, end: 3, text: 'The' }], choice: 0 }];
  const withEdits = monitorView(step(createMonitorSession(), { type: 'field', snapshot: field('d', 'Teh doc.', doc), edited: true }, { type: 'suggestion', revision: 1, suggestion: { text: 'The doc.', findings: edits } }));
  assert.equal(withEdits.canApply, true);
  assert.equal(withEdits.applyMode, 'spans');
  const rewrite = monitorView(step(createMonitorSession(), { type: 'field', snapshot: field('d', 'Teh doc.', doc), edited: true }, { type: 'suggestion', revision: 1, suggestion: { text: 'The document.', findings: [] } }));
  assert.equal(rewrite.canApply, false, 'whole rewrites stay copy-only in documents');
});
