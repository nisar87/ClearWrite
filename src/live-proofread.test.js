import assert from 'node:assert/strict';
import test from 'node:test';
import { appendContinuation, hasProofreadableProse, isBrowserAddressField, isLiveProofreadCandidate, isReadyForLiveProofread, isUserEditSnapshot, MAX_LIVE_DRAFT_LENGTH, prepareLiveDraft, preserveOuterWhitespace, protectUrls, restoreUrls } from './live-proofread.js';

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

test('live monitoring ignores URL-only input and browser address bars', () => {
  const edited = { active: true, changed: true, editable: true, readOnly: false, processName: 'chrome' };
  assert.equal(isLiveProofreadCandidate({ ...edited, text: 'https://example.com/search?q=hello' }), false);
  assert.equal(isLiveProofreadCandidate({ ...edited, text: 'Please visit https://example.com/search?q=hello' }), true);
  assert.equal(isLiveProofreadCandidate({ ...edited, text: 'Please fix this sentence', controlName: 'Address and search bar' }), false);
  assert.equal(isBrowserAddressField({ processName: 'msedge.exe', automationId: 'AddressBar' }), true);
  assert.equal(isLiveProofreadCandidate({ ...edited, text: 'Please fix this sentence', controlName: 'Message' }), true);
});

test('sentence-like text is distinguished from URLs and non-prose', () => {
  assert.equal(hasProofreadableProse('www.example.com/path?q=1'), false);
  assert.equal(hasProofreadableProse('user@example.com'), false);
  assert.equal(hasProofreadableProse('Please correct this sentence and keep https://example.com intact.'), true);
});

test('URL shielding restores exact links and falls back safely if a marker is lost', () => {
  const original = 'Please check teh details at https://example.com/a?x=1&y=two. Thanks.';
  const protectedDraft = protectUrls(original);
  assert.equal(protectedDraft.urls.length, 1);
  assert.equal(protectedDraft.input.includes('https://example.com'), false);
  const corrected = protectedDraft.input.replace('teh', 'the');
  assert.equal(restoreUrls(corrected, protectedDraft), 'Please check the details at https://example.com/a?x=1&y=two. Thanks.');
  assert.equal(restoreUrls('Please check the details.', protectedDraft), original);
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
