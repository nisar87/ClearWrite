import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiFindings, changeHunks, meaningRisks, reviewAiCorrection, rewriteWarning } from './ai-changes.js';
import { chooseOption, composeText } from './finding-edits.js';

test('AI corrections become individual word-level changes in code points', () => {
  const original = '😀 Please send teh reprot by friday.';
  const corrected = '😀 Please send the report by Friday.';
  const hunks = changeHunks(original, corrected);
  assert.deepEqual(hunks.map((hunk) => [hunk.before, hunk.after]), [['teh', 'the'], ['reprot', 'report'], ['friday', 'Friday']]);
  const findings = aiFindings(original, corrected);
  assert.equal(composeText(original, findings), corrected, 'all safe changes are pre-selected');
  const withoutSecond = chooseOption(findings, 1, 'ignore');
  assert.equal(composeText(original, withoutSecond), '😀 Please send the reprot by Friday.');
});

test('plain spelling, grammar and punctuation fixes are not flagged', () => {
  for (const [before, after] of [
    ['i dont know where it is', "I don't know where it is."],
    ['Their going to the store', "They're going to the store"],
    ['How grammerly works', 'How Grammarly works'],
    ['Lets meet at 5pm', "Let's meet at 5pm"],
    ['We cant do it', "We can't do it"],
    ['We cannot do it', "We can't do it"],
  ]) {
    const review = reviewAiCorrection(before, after);
    assert.equal(review.flagged, 0, `${before} -> ${after}`);
    assert.equal(review.text, after);
  }
});

test('changes to numbers, negation and names are flagged and not pre-selected', () => {
  const cases = [
    ["I can't attend on 12 May.", 'I can attend on 21 May.', ['number', 'negation']],
    ['The invoice total is 1,250 dollars.', 'The invoice total is 1,520 dollars.', ['number']],
    ['We will not renew the contract.', 'We will renew the contract.', ['negation']],
    ['Please send it to Morgan today.', 'Please send it to the team today.', ['name']],
    ['Nothing was changed.', 'Something was changed.', ['negation']],
  ];
  for (const [before, after, expected] of cases) {
    const review = reviewAiCorrection(before, after);
    const risks = new Set(review.findings.flatMap((finding) => finding.risks));
    for (const risk of expected) assert.ok(risks.has(risk), `${risk} in ${before} -> ${after}`);
    assert.ok(review.flagged >= 1);
    for (const finding of review.findings.filter((item) => item.risks.length)) {
      assert.equal(finding.choice, -1, 'risky change is not applied unless accepted');
      assert.match(finding.message, /Check it keeps your meaning/);
    }
  }
  // The risky change is excluded from the proposed text but can still be accepted.
  const review = reviewAiCorrection('We will not renew teh contract.', 'We will renew the contract.');
  assert.equal(review.text, 'We will not renew the contract.');
  const risky = review.findings.findIndex((finding) => finding.risks.length);
  assert.equal(composeText('We will not renew teh contract.', chooseOption(review.findings, risky, 0)), 'We will renew the contract.');
});

test('removing a negation word is always confirmed, even when it is likely a typo', () => {
  // "no" -> "know" is usually a typo fix, but text alone cannot tell; the writer confirms it.
  const review = reviewAiCorrection('i dont no where it is', "I don't know where it is.");
  assert.equal(review.flagged, 1);
  assert.equal(review.text, "I don't no where it is.");
});

test('a capitalised word at the start of a sentence is not treated as a name', () => {
  assert.deepEqual(meaningRisks('Their', "They're"), []);
  const review = reviewAiCorrection('It works. Their going home.', "It works. They're going home.");
  assert.equal(review.flagged, 0);
});

test('identical text yields no changes; rewrites get a meaning warning', () => {
  assert.deepEqual(aiFindings('Same text.', 'Same text.'), []);
  assert.equal(rewriteWarning('Ship 3 boxes, not 4.', 'Please ship three boxes rather than four.'), 'Check the result: it changes a number and a negation (not, no, never…).');
  assert.equal(rewriteWarning('Thanks for the update.', 'Thank you for the update.'), '');
});
