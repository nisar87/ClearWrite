import assert from 'node:assert/strict';
import test from 'node:test';
import { appendContinuation, isReadyForLiveProofread, isUserEditSnapshot, MAX_LIVE_DRAFT_LENGTH, prepareLiveDraft, preserveOuterWhitespace } from './live-proofread.js';

test('live drafts trim surrounding whitespace and wait for enough context', () => {
  assert.equal(prepareLiveDraft('  A short draft.  '), 'A short draft.');
  assert.equal(isReadyForLiveProofread('A short dra'), false);
  assert.equal(isReadyForLiveProofread('A short draft.'), true);
});

test('live drafts reject non-text and enforce a bounded request size', () => {
  assert.throws(() => prepareLiveDraft(null), /plain text/);
  assert.throws(() => prepareLiveDraft('x'.repeat(MAX_LIVE_DRAFT_LENGTH + 1)), /limited to/);
});

test('live monitoring requires an actual text edit, not focus on readable content', () => {
  assert.equal(isUserEditSnapshot({ active: true, changed: false }), false);
  assert.equal(isUserEditSnapshot({ active: true, changed: true, editable: true, readOnly: true }), false);
  assert.equal(isUserEditSnapshot({ active: true, changed: true, editable: false, readOnly: false }), false);
  assert.equal(isUserEditSnapshot({ active: true, changed: true, editable: true, readOnly: false }), true);
  assert.equal(isUserEditSnapshot({ active: true, changed: true, readOnly: false }), false);
});

test('continuations preserve the original selection and avoid awkward spacing', () => {
  assert.equal(appendContinuation('This is a start', 'and it continues.'), 'This is a start and it continues.');
  assert.equal(appendContinuation('This is a start ', 'and it continues.'), 'This is a start and it continues.');
  assert.equal(appendContinuation('Wait', ', please.'), 'Wait, please.');
  assert.equal(appendContinuation('Already complete.', ''), 'Already complete.');
  assert.equal(appendContinuation('Existing text', 'Existing text and more.'), 'Existing text and more.');
});

test('corrections preserve the user text field’s outer whitespace', () => {
  assert.equal(preserveOuterWhitespace('  teh word  ', 'the word'), '  the word  ');
  assert.equal(preserveOuterWhitespace('\nwrong\t', 'right\n'), '\nright\t');
});
