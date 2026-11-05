import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { configureLocalProofreader, proofreadLocally, stopLocalProofreader } from '../src/local-proofread.js';

const cases = JSON.parse(await readFile(new URL('../benchmark/offline-cases.json', import.meta.url)));
if (process.argv.includes('--basic')) process.env.CLEARWRITE_OFFLINE_CONTEXT = '0';
const rows = [];
const performanceSamples = {};
let steadyRssMiB;
try {
  for (const item of cases) {
    configureLocalProofreader({ dialect: item.dialect || 'american', words: item.words || [] });
    const start = performance.now();
    const result = await proofreadLocally(item.text);
    const fixes = Object.entries(item.fixes || {}).map(([original, expected]) => {
      const finding = result.findings.find((entry) => entry.original === original);
      const proposed = finding?.appliedLocally ? finding.suggestions[0] : null;
      return { original, expected, detected: Boolean(finding), top3: finding?.suggestions.includes(expected) || false, selected: proposed === expected, proposed };
    });
    rows.push({ id: item.id, split: item.split, ms: Math.round((performance.now() - start) * 100) / 100, supported: result.supported,
      clean: Boolean(item.clean), changedClean: Boolean(item.clean && result.supported && result.correctedText !== item.text),
      cleanFindings: item.clean ? result.findings.length : 0, fixes, output: result.correctedText || item.text });
  }
  configureLocalProofreader({ dialect: 'american', words: [] });
  for (const words of [10, 50, 500]) {
    const text = 'Please review the report before the meeting starts today. '.repeat(Math.ceil(words / 10)).trim();
    const times = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const started = performance.now();
      await proofreadLocally(text);
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    performanceSamples[words] = { p50Ms: Math.round(times[2]), p95Ms: Math.round(times[4]) };
  }
} finally {
  steadyRssMiB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  stopLocalProofreader();
}
const summarize = (split) => {
  const group = rows.filter((row) => row.split === split);
  const fixes = group.flatMap((row) => row.fixes);
  const times = group.map((row) => row.ms).sort((a, b) => a - b);
  return { cases: group.length, targets: fixes.length, detected: fixes.filter((fix) => fix.detected).length, top3: fixes.filter((fix) => fix.top3).length,
    selected: fixes.filter((fix) => fix.selected).length, wrongSelections: fixes.filter((fix) => fix.proposed !== null && !fix.selected).length, cleanCases: group.filter((row) => row.clean).length,
    changedClean: group.filter((row) => row.changedClean).length, cleanFindings: group.reduce((sum, row) => sum + row.cleanFindings, 0),
    p50Ms: times[Math.floor(times.length * 0.5)], p95Ms: times[Math.floor(times.length * 0.95)] };
};
const report = { label: process.argv[2] || 'current', coldStartMs: rows[0].ms, peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024), steadyRssMiB, performanceSamples, summary: { dev: summarize('dev'), test: summarize('test') }, rows };
await mkdir(new URL('../benchmark/results/', import.meta.url), { recursive: true });
await writeFile(new URL(`../benchmark/results/${report.label.replace(/[^a-z0-9-]/gi, '-')}.json`, import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ coldStartMs: report.coldStartMs, peakRssMiB: report.peakRssMiB, steadyRssMiB, performanceSamples, ...report.summary }, null, 2));
