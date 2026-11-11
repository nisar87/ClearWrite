import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { countWords, createWritingStats, dayKey, emptyStats, parseStatsFile, prune, recordDecisions, recordReview, snippet, summarize, CHART_DAYS } from './writing-stats.js';

const NOW = new Date(2026, 10, 11, 15, 0, 0).getTime();
const TEXT = 'I recieve the file yesterday and it were to large.';
const spelling = { kind: 'Spelling', original: 'recieve', edits: [{ start: 2, end: 9, text: 'receive' }], choice: 0, start: 2, end: 9 };
const grammar = { kind: 'Grammar', original: 'were', edits: [{ start: 36, end: 40, text: 'was' }], choice: 0, start: 36, end: 40 };

test('counts words including contractions and numbers', () => {
  assert.equal(countWords("It's 5 o'clock, isn't it?"), 5);
  assert.equal(countWords(''), 0);
});

test('re-checking the same field while typing does not count words or mistakes twice', () => {
  const stats = emptyStats();
  recordReview(stats, 'notepad#1', 'I recieve the', [spelling], NOW);
  recordReview(stats, 'notepad#1', TEXT, [spelling, grammar], NOW);
  recordReview(stats, 'notepad#1', TEXT, [spelling, grammar], NOW);
  const today = stats.days[dayKey(NOW)];
  assert.equal(today.words, countWords(TEXT));
  assert.equal(today.found, 2);
  recordReview(stats, 'teams#2', 'hello there', [], NOW);
  assert.equal(stats.days[dayKey(NOW)].words, countWords(TEXT) + 2);
});

test('learned suggestions are not counted as mistakes found', () => {
  const stats = emptyStats();
  recordReview(stats, 'f', TEXT, [{ ...spelling, source: 'learned' }], NOW);
  assert.equal(stats.days[dayKey(NOW)].found, 0);
});

test('decisions count fixes and dismissals and keep a history snippet', () => {
  const stats = emptyStats();
  assert.equal(recordDecisions(stats, TEXT, [spelling, { ...grammar, ignored: true, choice: -1 }], { app: 'notepad', now: NOW }), true);
  const today = stats.days[dayKey(NOW)];
  assert.equal(today.fixed, 1);
  assert.equal(today.dismissed, 1);
  assert.equal(stats.history.length, 1);
  assert.deepEqual({ ...stats.history[0], id: 'x' }, { id: 'x', at: NOW, app: 'notepad', kind: 'Spelling', lead: 'I ', from: 'recieve', to: 'receive', tail: ' the file yesterday and it were…' });
  assert.deepEqual(stats.mistakes.map(({ from, to, count }) => ({ from, to, count })), [{ from: 'recieve', to: 'receive', count: 1 }]);
});

test('findings left unchosen are neither fixed nor dismissed', () => {
  const stats = emptyStats();
  assert.equal(recordDecisions(stats, TEXT, [{ ...spelling, choice: -1 }], { now: NOW }), false);
  assert.equal(stats.days[dayKey(NOW)].fixed, 0);
});

test('history can be turned off: fixes still count but no text is kept', () => {
  const stats = { ...emptyStats(), historyEnabled: false };
  recordDecisions(stats, TEXT, [spelling], { now: NOW });
  assert.equal(stats.history.length, 0);
  assert.equal(stats.days[dayKey(NOW)].fixed, 1);
});

test('snippets are trimmed to whole words with ellipses', () => {
  const long = `${'alpha '.repeat(12)}teh ${'omega '.repeat(12)}`.trim();
  const start = long.indexOf('teh');
  const part = snippet(long, start, start + 3, 'the');
  assert.ok(part.lead.startsWith('…') && part.tail.endsWith('…'));
  assert.match(part.lead, /^…alpha /);
  assert.match(part.tail, / omega…$/);
  assert.equal(part.from, 'teh');
  assert.ok(part.lead.length <= 34 && part.tail.length <= 34);
});

test('the summary covers 30 days ending today, with totals and accept rate', () => {
  const stats = emptyStats();
  recordReview(stats, 'f', TEXT, [spelling, grammar], NOW);
  recordDecisions(stats, TEXT, [spelling, { ...grammar, ignored: true }], { now: NOW });
  recordDecisions(stats, TEXT, [spelling], { now: NOW - 3 * 86400000 });
  const summary = summarize(stats, NOW);
  assert.equal(summary.days.length, CHART_DAYS);
  assert.equal(summary.days.at(-1).day, dayKey(NOW));
  assert.equal(summary.days.at(-4).fixed, 1);
  assert.deepEqual(summary.today, { words: countWords(TEXT), found: 2, fixed: 1, dismissed: 1 });
  assert.equal(summary.month.fixed, 2);
  assert.equal(summary.month.acceptRate, 67);
  assert.deepEqual(summary.top[0], { from: 'recieve', to: 'receive', count: 2 });
  assert.equal(summarize(emptyStats(), NOW).month.acceptRate, null);
});

test('history in the summary is newest first', () => {
  const stats = emptyStats();
  recordDecisions(stats, TEXT, [spelling], { now: NOW - 5000 });
  recordDecisions(stats, TEXT, [grammar], { now: NOW });
  stats.history.reverse();
  assert.deepEqual(summarize(stats, NOW).history.map((item) => item.to), ['was', 'receive']);
});

test('old days and history are pruned after 90 days', () => {
  const stats = emptyStats();
  recordDecisions(stats, TEXT, [spelling], { now: NOW - 100 * 86400000 });
  recordDecisions(stats, TEXT, [spelling], { now: NOW });
  prune(stats, NOW);
  assert.deepEqual(Object.keys(stats.days), [dayKey(NOW)]);
  assert.equal(stats.history.length, 1);
});

test('a damaged or hostile file is read safely', () => {
  const stats = parseStatsFile(JSON.stringify({ days: { 'not-a-day': {}, '2026-11-11': { words: '12', fixed: -4, fields: { a: 3, b: 'x' } } }, history: [{ id: 1 }, { id: 'ok', at: NOW, from: 'a', to: 'b' }], mistakes: [{ from: 'x' }] }));
  assert.deepEqual(Object.keys(stats.days), ['2026-11-11']);
  assert.equal(stats.days['2026-11-11'].words, 12);
  assert.equal(stats.days['2026-11-11'].fixed, 0);
  assert.deepEqual(stats.days['2026-11-11'].fields, { a: 3 });
  assert.equal(stats.history.length, 1);
  assert.equal(stats.mistakes.length, 0);
});

test('the store saves, reloads, turns history off and clears it', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cw-stats-'));
  try {
    const store = createWritingStats(directory);
    await store.load();
    store.review('f', TEXT, [spelling]);
    assert.equal(await store.decide(TEXT, [spelling], { app: 'notepad' }), true);
    const again = createWritingStats(directory);
    const loaded = await again.load();
    assert.equal(loaded.today.fixed, 1);
    assert.equal(loaded.history.length, 1);
    assert.equal(again.entry(loaded.history[0].id).to, 'receive');
    await again.removeEntry(loaded.history[0].id);
    assert.equal(again.summary().history.length, 0);
    await again.decide(TEXT, [spelling], {});
    await again.setHistoryEnabled(false);
    const saved = JSON.parse(await readFile(path.join(directory, 'writing-stats.json'), 'utf8'));
    assert.equal(saved.historyEnabled, false);
    assert.equal(saved.history.length, 0);
    assert.equal(again.summary().today.fixed, 2);
    await again.setHistoryEnabled(true);
    await again.decide(TEXT, [spelling], {});
    await again.resetStats();
    assert.equal(again.summary().today.fixed, 0);
    assert.equal(again.summary().history.length, 1, 'resetting stats keeps the history');
    assert.equal(again.summary().historyEnabled, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
