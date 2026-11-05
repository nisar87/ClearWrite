import assert from 'node:assert/strict';
import test from 'node:test';
import { appendContinuation, hasProofreadableProse, isBrowserAddressField, isEligibleMonitorField, isLiveProofreadCandidate, isPendingMonitorTextEdit, isReadyForLiveProofread, isSamePendingMonitorText, isUserEditSnapshot, MAX_LIVE_DRAFT_LENGTH, prepareLiveDraft, preserveOuterWhitespace, protectUrls, restoreUrls } from './live-proofread.js';

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
  assert.equal(isEligibleMonitorField({ ...edited, changed: false, text: '', controlName: 'Message' }), true);
  assert.equal(isEligibleMonitorField({ ...edited, changed: false, text: 'Existing draft text', controlName: 'Message' }), true);
  assert.equal(isEligibleMonitorField({ ...edited, changed: false, text: 'https://example.com', controlName: 'Address and search bar' }), false);
});

test('editable browser document fields activate immediately on focus', () => {
  const editor = { active: true, editable: true, readOnly: false, text: 'An existing draft in a browser editor.', processName: 'chrome', controlType: 'ControlType.Document', changed: false };
  assert.equal(isEligibleMonitorField(editor), true);
  assert.equal(isEligibleMonitorField({ ...editor, controlName: 'Address and search bar' }), false);
});

test('changing playback and other widget values never qualifies as writing', () => {
  const snapshot = { active: true, changed: true, editable: true, readOnly: false, processName: 'chrome', text: '1 minute 23 seconds of 10 minutes' };
  for (const type of ['Slider', 'ProgressBar', 'ScrollBar', 'Spinner', 'Button', 'CheckBox', 'Hyperlink', 'Custom']) {
    const widget = { ...snapshot, controlType: `ControlType.${type}` };
    assert.equal(isEligibleMonitorField(widget), false, type);
    assert.equal(isLiveProofreadCandidate(widget), false, type);
  }
  for (const type of ['Edit', 'Document', 'ComboBox']) {
    assert.equal(isLiveProofreadCandidate({ ...snapshot, text: 'Please review this sentence.', controlType: `ControlType.${type}` }), true, type);
  }
});

test('temporary focus recovery keeps unchanged suggestions and detects missed edits', () => {
  const pending = { monitor: true, key: 'field-1', text: 'The first version is already quite long.' };
  const resumed = { active: true, changed: false, editable: true, readOnly: false, key: 'field-1', text: pending.text };
  const changedDuringGap = { ...resumed, text: 'The second version is also long enough.' };
  assert.equal(isSamePendingMonitorText(resumed, pending), true);
  assert.equal(isLiveProofreadCandidate(resumed, pending), false);
  assert.equal(isPendingMonitorTextEdit(changedDuringGap, pending), true);
  assert.equal(isLiveProofreadCandidate(changedDuringGap, pending), true);
  assert.equal(isPendingMonitorTextEdit({ ...changedDuringGap, key: 'other-field' }, pending), false);
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

test('suggestions keep the field\'s Windows line endings', async () => {
  const { matchLineEndings } = await import('./live-proofread.js');
  assert.equal(matchLineEndings('One line.\r\nTwo line.', 'One line.\nTwo lines.'), 'One line.\r\nTwo lines.');
  assert.equal(matchLineEndings('One line.\nTwo line.', 'One line.\r\nTwo lines.'), 'One line.\nTwo lines.');
});

test('unsafe AI rewrites are rejected in favour of no suggestion', async () => {
  const { isSafeCorrection } = await import('./live-proofread.js');
  assert.equal(isSafeCorrection('i dont no where it is', "I don't know where it is."), true);
  assert.equal(isSafeCorrection('Please send teh report by friday so we can reveiw it.', 'Please send the report by Friday so we can review it.'), true);
  assert.equal(isSafeCorrection('Please send teh report by friday so we can reveiw it.', "Here's the corrected text: Please send the report by Friday so we can review it."), false);
  assert.equal(isSafeCorrection('Can we meet tomorrow to discuss the budget plan?', 'I would be delighted to schedule a meeting with you at your earliest convenience regarding our finances.'), false);
  assert.equal(isSafeCorrection('Short note here.', ''), false);
  assert.equal(isSafeCorrection('Short.', 'Short.'), true);
});

test('regression: a correct fix of a short, heavily misspelled sentence is not rejected as a rewrite', async () => {
  const { isSafeCorrection } = await import('./live-proofread.js');
  // Exact sentence from the Windows reproduction; Gemini's answer was discarded before.
  assert.equal(isSafeCorrection('i has a eror in this sentense', 'I have an error in this sentence.'), true);
  assert.equal(isSafeCorrection('teh qick brwn fox jumpd ovr teh lazy dog', 'The quick brown fox jumped over the lazy dog.'), true);
  assert.equal(isSafeCorrection('Can we meet tomorrow to discuss the budget plan?', 'Let us schedule a call next week about finances and planning?'), false);
});
