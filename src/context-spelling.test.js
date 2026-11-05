import assert from 'node:assert/strict';
import test from 'node:test';
import { createContextSpeller, protectedSpans } from './context-spelling.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

test('bundled model matches its checksum and declares its actual vocabulary size', async () => {
  const root = new URL('../assets/offline/', import.meta.url);
  const bytes = await readFile(new URL('english.json.gz', root));
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  const model = JSON.parse(gunzipSync(bytes));
  assert.equal(model.unigrams.length, manifest.words);
  assert.equal(model.bigrams.length, manifest.bigrams);
  assert.equal(new Set(model.unigrams.map(([word]) => word)).size, manifest.words);
});

test('statistical context changes rankings using data rather than sentence-specific rules', () => {
  const model = createContextSpeller({
    unigrams: [['please', 10000], ['send', 10000], ['sand', 10000], ['the', 10000], ['beach', 10000], ['contains', 10000]],
    bigrams: [['please', 'send', 9000], ['send', 'the', 9000], ['contains', 'sand', 9000], ['sand', 'the', 100]],
  });
  const rank = (text) => { const start = text.indexOf('snd'); return model.rank({ text, start, end: start + 3, candidates: ['sand'] }); };
  assert.equal(rank('please snd the').candidates[0], 'send');
  assert.equal(rank('contains snd').candidates[0], 'sand');
  const ambiguous = model.rank({ text: 'snd', start: 0, end: 3, candidates: ['send', 'sand'] });
  assert.equal(ambiguous.selected, -1);
});

test('context scoring does not read adjacent words across sentence boundaries', () => {
  const model = createContextSpeller({ unigrams: [['sand', 100], ['send', 100], ['please', 100]], bigrams: [['please', 'send', 100]] });
  assert.equal(model.rank({ text: 'please. snd', start: 8, end: 11, candidates: ['sand', 'send'] }).selected, -1);
});

test('protected spans use code-point offsets and include embedded identifiers', () => {
  const text = '😀 quet@example.com and getUserProfile';
  const ranges = protectedSpans(text);
  assert.deepEqual(ranges.map(({ start, end }) => [...text].slice(start, end).join('')), ['quet@example.com', 'getUserProfile']);
});
