// Personal dictionary: names and uncommon words the user explicitly added.
// Stored as JSON in the user's app-data folder (outside the repository). Words are never
// logged and never sent anywhere; they are only given to the on-device Harper checker.
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const PERSONAL_DICTIONARY_FILE = 'personal-dictionary.json';
export const MAX_DICTIONARY_WORDS = 2000;
const WORD_PATTERN = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}'’.-]{0,47}$/u;

export function normalizeDictionaryWord(value) {
  if (typeof value !== 'string') throw new Error('Enter a word to add.');
  const word = value.normalize('NFC').trim();
  if (!word) throw new Error('Enter a word to add.');
  if (!WORD_PATTERN.test(word)) throw new Error('Add one word at a time (letters, numbers, apostrophes, periods, or hyphens; up to 48 characters).');
  return word;
}

const sortWords = (words) => [...words].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
const sameWord = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

export function addDictionaryWord(words, value) {
  const word = normalizeDictionaryWord(value);
  if (words.some((existing) => existing === word)) return { words, added: false, word };
  if (words.length >= MAX_DICTIONARY_WORDS) throw new Error(`The personal dictionary holds up to ${MAX_DICTIONARY_WORDS.toLocaleString()} words.`);
  return { words: sortWords([...words, word]), added: true, word };
}

export function removeDictionaryWord(words, value) {
  const word = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  const next = words.filter((existing) => existing !== word);
  return { words: next, removed: next.length !== words.length, word };
}

export function parseDictionaryFile(contents) {
  const parsed = JSON.parse(contents);
  const list = Array.isArray(parsed?.words) ? parsed.words : [];
  const words = [];
  for (const value of list) {
    try {
      const word = normalizeDictionaryWord(value);
      if (!words.some((existing) => existing === word)) words.push(word);
    } catch { /* skip invalid entries */ }
    if (words.length >= MAX_DICTIONARY_WORDS) break;
  }
  return sortWords(words);
}

export function createPersonalDictionary(directory) {
  const file = path.join(directory, PERSONAL_DICTIONARY_FILE);
  let words = [];
  let writes = Promise.resolve();
  const persist = () => {
    writes = writes.catch(() => {}).then(async () => {
      await mkdir(directory, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, words }, null, 2), { flag: 'wx' });
        await rename(temporary, file);
      } finally { await unlink(temporary).catch(() => {}); }
    });
    return writes;
  };
  return {
    file,
    async load() {
      try { words = parseDictionaryFile(await readFile(file, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw new Error('The personal dictionary could not be read; it was left unchanged.');
        words = [];
      }
      return [...words];
    },
    list: () => [...words],
    async add(value) {
      const result = addDictionaryWord(words, value);
      if (result.added) { words = result.words; await persist(); }
      return result;
    },
    async remove(value) {
      const result = removeDictionaryWord(words, value);
      if (result.removed) { words = result.words; await persist(); }
      return result;
    },
  };
}

// For callers that only need case-insensitive membership (e.g. hiding "Add to dictionary").
export function dictionaryHas(words, value) {
  return typeof value === 'string' && words.some((word) => sameWord(word, value.trim()));
}
