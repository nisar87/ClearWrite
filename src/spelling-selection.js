// Rank only Harper's existing spelling candidates; never invent replacement words.
export function spellingDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 1; j <= b.length; j++) rows[0][j] = rows[0][j - 1] + insertionCost(b, j - 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + insertionCost(b, j - 1), rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1.25));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 0.75);
      }
    }
  }
  return rows[a.length][b.length];
}

function insertionCost(word, index) {
  // Dropped repeated letters and vowels are common typing errors. These are generic
  // character costs, not word-specific replacements or a claim of semantic confidence.
  if (word[index] === word[index - 1] || word[index] === word[index + 1]) return 0.5;
  return /[aeiou]/.test(word[index]) ? 0.65 : 1;
}

export function selectSpellingCandidate({ text, start, end, candidates }) {
  const points = [...text];
  const original = points.slice(start, end).join('');
  // Multiword replacements, identifiers and names need human judgement.
  if (!/^[a-z]{3,32}$/.test(original) || candidates.length < 2) return -1;
  const ranked = candidates.map((word, index) => {
    if (!/^[a-z]{3,36}$/.test(word)) return { index, edits: Infinity, score: Infinity };
    const edits = spellingDistance(original, word);
    return { index, edits, score: edits };
  }).sort((a, b) => a.score - b.score);
  const [best, runnerUp] = ranked;
  if (!Number.isFinite(best.score) || best.edits > 1.5) return -1;
  return runnerUp.score - best.score >= 0.5 - Number.EPSILON ? best.index : -1;
}
