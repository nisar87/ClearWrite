import { parentPort } from 'node:worker_threads';
import { selectSpellingCandidate } from './spelling-selection.js';
import { loadContextSpeller, protectedSpans } from './context-spelling.js';

const [{ LocalLinter, Dialect }, { binaryInlined }] = await Promise.all([
  import('harper.js'),
  import('harper.js/binaryInlined'),
]);

// Starts as American English; ClearWrite sends the user's dialect and personal dictionary
// in a 'configure' message before the first check.
const linter = new LocalLinter({ binary: binaryInlined, dialect: Dialect.American });
const DIALECTS = { american: Dialect.American, british: Dialect.British, australian: Dialect.Australian, canadian: Dialect.Canadian, indian: Dialect.Indian };
await linter.setup();
parentPort.postMessage({ type: 'ready' });
let contextSpeller;
let contextUnavailable = false;
const useContext = process.env.CLEARWRITE_OFFLINE_CONTEXT !== '0';

const englishClues = new Set('a an and are as at be been but can could did do does for from had has have he hello how i in is it me my of on or our please she should that the their them then they this to was we were what when where which will with would you your'.split(' '));

function codePointSlice(text, start, end) {
  return [...text].slice(start, end).join('');
}

function skipped(reason) {
  return { supported: false, correctedText: '', findings: [], reason };
}

async function proofread(text) {
  const protectedRanges = protectedSpans(text);
  const languagePoints = [...text];
  for (const range of protectedRanges) languagePoints.fill(' ', range.start, range.end);
  const languageText = languagePoints.join('');
  if (!/[\p{Script=Latin}]/u.test(languageText)) return skipped('This local checker currently supports English text.');
  if (/[\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Devanagari}\p{Script=Thai}]/u.test(languageText)) {
    return skipped('This local checker currently supports English text.');
  }

  const words = languageText.toLocaleLowerCase('en-US').match(/[a-z]+(?:['’][a-z]+)?/g) || [];
  const clueCount = words.filter((word) => englishClues.has(word)).length;
  // Short, misspelled English is often rejected by language identification. Allow
  // a short phrase with an English anchor, but do not guess for isolated words.
  const shortEnglishPhrase = words.length >= 2 && words.length <= 8 && clueCount / words.length >= 0.2;
  if (!(await linter.isLikelyEnglish(languageText)) && clueCount < 2 && !shortEnglishPhrase) {
    return skipped('Language is uncertain; no local corrections were suggested.');
  }

  const lints = await linter.lint(text, { language: 'plaintext' });
  if (useContext && contextSpeller === undefined && !contextUnavailable) {
    try { contextSpeller = await loadContextSpeller(); }
    catch { contextUnavailable = true; }
  }
  const findings = [];
  let correctedText = text;
  for (const lint of [...lints].sort((a, b) => b.span().start - a.span().start)) {
    // Harper's JS spans use UTF-16 offsets. The ranker and replacements use
    // code points, so convert once before processing emoji-containing drafts.
    const rawSpan = lint.span();
    const span = { start: [...text.slice(0, rawSpan.start)].length, end: [...text.slice(0, rawSpan.end)].length };
    if (protectedRanges.some((range) => span.start < range.end && span.end > range.start)) continue;
    const suggestions = lint.suggestions();
    let candidates = suggestions.map((suggestion) => suggestion.get_replacement_text());
    let selected = suggestions.length === 1 ? 0 : lint.lint_kind() === 'Spelling'
      ? selectSpellingCandidate({ text, start: span.start, end: span.end, candidates }) : -1;
    const spellingEdit = lint.lint_kind() === 'Spelling' || (lint.lint_kind() === 'Typo' && /^[A-Za-z]{3,24}$/.test(codePointSlice(text, span.start, span.end)));
    if (useContext && contextSpeller && spellingEdit) {
      const ranked = contextSpeller.rank({ text, start: span.start, end: span.end, candidates });
      candidates = ranked.candidates;
      selected = ranked.selected;
      // The frequency list is dialect-neutral. Harper remains the authority on
      // whether a selected expansion is valid in the user's configured dialect.
      if (selected >= 0) {
        const validation = await linter.lint(candidates[selected], { language: 'plaintext' });
        if (validation.some((finding) => finding.lint_kind() === 'Spelling')) selected = -1;
      }
    }
    const options = selected >= 0
      ? [candidates[selected], ...candidates.filter((_, index) => index !== selected)].slice(0, 3)
      : candidates.slice(0, 3);
    findings.push({
      message: lint.message(),
      original: codePointSlice(text, span.start, span.end),
      suggestions: options,
      appliedLocally: selected >= 0,
      kind: lint.lint_kind(),
      start: span.start,
      end: span.end,
    });
    if (selected >= 0) {
      if (spellingEdit) {
        const points = [...correctedText];
        correctedText = points.slice(0, span.start).join('') + candidates[selected] + points.slice(span.end).join('');
      } else correctedText = await linter.applySuggestion(correctedText, lint, suggestions[selected]);
    }
  }

  findings.reverse();
  return { supported: true, correctedText, findings, reason: contextUnavailable ? 'Context data unavailable; basic offline checking was used.' : '' };
}

async function configure({ dialect, words }) {
  const target = DIALECTS[dialect] ?? Dialect.American;
  if ((await linter.getDialect()) !== target) await linter.setDialect(target);
  // Personal dictionary: Harper's own user-word list, replaced as a whole on every change.
  await linter.clearWords();
  const list = Array.isArray(words) ? words.filter((word) => typeof word === 'string' && word.length <= 48) : [];
  if (list.length) await linter.importWords(list);
}

let queue = Promise.resolve();
parentPort.on('message', (message) => {
  if (message?.type === 'configure') {
    queue = queue.then(() => configure(message)).then(() => parentPort.postMessage({ type: 'configured' })).catch(() => {});
    return;
  }
  const { id, text } = message;
  queue = queue.then(async () => {
    try { parentPort.postMessage({ id, result: await proofread(text) }); }
    catch (error) { parentPort.postMessage({ id, error: error.message || 'The on-device check failed.' }); }
  });
});
