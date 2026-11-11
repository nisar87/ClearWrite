// AI correction one paragraph at a time. A paragraph that was already corrected (same text,
// same provider and model) is reused, so editing one paragraph of a long email sends only that
// paragraph instead of the whole field again: less text leaves the device, and results are
// faster and cheaper. Separators and surrounding whitespace are kept exactly.
import { hasProofreadableProse, isSafeCorrection } from './live-proofread.js';

// Splits at blank lines (paragraph breaks). Each piece keeps its exact text; `core` is the
// part sent for correction, with its leading/trailing whitespace preserved separately.
export function splitParagraphs(text) {
  const pieces = [];
  const pattern = /(?:\r?\n[ \t]*){2,}/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(text))) {
    pieces.push(text.slice(cursor, match.index), match[0]);
    cursor = match.index + match[0].length;
  }
  pieces.push(text.slice(cursor));
  let offset = 0;
  return pieces.map((value, index) => {
    const separator = index % 2 === 1;
    const lead = separator ? '' : value.match(/^\s*/u)[0];
    const trail = separator ? '' : value.slice(lead.length).match(/\s*$/u)[0];
    const start = offset + [...lead].length;
    const core = separator ? '' : value.slice(lead.length, value.length - trail.length);
    offset += [...value].length;
    // start/end: the core's position in code points of the whole text.
    return { value, separator, lead, trail, core, start, end: start + [...core].length };
  });
}

export function createParagraphCache(limit = 200) {
  const entries = new Map();
  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > limit) entries.delete(entries.keys().next().value);
    },
    clear() { entries.clear(); },
    get size() { return entries.size; },
  };
}

// correct(paragraph) returns the corrected paragraph (one provider request).
// shouldSend(start, end), when given, decides per paragraph whether it goes to the provider at
// all (the "only when unsure" scope); paragraphs not sent keep their text.
// Returns { output, sent, reused, skipped, sentCharacters, sentRanges }.
export async function correctByParagraph(text, { correct, cache, cacheKey = '', concurrency = 2, shouldSend }) {
  const pieces = splitParagraphs(text);
  const results = pieces.map((piece) => piece.value);
  const work = [];
  let reused = 0;
  let skipped = 0;
  const sentRanges = [];
  pieces.forEach((piece, index) => {
    if (piece.separator || !hasProofreadableProse(piece.core)) return;
    if (shouldSend && !shouldSend(piece.start, piece.end)) { skipped += 1; return; }
    sentRanges.push([piece.start, piece.end]);
    const key = `${cacheKey}\u0000${piece.core}`;
    const cached = cache?.get(key);
    if (cached !== undefined) {
      results[index] = piece.lead + cached + piece.trail;
      reused += 1;
      return;
    }
    work.push({ piece, index, key });
  });
  let next = 0;
  let sentCharacters = 0;
  const worker = async () => {
    while (next < work.length) {
      const { piece, index, key } = work[next++];
      sentCharacters += piece.core.length;
      const corrected = String(await correct(piece.core)).trim();
      // A paragraph answered with a rewrite or commentary keeps its original text.
      const safe = isSafeCorrection(piece.core, corrected) ? corrected : piece.core;
      cache?.set(key, safe);
      results[index] = piece.lead + safe + piece.trail;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, worker));
  return { output: results.join(''), sent: work.length, reused, skipped, sentCharacters, sentRanges };
}
