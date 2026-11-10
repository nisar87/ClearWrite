// Turns an AI correction into individual, reviewable changes and flags the ones that could
// change meaning. A proofreading answer may fix spelling, grammar and punctuation, but should
// not change numbers, negation or names. Such changes are still shown, but are not pre-selected:
// the writer has to accept each one explicitly.
import { composeText } from './finding-edits.js';

const TOKEN_PATTERN = /[\p{L}\p{N}_]+(?:['’.,:/-][\p{L}\p{N}_]+)*|\s+|[^\s\p{L}\p{N}_]/gu;
const NEGATIONS = new Set(['not', 'no', 'never', 'nor', 'none', 'nothing', 'nobody', 'neither', 'nowhere', 'cannot', 'without']);
// Missing-apostrophe negative contractions are common typos ("dont"); they count as negations
// so correcting "dont" to "don't" is not a meaning change.
const CONTRACTED = /^(?:ain|aren|can|couldn|didn|doesn|don|hadn|hasn|haven|isn|mightn|mustn|needn|shan|shouldn|wasn|weren|won|wouldn)['’]?t$/u;

export function tokenize(text) {
  return String(text).match(TOKEN_PATTERN) || [];
}

const isNumber = (token) => /\p{N}/u.test(token);
function negationCount(text) {
  return tokenize(text.toLocaleLowerCase()).filter((token) => NEGATIONS.has(token) || CONTRACTED.test(token) || /n['’]t$/u.test(token)).length;
}
function numbers(text) {
  return tokenize(text).filter(isNumber).map((token) => token.replace(/[.,:]+$/u, '')).sort();
}

function editDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

// Capitalised words that are not at the start of a sentence: likely names, products, places.
function names(text, atSentenceStart = true) {
  const tokens = tokenize(text);
  const result = [];
  let sentenceStart = atSentenceStart;
  for (const token of tokens) {
    if (/^\s+$/u.test(token)) continue;
    if (/^[.!?]$/u.test(token)) { sentenceStart = true; continue; }
    if (/^\p{Lu}[\p{Ll}\p{N}]+/u.test(token) && !sentenceStart && token !== 'I') result.push(token);
    if (/[\p{L}\p{N}]/u.test(token)) sentenceStart = false;
  }
  return result;
}

// Reasons this one change could alter meaning (empty when it looks like a plain correction).
export function meaningRisks(before, after, atSentenceStart = true) {
  const risks = [];
  if (numbers(before).join('\u0000') !== numbers(after).join('\u0000')) risks.push('number');
  if (negationCount(before) !== negationCount(after)) risks.push('negation');
  const kept = tokenize(after).filter((token) => /\p{L}/u.test(token)).map((token) => token.toLocaleLowerCase());
  const lostName = names(before, atSentenceStart).some((name) => {
    const lower = name.toLocaleLowerCase();
    // A small spelling fix of a name is allowed (Grammerly -> Grammarly); replacing it is not.
    return !kept.some((word) => word === lower || (lower.length > 4 && editDistance(word, lower) <= 2));
  });
  if (lostName) risks.push('name');
  return risks;
}

const RISK_LABELS = { number: 'a number', negation: 'a negation (not, no, never…)', name: 'a name' };
export function riskMessage(risks) {
  if (!risks.length) return '';
  const parts = risks.map((risk) => RISK_LABELS[risk]);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `This changes ${list}. Check it keeps your meaning before accepting.`;
}

// Word-level differences between original and corrected text as edits in code points of the
// original. Common prefix and suffix are trimmed first so long texts stay cheap.
export function changeHunks(original, corrected) {
  const a = tokenize(original);
  const b = tokenize(corrected);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tailA = a.length;
  let tailB = b.length;
  while (tailA > head && tailB > head && a[tailA - 1] === b[tailB - 1]) { tailA -= 1; tailB -= 1; }
  const middleA = a.slice(head, tailA);
  const middleB = b.slice(head, tailB);
  const offset = [...a.slice(0, head).join('')].length;
  if (!middleA.length && !middleB.length) return [];
  // Too large to align word by word: one change for the whole differing region.
  if (middleA.length * middleB.length > 2_000_000) {
    return [{ start: offset, end: offset + [...middleA.join('')].length, before: middleA.join(''), after: middleB.join('') }];
  }
  const cols = middleB.length + 1;
  const lcs = new Uint32Array((middleA.length + 1) * cols);
  for (let i = middleA.length - 1; i >= 0; i -= 1) {
    for (let j = middleB.length - 1; j >= 0; j -= 1) {
      lcs[i * cols + j] = middleA[i] === middleB[j] ? lcs[(i + 1) * cols + j + 1] + 1 : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1]);
    }
  }
  const hunks = [];
  let position = offset;
  let current = null;
  const close = () => { if (current) { hunks.push(current); current = null; } };
  let i = 0;
  let j = 0;
  while (i < middleA.length || j < middleB.length) {
    if (i < middleA.length && j < middleB.length && middleA[i] === middleB[j]) {
      close();
      position += [...middleA[i]].length;
      i += 1; j += 1;
    } else if (j >= middleB.length || (i < middleA.length && lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1])) {
      current ??= { start: position, end: position, before: '', after: '' };
      current.before += middleA[i];
      current.end += [...middleA[i]].length;
      position += [...middleA[i]].length;
      i += 1;
    } else {
      current ??= { start: position, end: position, before: '', after: '' };
      current.after += middleB[j];
      j += 1;
    }
  }
  close();
  return hunks;
}

// Findings (same shape as on-device findings) for an AI correction. Safe changes are
// pre-selected; meaning-changing ones need explicit acceptance.
export function aiFindings(original, corrected) {
  const points = [...original];
  return changeHunks(original, corrected).map((hunk) => {
    const prefix = points.slice(0, hunk.start).join('');
    const risks = meaningRisks(hunk.before, hunk.after, !prefix.trim() || /[.!?]["'”’)\]]*\s*$/u.test(prefix));
    return {
      message: riskMessage(risks),
      original: hunk.before.trim() ? hunk.before : '(insertion)',
      suggestions: [hunk.after],
      edits: [{ start: hunk.start, end: hunk.end, text: hunk.after }],
      choice: risks.length ? -1 : 0,
      ignored: false,
      appliedLocally: !risks.length,
      kind: risks.length ? 'AI-check' : 'AI',
      risks,
      start: hunk.start,
      end: hunk.end,
    };
  });
}

// Builds the reviewable AI suggestion for a correction. The suggested text contains only the
// pre-selected (safe) changes.
export function reviewAiCorrection(original, corrected) {
  const findings = aiFindings(original, corrected);
  const flagged = findings.filter((finding) => finding.risks.length).length;
  return { findings, text: composeText(original, findings), flagged };
}

// For rewrites (clearer, tone), which are reviewed as a whole: what changed in meaning terms.
export function rewriteWarning(original, rewritten) {
  const risks = [];
  if (numbers(original).join('\u0000') !== numbers(rewritten).join('\u0000')) risks.push('number');
  if (negationCount(original) !== negationCount(rewritten)) risks.push('negation');
  if (!risks.length) return '';
  return `Check the result: it changes ${risks.map((risk) => RISK_LABELS[risk]).join(' and ')}.`;
}
