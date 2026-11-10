import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseOption, chosenEdits, composeText, diffSpan, hasEdits, mapFindingsFromProtected, unresolvedCount } from './finding-edits.js';
import { protectUrls } from './live-proofread.js';

const finding = (start, end, options, choice = -1, extra = {}) => ({
  original: 'x', suggestions: options, edits: options.map((text) => ({ start, end, text })), choice, ignored: false, ...extra,
});

test('diffSpan finds the smallest replaced, inserted or removed range in code points', () => {
  assert.deepEqual(diffSpan('This is a example.', 'This is an example.'), { start: 9, end: 9, text: 'n' });
  assert.deepEqual(diffSpan('Hello  world', 'Hello world'), { start: 6, end: 7, text: '' });
  assert.deepEqual(diffSpan('😀 teh cat', '😀 the cat'), { start: 3, end: 5, text: 'he' });
  assert.deepEqual(diffSpan('same', 'same'), { start: 4, end: 4, text: '' });
});

test('only chosen options are applied, so one fix can be accepted without the others', () => {
  const text = 'Teh cat sat on teh mat.';
  const findings = [finding(0, 3, ['The'], 0), finding(15, 18, ['the', 'tea'])];
  assert.equal(composeText(text, findings), 'The cat sat on teh mat.');
  const both = chooseOption(findings, 1, 1);
  assert.equal(composeText(text, both), 'The cat sat on tea mat.');
  const firstIgnored = chooseOption(both, 0, 'ignore');
  assert.equal(composeText(text, firstIgnored), 'Teh cat sat on tea mat.');
  assert.equal(unresolvedCount(findings), 1);
  assert.equal(unresolvedCount(firstIgnored), 0);
  const cleared = chooseOption(firstIgnored, 0, -1);
  assert.equal(cleared[0].ignored, false);
  assert.equal(composeText(text, cleared), 'Teh cat sat on tea mat.');
  assert.equal(findings[0].choice, 0, 'the original findings are not mutated');
});

test('emoji and Windows line endings survive composition untouched', () => {
  const text = '😀 Teh cat.\r\nSecond lnie.';
  const findings = [finding(2, 5, ['The'], 0), finding(19, 23, ['line'], 0)];
  assert.equal(composeText(text, findings), '😀 The cat.\r\nSecond line.');
});

test('overlapping chosen edits never corrupt the text: the earlier one wins', () => {
  const text = 'abcdef';
  const findings = [finding(1, 4, ['X'], 0), finding(2, 5, ['Y'], 0), finding(5, 5, ['!'], 0), finding(5, 5, ['?'], 0)];
  assert.deepEqual(chosenEdits(text, findings).map((edit) => edit.text), ['X', '!']);
  assert.equal(composeText(text, findings), 'aXe!f');
});

test('invalid choices and out-of-range edits are rejected or ignored', () => {
  const findings = [finding(0, 3, ['The'])];
  assert.throws(() => chooseOption(findings, 3, 0), /no longer available/);
  assert.throws(() => chooseOption(findings, 0, 5), /no longer available/);
  assert.equal(composeText('ab', [finding(0, 9, ['zz'], 0)]), 'ab');
  assert.equal(hasEdits([]), false);
  assert.equal(hasEdits([{ original: 'x' }]), false);
});

test('offsets from a URL-protected draft map back to the original text', () => {
  const original = 'See https://example.com/a?b=c for teh details.';
  const draft = protectUrls(original);
  assert.notEqual(draft.input, original);
  const at = [...draft.input].join('').indexOf('teh');
  const mapped = mapFindingsFromProtected([finding(at, at + 3, ['the'], 0, { start: at, end: at + 3 })], draft);
  assert.equal(mapped[0].start, original.indexOf('teh'));
  assert.equal(composeText(original, mapped), 'See https://example.com/a?b=c for the details.');
});

test('edits that touch a protected URL placeholder are dropped', () => {
  const original = 'Open https://example.com now.';
  const draft = protectUrls(original);
  const tokenStart = draft.input.indexOf('__CLEARWRITE');
  const mapped = mapFindingsFromProtected([
    finding(tokenStart, tokenStart + 4, ['oops'], 0, { start: tokenStart, end: tokenStart + 4 }),
    { ...finding(0, 4, ['Opens', 'Open it'], 0), start: 0, end: 4, edits: [{ start: 0, end: 4, text: 'Opens' }, { start: 0, end: tokenStart + 2, text: 'bad' }] },
  ], draft);
  assert.equal(mapped.length, 1);
  assert.deepEqual(mapped[0].suggestions, ['Opens']);
  assert.equal(composeText(original, mapped), 'Opens https://example.com now.');
});
