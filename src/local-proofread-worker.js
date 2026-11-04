import { parentPort } from 'node:worker_threads';

const [{ LocalLinter, Dialect }, { binaryInlined }] = await Promise.all([
  import('harper.js'),
  import('harper.js/binaryInlined'),
]);

const linter = new LocalLinter({ binary: binaryInlined, dialect: Dialect.Indian });
await linter.setup();
parentPort.postMessage({ type: 'ready' });

const englishClues = new Set('a an and are as at be been but can could did do does for from had has have he hello how i in is it me my of on or our please she should that the their them then they this to was we were what when where which will with would you your'.split(' '));

function codePointSlice(text, start, end) {
  return [...text].slice(start, end).join('');
}

function skipped(reason) {
  return { supported: false, correctedText: '', findings: [], reason };
}

async function proofread(text) {
  if (!/[\p{Script=Latin}]/u.test(text)) return skipped('This local checker currently supports English text.');
  if (/[\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Devanagari}\p{Script=Thai}]/u.test(text)) {
    return skipped('This local checker currently supports English text.');
  }

  const words = text.toLocaleLowerCase('en-US').match(/[a-z]+(?:['’][a-z]+)?/g) || [];
  const clueCount = words.filter((word) => englishClues.has(word)).length;
  if (!(await linter.isLikelyEnglish(text)) && clueCount < 2) {
    return skipped('Language is uncertain; no local corrections were suggested.');
  }

  const lints = await linter.lint(text, { language: 'plaintext' });
  const findings = [];
  let correctedText = text;
  for (const lint of [...lints].sort((a, b) => b.span().start - a.span().start)) {
    const span = lint.span();
    const suggestions = lint.suggestions();
    const options = suggestions.slice(0, 3).map((suggestion) => suggestion.get_replacement_text());
    findings.push({
      message: lint.message(),
      original: codePointSlice(text, span.start, span.end),
      suggestions: options,
      appliedLocally: suggestions.length === 1,
      start: span.start,
      end: span.end,
    });
    if (suggestions.length === 1) correctedText = await linter.applySuggestion(correctedText, lint, suggestions[0]);
  }

  findings.reverse();
  return { supported: true, correctedText, findings, reason: '' };
}

let queue = Promise.resolve();
parentPort.on('message', ({ id, text }) => {
  queue = queue.then(async () => {
    try { parentPort.postMessage({ id, result: await proofread(text) }); }
    catch (error) { parentPort.postMessage({ id, error: error.message || 'The on-device check failed.' }); }
  });
});
