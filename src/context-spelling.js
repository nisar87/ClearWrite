import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spellingDistance, selectSpellingCandidate } from './spelling-selection.js';
const SymSpell = createRequire(import.meta.url)('mnemonist/symspell');

let modelPromise;
export function loadContextSpeller() {
  modelPromise ??= (async () => {
    const root = new URL('../assets/offline/', import.meta.url);
    const [bytes, manifest] = await Promise.all([readFile(new URL('english.json.gz', root)), readFile(new URL('manifest.json', root), 'utf8').then(JSON.parse)]);
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('Offline model checksum mismatch.');
    return createContextSpeller(JSON.parse(gunzipSync(bytes)));
  })();
  return modelPromise;
}

export function createContextSpeller({ unigrams, bigrams }) {
  const frequencies = new Map(unigrams.map(([word, count]) => [word, Number(count)]));
  const pairs = new Map(bigrams.map(([a, b, count]) => [`${a} ${b}`, Number(count)]));
  const leftTotals = new Map();
  const total = [...frequencies.values()].reduce((sum, count) => sum + count, 0);
  for (const [a, , count] of bigrams) leftTotals.set(a, (leftTotals.get(a) || 0) + Number(count));
  // Index bounded prefixes instead of every full-word deletion to reduce worker RAM.
  const prefixes = new Map();
  const index = new SymSpell({ maxDistance: 2, verbosity: 2 });
  for (const word of frequencies.keys()) {
    const prefix = word.slice(0, 7);
    if (!prefixes.has(prefix)) { prefixes.set(prefix, []); index.add(prefix); }
    prefixes.get(prefix).push(word);
  }
  function lift(a, b) {
    const count = pairs.get(`${a} ${b}`) || 0;
    if (!count) return 0;
    const expected = (leftTotals.get(a) || 0) * (frequencies.get(b) || 1) / total;
    return Math.min(4, Math.log10(1 + count / Math.max(1, expected)));
  }
  return {
    // Bigram association of `word` with its neighbours (0 when unknown). Used to check whether a
    // proposed word fits its context better than the original.
    contextFit(left, word, right) {
      const w = String(word || '').toLowerCase();
      return (left ? lift(String(left).toLowerCase(), w) : 0) + (right ? lift(w, String(right).toLowerCase()) : 0);
    },
    knows(word) { return frequencies.has(String(word || '').toLowerCase()); },
    rank({ text, start, end, candidates }) {
      const points = [...text];
      const original = points.slice(start, end).join('');
      const word = original.toLowerCase();
      if (!/^[a-z]{3,24}$/.test(word)) return { candidates, selected: candidates.length === 1 ? 0 : -1 };
      const before = points.slice(0, start).join('');
      const after = points.slice(end).join('');
      const left = before.match(/\b([a-z]+)\s+$/i)?.[1].toLowerCase();
      const right = after.match(/^\s+([a-z]+)\b/i)?.[1].toLowerCase();
      const sentenceStart = !before.trim() || /[.!?]\s*$/.test(before);
      const canSelect = original === word || (sentenceStart && /^[A-Z][a-z]+$/.test(original));
      const expanded = new Set(candidates.map((candidate) => candidate.toLowerCase()));
      for (const match of index.search(word.slice(0, 7))) {
        for (const candidate of prefixes.get(match.term) || []) {
          if (Math.abs(candidate.length - word.length) <= 2 && spellingDistance(word, candidate) <= 2) expanded.add(candidate);
        }
      }
      // Contractions such as "don't" come only from Harper (the index holds plain words); keep
      // them, normalising the typographic apostrophe so they are scored like other candidates.
      const scored = [...expanded].map((candidate) => candidate.replace(/’/g, "'")).filter((candidate) => /^[a-z]{2,26}$/.test(candidate) || /^[a-z]+'[a-z]{1,3}$/.test(candidate)).map((candidate) => {
        const edits = spellingDistance(word, candidate);
        const context = (left ? lift(left, candidate) : 0) + (right ? lift(candidate, right) : 0);
        const score = -2 * edits + 0.25 * Math.log10(1 + (frequencies.get(candidate) || 0)) + 0.9 * context;
        return { candidate, edits, context, score };
      }).sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate));
      // The same letters with an apostrophe added ("dont" -> "don't") is almost certainly the
      // intended contraction. Harper proposed it, so it is a real word; the statistical model has
      // no contractions and would otherwise rank it below unrelated common words.
      // Only negative contractions ("dont" -> "don't") are certain enough to pre-select: other
      // endings ('re, 's, 've, 'll, 'd, 'm) collide with possessives ("theyre report" means
      // "their report"), so those are offered first but left for the writer to choose.
      const contraction = scored.findIndex((entry) => entry.candidate.includes("'") && entry.candidate.replace(/'/g, '') === word);
      if (contraction > 0) scored.unshift(...scored.splice(contraction, 1));
      const certainContraction = contraction >= 0 && /n't$/.test(scored[0].candidate);
      if (certainContraction) scored[0] = { ...scored[0], score: Infinity };
      const offerOnly = contraction >= 0 && !certainContraction;
      const best = scored[0];
      const margin = best ? best.score - (scored[1]?.score ?? -Infinity) : 0;
      const contextual = best?.context >= 1;
      const baseline = selectSpellingCandidate({ text: word, start: 0, end: word.length, candidates: scored.map((entry) => entry.candidate) });
      const selected = !offerOnly && canSelect && best && ((best.edits <= (contextual ? 2 : 1.5) && margin >= 0.75) || baseline === 0) ? 0 : -1;
      const restoreCase = (value) => candidates.find((candidate) => candidate.toLowerCase().replace(/’/g, "'") === value)
        || (/^[A-Z][a-z]+$/.test(original) ? value[0].toUpperCase() + value.slice(1) : value);
      if (selected < 0 && canSelect && candidates.length === 1 && /^[A-Za-z]+$/.test(candidates[0])) {
        return { candidates: [candidates[0], ...scored.map((entry) => restoreCase(entry.candidate)).filter((candidate) => candidate !== candidates[0])], selected: 0 };
      }
      return { candidates: scored.length ? scored.map((entry) => restoreCase(entry.candidate)) : candidates, selected };
    },
  };
}

export function protectedSpans(text) {
  const pattern = /\b(?:https?|ftp):\/\/[^\s<>]+|\bwww\.[^\s<>]+|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b[A-Za-z]:[\\/][^\s<>]+|\\\\[^\s<>]+|(?:\.{0,2}\/)[\w./-]+|`[^`\n]+`|@[\w.-]+|\b[\w]*[_\d][\w]*\b|\b[a-z]+(?:[A-Z][a-z]*)+\b|\b[A-Z]{2,}\b|__CLEARWRITE_LINK_\d+__/g;
  return [...text.matchAll(pattern)].map((match) => ({ start: [...text.slice(0, match.index)].length, end: [...text.slice(0, match.index + match[0].length)].length }));
}
