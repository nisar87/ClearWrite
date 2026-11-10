import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { configureLocalProofreader, proofreadLocally, stopLocalProofreader } from './local-proofread.js';
import { selectSpellingCandidate } from './spelling-selection.js';

after(() => stopLocalProofreader());

test('on-device English proofreading returns a safe correction without a provider', async () => {
  const review = await proofreadLocally('This is a example.');
  assert.equal(review.supported, true);
  assert.equal(review.correctedText, 'This is an example.');
  assert.equal(review.findings.length, 1);
  assert.match(review.findings[0].message, /article/i);
  assert.equal(review.findings[0].appliedLocally, true);

  const unicodeReview = await proofreadLocally('😀 This is a example.');
  assert.equal(unicodeReview.correctedText, '😀 This is an example.');

  configureLocalProofreader({ dialect: 'indian', words: [] });
  const dialectReview = await proofreadLocally('I like the colour of the centre.');
  assert.deepEqual(dialectReview.findings, []);
});

test('the English dialect setting changes which spellings are flagged', async () => {
  configureLocalProofreader({ dialect: 'american', words: [] });
  const american = await proofreadLocally('I like the colour of the centre.');
  assert.ok(american.findings.some((finding) => finding.original === 'centre' && finding.kind === 'Spelling'));
  configureLocalProofreader({ dialect: 'british', words: [] });
  const british = await proofreadLocally('I like the colour of the centre.');
  assert.deepEqual(british.findings, []);
});

test('personal dictionary words stop being flagged and come back when removed', async () => {
  configureLocalProofreader({ dialect: 'american', words: [] });
  const sentence = 'Please send the Zyntrix report to Nisar today.';
  const before = await proofreadLocally(sentence);
  const flagged = before.findings.filter((finding) => finding.kind === 'Spelling').map((finding) => finding.original);
  assert.ok(flagged.includes('Zyntrix'));
  configureLocalProofreader({ words: ['Zyntrix', 'Nisar'] });
  const added = await proofreadLocally(sentence);
  assert.deepEqual(added.findings.filter((finding) => finding.kind === 'Spelling'), []);
  assert.equal(added.correctedText, sentence, 'added words are not changed');
  configureLocalProofreader({ words: ['Nisar'] });
  const removed = await proofreadLocally(sentence);
  assert.ok(removed.findings.some((finding) => finding.original === 'Zyntrix'));
  configureLocalProofreader({ words: [] });
});

test('local findings keep the suggestion reviewable rather than silently applying ambiguous fixes', async () => {
  configureLocalProofreader({ dialect: 'american', words: [] });
  const review = await proofreadLocally('Their going to the store tomorow.');
  assert.ok(review.findings.length >= 1);
  for (const finding of review.findings) {
    assert.equal(typeof finding.kind, 'string');
    if (finding.kind !== 'Spelling' && finding.suggestions.length !== 1) assert.equal(finding.appliedLocally, false);
  }
});

test('offline spelling fixes clear typos in the reported sentence', async () => {
  const review = await proofreadLocally('Ok then it is the time to throughly check and impelment the changes');
  assert.equal(review.correctedText, 'Okay then it is the time to thoroughly check and implement the changes');
  for (const word of ['throughly', 'impelment']) {
    const finding = review.findings.find((item) => item.original === word);
    assert.equal(finding.appliedLocally, true);
  }
});

test('candidate selection uses generic typo costs, not word lists or candidate order', () => {
  const choose = (word, candidates, tail = '') => selectSpellingCandidate({ text: word + tail, start: 0, end: word.length, candidates });
  assert.equal(choose('impelment', ['impediment', 'implement', 'impalement']), 1);
  assert.equal(choose('throughly', ['through', 'toughly', 'thoroughly'], ' check the report'), 2);
  assert.equal(choose('throughly', ['through', 'toughly', 'thoroughly']), 2);
  assert.equal(choose('carefuly', ['careful', 'carefully']), 1);
  assert.equal(choose('carefuly', ['careful', 'carefully'], ' check the report'), 1);
  assert.equal(choose('carefuly', ['careful', 'carefully'], '. Check the report'), 1);
  assert.equal(choose('eror', ['err', 'error', "e'er"]), 1);
  assert.equal(choose('completly', ['complexly', 'complete', 'completely']), 2);
  assert.equal(choose('quet', ['quest', 'quiet', 'quit']), -1);
  assert.equal(choose('spall', ['spill', 'spell']), -1);
  assert.equal(choose('Nisar', ['Nisan', 'Nizar']), -1);
  assert.equal(choose('user_name', ['username', 'user name']), -1);
  assert.equal(choose('teh', ['the', 'ten']), 0);
  assert.equal(choose('zzzzz', ['apple', 'orange']), -1);
  assert.equal(choose('spall', ['spill the', 'spell it']), -1);
});

test('short English phrases are checked instead of rejected before spelling detection', async () => {
  for (const text of ['how grammerly works ?', 'there is eror']) {
    const review = await proofreadLocally(text);
    assert.equal(review.supported, true, text);
    assert.ok(review.findings.some((finding) => finding.kind === 'Spelling'), text);
  }
  const error = await proofreadLocally('there is eror');
  assert.ok(error.correctedText.includes('error'));
  const complete = await proofreadLocally('i think the offline version is not completly working');
  assert.equal(complete.correctedText, 'I think the offline version is not completely working');
});

test('uncertain isolated input and non-English phrases are not silently corrected', async () => {
  for (const text of ['eror', 'completly', 'mujhe kal office jana hai', 'bonjour tout le monde']) {
    const review = await proofreadLocally(text);
    assert.equal(review.supported, false, text);
    assert.equal(review.findings.length, 0, text);
    assert.ok(review.reason);
  }
});

test('candidate selection uses code-point offsets after emoji', () => {
  assert.equal(selectSpellingCandidate({ text: '😀 impelment the changes', start: 2, end: 11, candidates: ['implement', 'impediment'] }), 0);
});

test('on-device checker declines uncertain Roman Urdu instead of guessing', async () => {
  const review = await proofreadLocally('mujhe kal office jana hai');
  assert.equal(review.supported, false);
  assert.equal(review.findings.length, 0);
  assert.match(review.reason, /uncertain/i);
});

test('frequency candidates and adjacent-word context distinguish quite from quiet', async () => {
  for (const [input, expected] of [
    ['I am not quet sure what to do.', 'I am not quite sure what to do.'],
    ['Please be quet in the library.', 'Please be quiet in the library.'],
    ['I am quet certain', 'I am quite certain'],
  ]) {
    const result = await proofreadLocally(input);
    assert.equal(result.correctedText, expected);
    const finding = result.findings.find((item) => item.original === 'quet');
    assert.equal(finding.appliedLocally, true);
  }
});

test('sentence-initial spelling preserves capitalisation and middle names remain review-only', async () => {
  const result = await proofreadLocally('Recieve the package at reception.');
  assert.equal(result.correctedText, 'Receive the package at reception.');
  const name = await proofreadLocally('Please send the Zyntrix report to Nisar today.');
  assert.ok(name.correctedText.includes('Zyntrix'));
  assert.ok(name.correctedText.includes('Nisar'));
});

test('offline checks protect URLs, email, paths, code, identifiers and acronyms', async () => {
  for (const text of [
    'Please visit https://example.com/quet?value=completly today.',
    'Please contact quet@example.com today.',
    'Please open E:\\Projects\\quet\\config.json today.',
    'Please check user_name and getUserProfile today.',
    'The API returns JSON over HTTPS.',
    'Please check `completly quet` today.',
  ]) {
    const result = await proofreadLocally(text);
    assert.equal(result.correctedText, text, text);
  }
});

test('context correction after emoji keeps offsets and surrounding text intact', async () => {
  const text = '😀 Please send the mesage today.';
  const result = await proofreadLocally(text);
  assert.equal(result.correctedText, '😀 Please send the message today.');
  const finding = result.findings.find((item) => item.original === 'mesage');
  assert.ok(finding);
  assert.equal([...text].slice(finding.start, finding.end).join(''), 'mesage');
});

test('each local finding carries exact edits so it can be accepted on its own', async () => {
  configureLocalProofreader({ dialect: 'american', words: [] });
  const { composeText, chooseOption } = await import('./finding-edits.js');
  const text = 'This is a example. Please send the mesage tomorow.';
  const review = await proofreadLocally(text);
  assert.equal(review.correctedText, composeText(text, review.findings), 'the proposed text is built from the chosen edits');
  for (const finding of review.findings) {
    assert.ok(Array.isArray(finding.edits) && finding.edits.length === finding.suggestions.length);
    assert.equal(finding.choice, finding.appliedLocally ? 0 : -1);
    for (const edit of finding.edits) assert.ok(edit.start >= 0 && edit.end <= [...text].length && edit.start <= edit.end);
  }
  const article = review.findings.findIndex((finding) => finding.original === 'a');
  assert.ok(article >= 0);
  const onlyArticleIgnored = chooseOption(review.findings, article, 'ignore');
  const result = composeText(text, onlyArticleIgnored);
  assert.ok(result.startsWith('This is a example.'), 'ignoring one finding keeps that text');
  const other = onlyArticleIgnored.find((finding, index) => index !== article && finding.choice >= 0);
  assert.ok(other, 'at least one other fix is proposed');
  assert.ok(result.includes(other.edits[0].text), 'other accepted fixes still apply');
});

test('a dropped apostrophe is offered as the contraction', async () => {
  configureLocalProofreader({ dialect: 'american', words: [] });
  const review = await proofreadLocally('I dont think we should wait.');
  const finding = review.findings.find((item) => item.original === 'dont');
  assert.ok(finding, 'the typo is flagged');
  assert.equal(finding.suggestions[0], "don't", `offered: ${finding.suggestions.join(', ')}`);
  assert.equal(review.correctedText, "I don't think we should wait.");
});

test('the on-device grammar model adds context fixes Harper misses, when its files are installed', async (t) => {
  const { access } = await import('node:fs/promises');
  try { await access(new URL('../assets/models/gec-t5-tiny/onnx/decoder_model_merged_quantized.onnx', import.meta.url)); }
  catch { t.skip('grammar model not fetched (npm run model:fetch)'); return; }
  configureLocalProofreader({ dialect: 'american', words: [] });
  const review = await proofreadLocally('The report are ready for review.');
  const finding = review.findings.find((item) => item.source === 'model');
  assert.ok(finding, JSON.stringify(review.findings));
  assert.equal(finding.original, 'are');
  assert.equal(finding.suggestions[0], 'is');
  assert.equal(review.correctedText, 'The report is ready for review.');
  const clean = await proofreadLocally('Her presentation covered pricing, onboarding and support.');
  assert.deepEqual(clean.findings, [], 'correct text is left alone');
});
