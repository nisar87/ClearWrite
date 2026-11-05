import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addDictionaryWord, createPersonalDictionary, dictionaryHas, normalizeDictionaryWord, PERSONAL_DICTIONARY_FILE, removeDictionaryWord } from './personal-dictionary.js';

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clearwrite-dict-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('only single, plausible words can be added', () => {
  assert.equal(normalizeDictionaryWord('  Zyntrix '), 'Zyntrix');
  assert.equal(normalizeDictionaryWord("O'Neill"), "O'Neill");
  assert.equal(normalizeDictionaryWord('Wi-Fi'), 'Wi-Fi');
  for (const bad of ['', 'two words', 'x'.repeat(49), '<script>', 42]) assert.throws(() => normalizeDictionaryWord(bad));
});

test('add and remove are explicit and idempotent', () => {
  let { words, added } = addDictionaryWord([], 'Nisar');
  assert.equal(added, true);
  ({ words, added } = addDictionaryWord(words, 'Nisar'));
  assert.equal(added, false);
  ({ words } = addDictionaryWord(words, 'Zyntrix'));
  assert.deepEqual(words, ['Nisar', 'Zyntrix']);
  assert.equal(dictionaryHas(words, 'nisar'), true);
  const removed = removeDictionaryWord(words, 'Nisar');
  assert.equal(removed.removed, true);
  assert.deepEqual(removed.words, ['Zyntrix']);
  assert.equal(removeDictionaryWord(removed.words, 'Missing').removed, false);
});

test('the dictionary persists in the given app-data folder and survives a restart', async (t) => {
  const dir = await tempDir(t);
  const first = createPersonalDictionary(dir);
  assert.deepEqual(await first.load(), [], 'first launch: empty, no file needed');
  await first.add('Zyntrix');
  await first.add('Nisar');
  await first.remove('Zyntrix');
  const saved = JSON.parse(await readFile(path.join(dir, PERSONAL_DICTIONARY_FILE), 'utf8'));
  assert.deepEqual(saved, { version: 1, words: ['Nisar'] });
  const restarted = createPersonalDictionary(dir);
  assert.deepEqual(await restarted.load(), ['Nisar']);
});

test('a damaged dictionary file is reported, not overwritten, and invalid entries are skipped', async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, PERSONAL_DICTIONARY_FILE);
  await writeFile(file, '{not json');
  await assert.rejects(createPersonalDictionary(dir).load(), /could not be read/);
  assert.equal(await readFile(file, 'utf8'), '{not json');
  await writeFile(file, JSON.stringify({ version: 1, words: ['Good', 'two words', 7, 'Good'] }));
  assert.deepEqual(await createPersonalDictionary(dir).load(), ['Good']);
});
