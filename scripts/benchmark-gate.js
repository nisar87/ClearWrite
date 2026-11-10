// Fails when a benchmark report regresses past the limits in benchmark/gates.json.
// Usage: node scripts/benchmark-gate.js <report label>   (reads benchmark/results/<label>.json)
import { readFile } from 'node:fs/promises';

const label = process.argv[2] || 'ci';
const report = JSON.parse(await readFile(new URL(`../benchmark/results/${label}.json`, import.meta.url)));
const gates = JSON.parse(await readFile(new URL('../benchmark/gates.json', import.meta.url)));
const s = report.summary;
const ratio = (value) => Number(String(value).split('/')[0]);
const measured = {
  spellingSelected: s.test.selected,
  spellingWrong: s.test.wrongSelections + s.dev.wrongSelections,
  grammarExact: s.grammar.grammarExact,
  grammarWrongChanges: s.grammar.grammarWrongChanges,
  holdoutExact: s.holdout.grammarExact,
  holdoutDetected: ratio(s.holdout.grammarTargetsDetected),
  holdoutWrongChanges: s.holdout.grammarWrongChanges,
  cleanChanged: s.test.changedClean + s.prose.changedClean,
  cleanFindings: s.test.cleanFindings + s.prose.cleanFindings,
  shortTextP95Ms: report.performanceSamples['10'].p95Ms,
};
const failures = [];
for (const [name, minimum] of Object.entries(gates.minimum)) if (measured[name] < minimum) failures.push(`${name} ${measured[name]} < ${minimum}`);
for (const [name, maximum] of Object.entries(gates.maximum)) if (measured[name] > maximum) failures.push(`${name} ${measured[name]} > ${maximum}`);
console.log(JSON.stringify({ measured, gates }, null, 2));
if (failures.length) {
  console.error(`Benchmark gate failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('Benchmark gate passed.');
