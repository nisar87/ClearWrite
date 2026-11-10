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

test('long text is split at paragraph boundaries and findings shift back into place', async () => {
  const { splitForChecking, offsetFindings } = await import('./finding-edits.js');
  const paragraph = 'Please review the report before the meeting starts today. '.repeat(40).trim();
  const text = [paragraph, paragraph, `${paragraph} Teh end.`].join('\n\n');
  const pieces = splitForChecking(text, 6000);
  assert.ok(pieces.length >= 2);
  assert.equal(pieces.map((piece) => piece.text).join(''), text, 'pieces cover the text exactly');
  for (const piece of pieces) {
    assert.ok(piece.text.length <= 6000);
    assert.equal([...text].slice(piece.start, piece.start + [...piece.text].length).join(''), piece.text);
  }
  const last = pieces.at(-1);
  const local = last.text.indexOf('Teh');
  const [moved] = offsetFindings([finding(local, local + 3, ['The'], 0, { start: local, end: local + 3 })], last.start);
  assert.equal(composeText(text, [moved]).endsWith('The end.'), true);
});

test('splitting never breaks an emoji and falls back to word boundaries', async () => {
  const { splitForChecking } = await import('./finding-edits.js');
  const text = '😀word '.repeat(2000);
  const pieces = splitForChecking(text, 1000);
  assert.equal(pieces.map((piece) => piece.text).join(''), text);
  for (const piece of pieces) assert.ok(!/^[\uDC00-\uDFFF]/.test(piece.text) && !/[\uD800-\uDBFF]$/.test(piece.text));
  const unbroken = 'x'.repeat(2500);
  assert.deepEqual(splitForChecking(unbroken, 1000).map((piece) => piece.text.length), [1000, 1000, 500]);
});

test('in-place spans cover whole words, merge edits in one word, and carry same-line context', async () => {
  const { spansForEdits } = await import('./finding-edits.js');
  const text = 'Hello team,\r\nPlease reply soon thanks. Teh end.';
  const soon = text.indexOf('soon') + 4;
  const teh = [...text].join('').indexOf('Teh');
  const spans = spansForEdits(text, [
    { start: soon, end: soon, text: ',' },
    { start: teh, end: teh + 3, text: 'The' },
  ], 10);
  assert.deepEqual(spans, [
    { before: 'ase reply ', original: 'soon', after: ' thanks. ', replacement: 'soon,' },
    { before: ' thanks. ', original: 'Teh', after: ' end.', replacement: 'The' },
  ]);
  for (const span of spans) assert.ok(!/[\r\n]/.test(span.before + span.after), 'context never crosses a line break');
  const merged = spansForEdits('recieve', [{ start: 3, end: 4, text: 'e' }, { start: 4, end: 5, text: 'i' }]);
  assert.deepEqual(merged, [{ before: '', original: 'recieve', after: '', replacement: 'receive' }]);
  assert.deepEqual(spansForEdits('same', [{ start: 0, end: 4, text: 'same' }]), [], 'no-op edits are dropped');
});

test('composing spans gives the same text as composing the edits', async () => {
  const { spansForEdits } = await import('./finding-edits.js');
  const text = 'This is a example, please send teh mesage today.';
  const findings = [
    finding(8, 9, ['an'], 0),
    finding(31, 34, ['the'], 0),
    finding(35, 41, ['message'], 0),
  ];
  const expected = composeText(text, findings);
  let result = text;
  for (const span of spansForEdits(text, chosenEdits(text, findings)).reverse()) {
    const needle = span.before + span.original + span.after;
    assert.equal(result.split(needle).length, 2, 'context is unique');
    result = result.replace(needle, span.before + span.replacement + span.after);
  }
  assert.equal(result, expected);
});
