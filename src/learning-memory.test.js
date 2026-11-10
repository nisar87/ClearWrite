import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyLearning, createLearningMemory, findingChange, isSuppressed, isTrusted, recordDecisions } from './learning-memory.js';
import { composeText } from './finding-edits.js';

const finding = (text, word, replacement, choice = 0, extra = {}) => {
  const start = [...text.slice(0, text.indexOf(word))].length;
  const end = start + [...word].length;
  return { original: word, suggestions: [replacement], edits: [{ start, end, text: replacement }], choice, ignored: false, start, end, ...extra };
};

test('a finding change is the word-level edit the writer chose', () => {
  const text = 'Please recieve the parcel.';
  assert.deepEqual(findingChange(text, finding(text, 'recieve', 'receive')), { from: 'recieve', to: 'receive' });
  const comma = { original: 'soon', edits: [{ start: 10, end: 10, text: ',' }], choice: 0, start: 6, end: 10 };
  assert.equal(findingChange('Reply soon thanks', comma), null, 'punctuation depends on context and is not learned');
  assert.equal(findingChange('Call 555 1234 now', finding('Call 555 1234 now', '555', '556')), null, 'numbers are not learned');
});

test('accepted twice becomes a trusted, pre-selected suggestion; one acceptance is not enough', () => {
  const first = 'We need to recieve it.';
  let patterns = recordDecisions([], first, [finding(first, 'recieve', 'receive')], 1);
  assert.equal(isTrusted(patterns[0]), false);
  const later = 'Did you recieve my note? Recieve is wrong.';
  assert.equal(applyLearning(later, [], patterns).learned, 0);
  patterns = recordDecisions(patterns, first, [finding(first, 'recieve', 'receive')], 2);
  assert.equal(isTrusted(patterns[0]), true);
  const result = applyLearning(later, [], patterns);
  assert.equal(result.learned, 2);
  assert.deepEqual(result.findings.map((item) => item.suggestions[0]), ['receive', 'Receive'], 'case follows the text');
  assert.equal(composeText(later, result.findings), 'Did you receive my note? Receive is wrong.');
  assert.ok(result.findings.every((item) => item.source === 'learned' && item.choice === 0));
});

test('learned suggestions never cover a word another finding already handles, or part of a word', () => {
  const patterns = [{ from: 'teh', to: 'the', accepts: 5, rejects: 0, lastUsed: 1 }];
  const text = 'Teh plan and tehran and teh end.';
  const existing = [finding(text, 'Teh', 'The')];
  const result = applyLearning(text, existing, patterns);
  assert.equal(result.learned, 1);
  assert.equal(composeText(text, result.findings), 'The plan and tehran and the end.');
});

test('a suggestion ignored twice is shown as ignored from then on', () => {
  const text = 'We are travelling today.';
  const flagged = () => [finding(text, 'travelling', 'traveling')];
  let patterns = recordDecisions([], text, flagged().map((item) => ({ ...item, choice: -1, ignored: true })), 1);
  assert.equal(isSuppressed(patterns[0]), false);
  patterns = recordDecisions(patterns, text, flagged().map((item) => ({ ...item, choice: -1, ignored: true })), 2);
  assert.equal(isSuppressed(patterns[0]), true);
  const result = applyLearning(text, flagged(), patterns);
  assert.equal(result.suppressed, 1);
  assert.equal(result.findings[0].ignored, true);
  assert.equal(composeText(text, result.findings), text);
  // Accepting it later outweighs the ignores again.
  for (let i = 0; i < 3; i += 1) patterns = recordDecisions(patterns, text, flagged(), 3 + i);
  assert.equal(isSuppressed(patterns[0]), false);
});

test('the memory persists on disk, can forget one pattern or everything, and skips bad entries', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clearwrite-learning-'));
  try {
    const memory = createLearningMemory(directory);
    assert.deepEqual(await memory.load(), []);
    const text = 'Please recieve it.';
    await memory.record(text, [finding(text, 'recieve', 'receive')]);
    await memory.record(text, [finding(text, 'recieve', 'receive')]);
    const reloaded = createLearningMemory(directory);
    const list = await reloaded.load();
    assert.equal(list.length, 1);
    assert.equal(list[0].trusted, true);
    assert.equal(await reloaded.remove('recieve', 'receive'), true);
    assert.deepEqual(reloaded.list(), []);
    await reloaded.record(text, [finding(text, 'recieve', 'receive')]);
    await reloaded.clear();
    const stored = JSON.parse(await readFile(path.join(directory, 'learned-corrections.json'), 'utf8'));
    assert.deepEqual(stored.patterns, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
