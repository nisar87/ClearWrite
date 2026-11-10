// Offline clarity hints (Phase 7): gentle notes about how text reads, never edits. They are not
// findings, are not underlined and never change text, so they cannot cause wrong corrections.
const FILLERS = new Set(['really', 'very', 'just', 'actually', 'basically', 'literally', 'quite', 'totally', 'simply', 'definitely']);
export const LONG_SENTENCE_WORDS = 35;

const words = (value) => value.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];

export function clarityHints(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const hints = [];
  const sentences = text.match(/[^.!?\n]+[.!?]*/gu) || [];
  const long = sentences.map((sentence) => words(sentence).length).filter((count) => count > LONG_SENTENCE_WORDS);
  if (long.length) {
    hints.push({
      kind: 'long-sentence',
      message: long.length === 1
        ? `One sentence has ${long[0]} words. Splitting it can make it easier to read.`
        : `${long.length} sentences are over ${LONG_SENTENCE_WORDS} words. Splitting them can make the text easier to read.`,
    });
  }
  const fillers = words(text).map((word) => word.toLocaleLowerCase()).filter((word) => FILLERS.has(word));
  if (fillers.length >= 3) {
    const counts = [...new Set(fillers)].map((word) => `“${word}”`).slice(0, 4).join(', ');
    hints.push({ kind: 'filler', message: `Words such as ${counts} appear ${fillers.length} times; removing some can make the text more direct.` });
  }
  return hints;
}
