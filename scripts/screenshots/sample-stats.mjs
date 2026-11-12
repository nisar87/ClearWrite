// Sample writing stats for screenshots (made-up data, generated with a fixed seed).
import { emptyStats, recordReview, recordDecisions, summarize } from '../../src/writing-stats.js';
const stats = emptyStats();
const now = Date.now();
const words = ['recieve', 'teh', 'definately', 'seperate', 'occured', 'wich'];
const fixes = { recieve: 'receive', teh: 'the', definately: 'definitely', seperate: 'separate', occured: 'occurred', wich: 'which' };
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let back = 29; back >= 0; back -= 1) {
  if (rnd() < 0.15) continue;
  const at = now - back * 86400000;
  const n = Math.floor(rnd() * 9) + 1;
  for (let i = 0; i < n; i += 1) {
    const w = words[Math.floor(rnd() * words.length)];
    const text = `Please ${w} the report we discussed on Monday before the meeting with the team.`;
    const f = { kind: 'Spelling', original: w, edits: [{ start: 7, end: 7 + w.length, text: fixes[w] }], choice: rnd() < 0.8 ? 0 : -1, start: 7, end: 7 + w.length };
    if (f.choice < 0) f.ignored = true;
    recordReview(stats, `field${back}-${i}`, text + ' '.repeat(i) + 'More words here to count. '.repeat(Math.floor(rnd() * 20)), [f], at);
    recordDecisions(stats, text, [f], { app: ['notepad', 'ms-teams', 'outlook'][i % 3], now: at - i * 600000 });
  }
}
process.stdout.write(JSON.stringify(summarize(stats, now)));
