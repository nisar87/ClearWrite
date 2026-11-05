import assert from 'node:assert/strict';
import test from 'node:test';
import { createShortcutRegistrar } from './shortcut.js';

function fakeGlobalShortcut(taken = []) {
  const active = new Map();
  return {
    active,
    register(value, callback) { if (taken.includes(value) || active.has(value)) return false; active.set(value, callback); return true; },
    unregister(value) { active.delete(value); },
    isRegistered(value) { return active.has(value); },
  };
}

test('regression: the saved default shortcut is actually registered at startup', () => {
  const os = fakeGlobalShortcut();
  const registrar = createShortcutRegistrar(os, () => {});
  assert.equal(registrar.register('CommandOrControl+Shift+Space'), true);
  assert.equal(os.isRegistered('CommandOrControl+Shift+Space'), true);
  assert.equal(registrar.register('CommandOrControl+Shift+Space'), true, 'registering again is idempotent');
});

test('changing the shortcut swaps registrations and a taken shortcut keeps the old one', () => {
  const os = fakeGlobalShortcut(['Alt+Space']);
  const registrar = createShortcutRegistrar(os, () => {});
  registrar.register('CommandOrControl+Shift+Space');
  assert.equal(registrar.register('Alt+Space'), false);
  assert.equal(os.isRegistered('CommandOrControl+Shift+Space'), true);
  assert.equal(registrar.register('CommandOrControl+Alt+K'), true);
  assert.equal(os.isRegistered('CommandOrControl+Shift+Space'), false);
  assert.equal(registrar.registered, 'CommandOrControl+Alt+K');
});

test('invalid accelerators are rejected without throwing', () => {
  const registrar = createShortcutRegistrar({ register() { throw new Error('bad accelerator'); }, unregister() {}, isRegistered: () => false }, () => {});
  assert.equal(registrar.register('Nope+'), false);
  assert.equal(registrar.register(''), false);
});
