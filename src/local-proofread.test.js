import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { proofreadLocally, stopLocalProofreader } from './local-proofread.js';

after(() => stopLocalProofreader());

test('on-device English proofreading returns a safe correction without a provider', async () => {
  const review = await proofreadLocally('This is a example.');
  assert.equal(review.supported, true);
  assert.equal(review.correctedText, 'This is an example.');
  assert.equal(review.findings.length, 1);
  assert.match(review.findings[0].message, /article/i);
  assert.equal(review.findings[0].appliedLocally, true);

  const unicodeReview = await proofreadLocally('😀 This is a example.');
  assert.equal(unicodeReview.correctedText, '😀 This is an example.');

  const dialectReview = await proofreadLocally('I like the colour of the centre.');
  assert.deepEqual(dialectReview.findings, []);
});

test('on-device checker declines uncertain Roman Urdu instead of guessing', async () => {
  const review = await proofreadLocally('mujhe kal office jana hai');
  assert.equal(review.supported, false);
  assert.equal(review.findings.length, 0);
  assert.match(review.reason, /uncertain/i);
});
