// Evaluates a small sentence-level grammar-correction model on the ClearWrite benchmark, alone
// and as ClearWrite would use it (each change reviewed by the meaning guard in ai-changes.js).
// Usage: node scripts/evaluate-gec-model.js <hf-model-id> [label]
// Requires @huggingface/transformers (installed only for evaluation: npm i --no-save).
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { reviewAiCorrection } from '../src/ai-changes.js';

const modelId = process.argv[2];
const label = process.argv[3] || modelId.replace(/[^a-z0-9-]/gi, '-');
if (!modelId) throw new Error('Usage: evaluate-gec-model.js <model id> [label]');
const { pipeline, env } = await import('@huggingface/transformers');
env.allowLocalModels = true;

const started = performance.now();
const corrector = await pipeline('text2text-generation', modelId, { dtype: 'q8' });
const loadMs = Math.round(performance.now() - started);
const rssAfterLoad = Math.round(process.memoryUsage().rss / 1048576);
const correct = async (text) => {
  const [result] = await corrector(text, { max_new_tokens: Math.min(256, text.length + 32), do_sample: false, num_beams: 1 });
  return String(result.generated_text ?? '').trim();
};

const cases = JSON.parse(await readFile(new URL('../benchmark/offline-cases.json', import.meta.url)));
const rows = [];
const times = [];
for (const item of cases) {
  if (!['grammar', 'holdout', 'prose', 'test', 'dev'].includes(item.split)) continue;
  const begin = performance.now();
  const raw = await correct(item.text);
  times.push(performance.now() - begin);
  const guarded = reviewAiCorrection(item.text, raw).text;
  const expected = item.expected ?? (item.clean ? item.text : null);
  const fixes = Object.entries(item.fixes || {});
  rows.push({
    id: item.id, split: item.split, clean: Boolean(item.clean), raw, guarded, expected,
    rawExact: expected !== null ? raw === expected : undefined,
    guardedExact: expected !== null ? guarded === expected : undefined,
    rawChanged: raw !== item.text, guardedChanged: guarded !== item.text,
    fixesHit: fixes.filter(([, fix]) => guarded.includes(fix)).length, fixesTotal: fixes.length,
  });
}
times.sort((a, b) => a - b);
const group = (split) => {
  const list = rows.filter((row) => row.split === split);
  const graded = list.filter((row) => row.expected !== null && !row.clean);
  return {
    cases: list.length,
    rawExact: graded.filter((row) => row.rawExact).length,
    guardedExact: graded.filter((row) => row.guardedExact).length,
    guardedWrongChanges: graded.filter((row) => row.guardedChanged && !row.guardedExact).length,
    cleanChangedRaw: list.filter((row) => row.clean && row.rawChanged).length,
    cleanChangedGuarded: list.filter((row) => row.clean && row.guardedChanged).length,
    spellingFixes: `${list.reduce((sum, row) => sum + row.fixesHit, 0)}/${list.reduce((sum, row) => sum + row.fixesTotal, 0)}`,
  };
};
const report = {
  model: modelId, loadMs, rssAfterLoadMiB: rssAfterLoad, peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
  sentenceP50Ms: Math.round(times[Math.floor(times.length / 2)]), sentenceP95Ms: Math.round(times[Math.floor(times.length * 0.95)]),
  summary: { grammar: group('grammar'), holdout: group('holdout'), prose: group('prose'), test: group('test'), dev: group('dev') },
  rows,
};
await mkdir(new URL('../benchmark/results/', import.meta.url), { recursive: true });
await writeFile(new URL(`../benchmark/results/model-${label}.json`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
for (const row of rows.filter((item) => (item.clean && item.guardedChanged) || (!item.clean && item.expected && !item.guardedExact))) {
  console.log(`${row.split} ${row.id}: ${JSON.stringify(row.guarded)}${row.raw !== row.guarded ? ` (raw ${JSON.stringify(row.raw)})` : ''}`);
}
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
