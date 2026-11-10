import { parentPort } from 'node:worker_threads';
import { selectSpellingCandidate } from './spelling-selection.js';
import { loadContextSpeller, protectedSpans } from './context-spelling.js';
import { composeText, diffSpan } from './finding-edits.js';
import { modelFindings } from './grammar-model.js';

const [{ LocalLinter, Dialect }, { binaryInlined }] = await Promise.all([
  import('harper.js'),
  import('harper.js/binaryInlined'),
]);

// Starts as American English; ClearWrite sends the user's dialect and personal dictionary
// in a 'configure' message before the first check.
const linter = new LocalLinter({ binary: binaryInlined, dialect: Dialect.American });
const DIALECTS = { american: Dialect.American, british: Dialect.British, australian: Dialect.Australian, canadian: Dialect.Canadian, indian: Dialect.Indian };
await linter.setup();
// Rules turned off in ClearWrite: style preferences that change correct text, measured as false
// alarms on the clean-prose benchmark (OxfordComma added a comma to "pricing, onboarding and support").
const DISABLED_RULES = { OxfordComma: false };

// Benchmark-only switch (never set by the app): enable every Harper rule, or a comma-separated
// list of extra rules, to measure which disabled rules help without false alarms.
const ruleOverride = process.env.CLEARWRITE_HARPER_RULES || '';
async function applyRuleOverrides() {
  const config = await linter.getLintConfig();
  if (!ruleOverride) { await linter.setLintConfig({ ...config, ...DISABLED_RULES }); return; }
  const names = ruleOverride === 'all' ? Object.keys(config) : ruleOverride.split(',').map((name) => name.trim()).filter(Boolean);
  await linter.setLintConfig({ ...config, ...Object.fromEntries(names.map((name) => [name, true])) });
}
await applyRuleOverrides();
parentPort.postMessage({ type: 'ready' });
let contextSpeller;
let contextUnavailable = false;
const useContext = process.env.CLEARWRITE_OFFLINE_CONTEXT !== '0';
const useModel = process.env.CLEARWRITE_OFFLINE_MODEL !== '0';

const englishClues = new Set('a an and are as at be been but can could did do does for from had has have he hello how i in is it me my of on or our please she should that the their them then they this to was we were what when where which will with would you your'.split(' '));

function codePointSlice(text, start, end) {
  return [...text].slice(start, end).join('');
}

// "wont" -> "won't": a negative contraction missing its apostrophe, when Harper accepts the
// result as correctly spelled. Only n't endings: others ("were" -> "we're") are usually right as typed.
async function apostropheVariant(word) {
  if (!/nt$/i.test(word)) return '';
  const variant = `${word.slice(0, -1)}'${word.slice(-1)}`;
  const lints = await linter.lint(variant, { language: 'plaintext' });
  return lints.some((lint) => lint.lint_kind() === 'Spelling') ? '' : variant;
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
  for (const lint of [...lints].sort((a, b) => b.span().start - a.span().start)) {
    // Harper's JS spans use UTF-16 offsets. The ranker and replacements use
    // code points, so convert once before processing emoji-containing drafts.
    const rawSpan = lint.span();
    const span = { start: [...text.slice(0, rawSpan.start)].length, end: [...text.slice(0, rawSpan.end)].length };
    if (protectedRanges.some((range) => span.start < range.end && span.end > range.start)) continue;
    const suggestions = lint.suggestions();
    let candidates = suggestions.map((suggestion) => suggestion.get_replacement_text());
    // A real word that is also a contraction without its apostrophe ("wont" -> "won't") is
    // ambiguous: offer the contraction first and let the writer choose.
    const flagged = codePointSlice(text, span.start, span.end);
    const contraction = lint.lint_kind() !== 'Spelling' && /^[A-Za-z]{3,12}$/.test(flagged) ? await apostropheVariant(flagged) : '';
    let selected = contraction ? -1 : suggestions.length === 1 ? 0 : lint.lint_kind() === 'Spelling'
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
    const order = selected >= 0
      ? [selected, ...candidates.map((_, index) => index).filter((index) => index !== selected)].slice(0, 3)
      : candidates.map((_, index) => index).slice(0, 3);
    // Each option is an exact edit of the checked text, so the writer can accept any one
    // finding on its own. Spelling options replace the word; other lints are applied by
    // Harper (which knows whether a suggestion replaces, removes or inserts) and reduced
    // to the smallest changed range.
    const edits = [];
    for (const index of order) {
      if (spellingEdit) edits.push({ start: span.start, end: span.end, text: candidates[index] });
      else edits.push(diffSpan(text, await linter.applySuggestion(text, lint, suggestions[index])));
    }
    const labels = order.map((index) => candidates[index]);
    if (contraction && !labels.includes(contraction)) {
      edits.unshift({ start: span.start, end: span.end, text: contraction });
      labels.unshift(contraction);
    }
    findings.push({
      message: lint.message(),
      original: codePointSlice(text, span.start, span.end),
      suggestions: labels,
      edits,
      choice: selected >= 0 ? 0 : -1,
      appliedLocally: selected >= 0,
      kind: lint.lint_kind(),
      start: span.start,
      end: span.end,
    });
  }

  findings.reverse();
  // On-device grammar model: extra, filtered findings where Harper found nothing.
  if (useModel) {
    try {
      const extra = await modelFindings(text, { speller: contextSpeller, protectedRanges, covered: findings });
      if (extra.length) {
        findings.push(...extra);
        findings.sort((a, b) => a.start - b.start);
      }
    } catch { /* The model is an optional layer; Harper's result stands. */ }
  }
  return { supported: true, correctedText: composeText(text, findings), findings, reason: contextUnavailable ? 'Context data unavailable; basic offline checking was used.' : '' };
}

async function configure({ dialect, words }) {
  const target = DIALECTS[dialect] ?? Dialect.American;
  if ((await linter.getDialect()) !== target) await linter.setDialect(target);
  // Personal dictionary: Harper's own user-word list, replaced as a whole on every change.
  await linter.clearWords();
  const list = Array.isArray(words) ? words.filter((word) => typeof word === 'string' && word.length <= 48) : [];
  if (list.length) await linter.importWords(list);
  // Changing the dialect resets Harper's rule configuration.
  await applyRuleOverrides();
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
