import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWindowsInput } from './windows-input.js';

test('Windows keyboard interop compiles without sending input', async () => {
  assert.equal(await validateWindowsInput(), true);
});
