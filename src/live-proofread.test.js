import assert from 'node:assert/strict';
import test from 'node:test';
import { isReadyForLiveProofread, isUserEditSnapshot, MAX_LIVE_DRAFT_LENGTH, prepareLiveDraft } from './live-proofread.js';

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
  assert.equal(isUserEditSnapshot({ active: true, changed: true, readOnly: true }), false);
  assert.equal(isUserEditSnapshot({ active: true, changed: true, readOnly: false }), true);
});
