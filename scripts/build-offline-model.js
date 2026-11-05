import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Build-time only. The application never downloads model data.
const revision = '91fe939e9c1259813ee817e95239629c5badf8ec';
const base = `https://raw.githubusercontent.com/wolfgarbe/SymSpell/${revision}`;
const out = new URL('../assets/offline/', import.meta.url);
await mkdir(out, { recursive: true });
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response.text();
}
const sources = [];
async function source(file) {
  const url = `${base}/SymSpell/${file}`;
  const content = await download(url);
  sources.push({ url, sha256: createHash('sha256').update(content).digest('hex') });
  return content;
}
const unigrams = (await source('frequency_dictionary_en_82_765.txt')).trim().split(/\r?\n/)
  .map((line) => line.split(/\s+/)).filter(([word, count]) => /^[a-z]{2,24}$/.test(word) && Number(count) > 0)
  .sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 30000);
const vocabulary = new Set(unigrams.map(([word]) => word));
const bigrams = (await source('frequency_bigramdictionary_en_243_342.txt')).trim().split(/\r?\n/)
  .map((line) => line.split(/\s+/)).filter(([a, b, count]) => vocabulary.has(a) && vocabulary.has(b) && Number(count) >= 50);
const model = Buffer.from(JSON.stringify({ version: 1, unigrams, bigrams }));
const compressed = gzipSync(model, { level: 9 });
await writeFile(new URL('english.json.gz', out), compressed);
await writeFile(new URL('manifest.json', out), JSON.stringify({ revision, sources, words: unigrams.length, bigrams: bigrams.length, bytes: compressed.length, sha256: createHash('sha256').update(compressed).digest('hex') }, null, 2) + '\n');
await writeFile(new URL('SYMSPELL-LICENSE.txt', out), await download(`${base}/LICENSE`));
await writeFile(new URL('SCOWL-Copyright.txt', out), await download('https://raw.githubusercontent.com/en-wl/wordlist/5ef55f9c42730ebe4394a78b77855468a6f15dd2/scowl/Copyright'));
await writeFile(new URL('CC-BY-3.0.txt', out), await download('https://creativecommons.org/licenses/by/3.0/legalcode.txt'));
console.log(JSON.stringify({ words: unigrams.length, bigrams: bigrams.length, compressedBytes: compressed.length }));
