// Keeps only the edits of a small grammar model that are safe to offer: one-word substitutions
// that ClearWrite's word-pair statistics clearly prefer in context, and capitalisation at the
// start of a sentence. Insertions, deletions and rewrites are dropped: on the clean-prose
// benchmark they were mostly unwanted changes to correct text.
import { changeHunks } from './ai-changes.js';

const WORD = /^[\p{L}][\p{L}'’]*$/u;

function neighbours(text, start, end) {
  const points = [...text];
  const before = points.slice(0, start).join('');
  const after = points.slice(end).join('');
  return {
    left: before.match(/([\p{L}'’]+)\s*$/u)?.[1] || '',
    right: after.match(/^\s*([\p{L}'’]+)/u)?.[1] || '',
    sentenceStart: !before.trim() || /[.!?]["'”’)\]]*\s*$/u.test(before),
  };
}

// Returns [{ start, end, before, after, reason }] for the accepted edits.
export function safeModelEdits(text, corrected, speller, threshold = 1) {
  const accepted = [];
  for (const hunk of changeHunks(text, corrected)) {
    const before = hunk.before.trim();
    const after = hunk.after.trim();
    if (!WORD.test(before) || !WORD.test(after) || hunk.before !== before || hunk.after !== after) continue;
    const { left, right, sentenceStart } = neighbours(text, hunk.start, hunk.end);
    if (before.toLowerCase() === after.toLowerCase()) {
      // Capitalisation: only the first word of a sentence, or the pronoun I.
      const capitalises = after[0] === after[0].toUpperCase() && before[0] !== before[0].toUpperCase();
      if (capitalises && (sentenceStart || after === 'I')) accepted.push({ ...hunk, reason: 'capitalisation' });
      continue;
    }
    if (!speller) continue;
    const gain = speller.contextFit(left, after, right) - speller.contextFit(left, before, right);
    if (speller.knows(after.replace(/[’]/g, "'")) && gain >= threshold) accepted.push({ ...hunk, reason: `context +${gain.toFixed(2)}` });
  }
  return accepted;
}
