import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { stopWindowsInput, validateWindowsInput } from './windows-input.js';

after(() => stopWindowsInput());

test('Windows keyboard interop compiles without sending input', async () => {
  assert.equal(await validateWindowsInput(), true);
});

test('the input helper is reused: later requests do not start a new process', async () => {
  const started = performance.now();
  for (let index = 0; index < 5; index += 1) assert.equal(await validateWindowsInput(), true);
  assert.ok(performance.now() - started < 2000, 'five warm requests complete quickly');
});
