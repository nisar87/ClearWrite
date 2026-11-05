import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = (name) => readFile(new URL(`../benchmark/results/${name}.json`, import.meta.url), 'utf8').then(JSON.parse);
const [basic, enhanced] = await Promise.all([read('basic-final'), read('enhanced-final')]);
assert.deepEqual(basic.rows.map((row) => row.id), enhanced.rows.map((row) => row.id), 'Compare the same fixtures');
for (const split of ['dev', 'test']) {
  const a = basic.summary[split], b = enhanced.summary[split];
  assert.ok(b.selected >= a.selected, `${split}: correction coverage regressed`);
  assert.ok(b.wrongSelections <= a.wrongSelections, `${split}: wrong target substitutions increased`);
  assert.ok(b.changedClean <= a.changedClean, `${split}: changes to clean text increased`);
  assert.ok(b.cleanFindings <= a.cleanFindings, `${split}: clean-text flags increased`);
}
assert.ok(enhanced.summary.test.p95Ms < 150, 'Short-text p95 exceeds the initial 150 ms budget');
assert.ok(enhanced.steadyRssMiB <= basic.steadyRssMiB + 256, 'Enhanced worker exceeds the additional 256 MiB RSS budget');
console.log('PASS: curated-fixture quality, safety, short-text latency and additional-memory gates. This is not a general accuracy guarantee.');
