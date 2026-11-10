import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sentences } from './grammar-model.js';
import { safeModelEdits } from './model-filter.js';

test('sentences are found with code-point offsets and short or non-prose pieces are skipped', () => {
  const text = '😀 The report are ready. OK!\nThe results was surprising.';
  const found = sentences(text);
  assert.deepEqual(found.map(([, sentence]) => sentence), ['😀 The report are ready.', 'The results was surprising.']);
  for (const [offset, sentence] of found) assert.equal([...text].slice(offset, offset + [...sentence].length).join(''), sentence);
});

test('the model filter keeps context-supported word swaps and sentence capitalisation only', () => {
  const speller = {
    contextFit: (left, word) => ({ 'report|is': 3, 'report|are': 0 })[`${String(left).toLowerCase()}|${word}`] ?? 0,
    knows: () => true,
  };
  const accepted = (text, corrected) => safeModelEdits(text, corrected, speller, 1.5).map((edit) => [edit.before, edit.after, edit.reason.split(' ')[0]]);
  assert.deepEqual(accepted('The report are ready.', 'The report is ready.'), [['are', 'is', 'context']]);
  assert.deepEqual(accepted('the meeting starts at noon.', 'The meeting starts at noon.'), [['the', 'The', 'capitalisation']]);
  assert.deepEqual(accepted('Attached is the updated proposal.', 'Attached is an updated proposal.'), [], 'no context support');
  assert.deepEqual(accepted('Her talk covered pricing and support.', 'Her talk covered the pricing and support.'), [], 'insertions are dropped');
  assert.deepEqual(accepted("I'm not sure.", 'I am not sure.'), [], 'rewrites are dropped');
  assert.deepEqual(accepted('We met the Team today.', 'We met the team today.'), [], 'mid-sentence case changes are dropped');
});
