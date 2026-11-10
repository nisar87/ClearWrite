import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correctByParagraph, createParagraphCache, splitParagraphs } from './paragraph-review.js';
import { createProofreadingRouter } from './proofreading-mode.js';

const fix = (text) => text.replace(/teh/g, 'the').replace(/recieve/g, 'receive');

test('paragraphs and their exact separators are preserved', () => {
  const text = '  Hello teh team,\r\n\r\nPlease recieve this.\n  \nThanks\n';
  const pieces = splitParagraphs(text);
  assert.equal(pieces.map((piece) => piece.value).join(''), text);
  assert.deepEqual(pieces.filter((piece) => !piece.separator).map((piece) => piece.core), ['Hello teh team,', 'Please recieve this.', 'Thanks']);
});

test('only changed paragraphs are sent again', async () => {
  const cache = createParagraphCache();
  const sent = [];
  const correct = async (paragraph) => { sent.push(paragraph); return fix(paragraph); };
  const first = 'Please send teh report today.\n\nI will recieve the files tomorrow morning.\n\nThanks for teh help with this.';
  const one = await correctByParagraph(first, { correct, cache, cacheKey: 'gemini:model' });
  assert.equal(one.output, fix(first));
  assert.equal(one.sent, 3);
  sent.length = 0;
  const edited = first.replace('tomorrow morning', 'on Friday morning');
  const two = await correctByParagraph(edited, { correct, cache, cacheKey: 'gemini:model' });
  assert.deepEqual(sent, ['I will recieve the files on Friday morning.'], 'unchanged paragraphs are reused');
  assert.equal(two.reused, 2);
  assert.equal(two.output, fix(edited));
  sent.length = 0;
  await correctByParagraph(edited, { correct, cache, cacheKey: 'chatgpt:other' });
  assert.equal(sent.length, 3, 'a different provider or model does not reuse results');
});

test('a paragraph answered with commentary or a rewrite keeps its original text', async () => {
  const text = 'Please send teh report by friday.\n\nThe meeting is at noon tomorrow in room four.';
  const correct = async (paragraph) => (paragraph.startsWith('Please')
    ? 'Sure! Here is the corrected text: Please send the report by Friday.'
    : 'Completely different words with nothing in common whatsoever here at all, truly.');
  const review = await correctByParagraph(text, { correct, cache: createParagraphCache() });
  assert.equal(review.output, text);
});

test('short non-prose pieces (greetings, sign-offs) are not sent', async () => {
  const sent = [];
  const review = await correctByParagraph('Hi Sam,\n\nPlease review teh attached draft today.\n\nBest', {
    correct: async (paragraph) => { sent.push(paragraph); return fix(paragraph); }, cache: createParagraphCache(),
  });
  assert.deepEqual(sent, ['Please review teh attached draft today.']);
  assert.equal(review.output, 'Hi Sam,\n\nPlease review the attached draft today.\n\nBest');
});

test('each paragraph request still goes through the Offline only gate', async () => {
  let mode = 'ai';
  const calls = [];
  const router = createProofreadingRouter({ getMode: () => mode, isAiReady: () => true, sendToProvider: async (action, text) => { calls.push(text); return fix(text); } });
  const text = 'Please send teh report today.\n\nI will recieve the files tomorrow.';
  const result = await router.correctWithFallback(text, {
    proofreadLocal: async () => ({ supported: true, findings: [] }),
    correct: (value, request) => correctByParagraph(value, { correct: request, cache: createParagraphCache() }).then((review) => review.output),
  });
  assert.equal(result.source, 'ai');
  assert.equal(result.output, fix(text));
  assert.equal(calls.length, 2);
  mode = 'offline';
  const offline = await router.correctWithFallback(text, { proofreadLocal: async () => ({ supported: true }), correct: () => { throw new Error('must not run'); } });
  assert.equal(offline.source, 'local');
  assert.equal(calls.length, 2);
});

test('only paragraphs the device is unsure about are sent; the rest never leave', async () => {
  const sent = [];
  const text = 'Please send teh report today.\n\nThe meeting moved to Friday morning.\n\nI will recieve the files tomorrow.';
  const pieces = splitParagraphs(text).filter((piece) => !piece.separator);
  assert.deepEqual(pieces.map((piece) => [...text].slice(piece.start, piece.end).join('')), pieces.map((piece) => piece.core), 'offsets are code points of the whole text');
  const unsureStart = pieces[2].start;
  const review = await correctByParagraph(text, {
    correct: async (paragraph) => { sent.push(paragraph); return fix(paragraph); },
    cache: createParagraphCache(),
    shouldSend: (start) => start === unsureStart,
  });
  assert.deepEqual(sent, ['I will recieve the files tomorrow.']);
  assert.equal(review.skipped, 2);
  assert.deepEqual(review.sentRanges, [[pieces[2].start, pieces[2].end]]);
  assert.equal(review.output, text.replace('recieve', 'receive'), 'unsent paragraphs keep their text');
});
