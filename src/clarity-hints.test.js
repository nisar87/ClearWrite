import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clarityHints } from './clarity-hints.js';

test('clarity hints flag very long sentences and piled-up filler words only', () => {
  assert.deepEqual(clarityHints('Please review the report before the meeting.'), []);
  const long = `${'We reviewed the plan and agreed on the next steps '.repeat(4)}today.`;
  assert.deepEqual(clarityHints(long).map((hint) => hint.kind), ['long-sentence']);
  const filler = 'I just really think this is very basically fine.';
  const hints = clarityHints(filler);
  assert.deepEqual(hints.map((hint) => hint.kind), ['filler']);
  assert.match(hints[0].message, /appear 4 times/);
  assert.deepEqual(clarityHints('It is very good.'), [], 'one filler word is fine');
});
