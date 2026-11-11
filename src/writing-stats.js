// Writing stats and correction history (roadmap Phase 2). Kept on this device only, next to
// the dictionary; nothing is uploaded or written to logs.
//   - words checked: per field, the largest word count seen that day (so re-checking the same
//     text while typing never counts it twice);
//   - mistakes found: distinct findings per field and day;
//   - fixed / dismissed: the writer's committed decisions (applied, copied or replaced);
//   - history: each fix with a short snippet of text around it, for review. History can be
//     turned off and cleared; turning it off deletes what was kept.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const STATS_FILE = 'writing-stats.json';
export const KEEP_DAYS = 90;
export const MAX_HISTORY = 1000;
export const CHART_DAYS = 30;
const MAX_SEEN_PER_DAY = 3000;
const MAX_FIELDS_PER_DAY = 500;
const MAX_MISTAKES = 500;
const CONTEXT = 32;

const points = (value) => [...String(value ?? '')];
const shortHash = (value) => createHash('sha256').update(String(value)).digest('base64url').slice(0, 12);

export function dayKey(time = Date.now()) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function countWords(text) {
  return (String(text ?? '').match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) || []).length;
}

export function emptyStats() {
  return { version: 1, historyEnabled: true, days: {}, mistakes: [], history: [] };
}

function day(stats, key) {
  stats.days[key] ||= { words: 0, found: 0, fixed: 0, dismissed: 0, fields: {}, seen: [] };
  return stats.days[key];
}

// A text snippet around [start, end): before and after the change, trimmed to whole words.
export function snippet(text, start, end, replacement) {
  const source = points(text);
  let from = Math.max(0, start - CONTEXT);
  let to = Math.min(source.length, end + CONTEXT);
  while (from > 0 && from < start && !/\s/u.test(source[from - 1])) from += 1;
  while (to < source.length && to > end && !/\s/u.test(source[to])) to -= 1;
  const lead = (from > 0 ? '…' : '') + source.slice(from, start).join('').replace(/\s+/gu, ' ');
  const tail = source.slice(end, to).join('').replace(/\s+/gu, ' ') + (to < source.length ? '…' : '');
  return { lead, from: source.slice(start, end).join(''), to: replacement, tail };
}

// A finding's chosen change as { start, end, from, to }, or null.
function change(text, finding, option) {
  const edit = finding?.edits?.[option];
  if (!edit || !Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end)) return null;
  const source = points(text);
  if (edit.start < 0 || edit.end > source.length || edit.start > edit.end) return null;
  const from = source.slice(edit.start, edit.end).join('');
  return from === edit.text ? null : { start: edit.start, end: edit.end, from, to: edit.text };
}

// A completed check of `text` in the field `fieldKey`.
export function recordReview(stats, fieldKey, text, findings = [], now = Date.now()) {
  const entry = day(stats, dayKey(now));
  const field = shortHash(fieldKey);
  if (field in entry.fields || Object.keys(entry.fields).length < MAX_FIELDS_PER_DAY) {
    const words = countWords(text);
    if (words > (entry.fields[field] || 0)) {
      entry.words += words - (entry.fields[field] || 0);
      entry.fields[field] = words;
    }
  }
  const seen = new Set(entry.seen);
  for (const finding of findings) {
    if (!Array.isArray(finding?.edits) || !finding.edits.length || finding.source === 'learned') continue;
    const id = shortHash(`${field}\u0000${finding.original ?? ''}\u0000${finding.edits[0]?.text ?? ''}`);
    if (seen.has(id) || seen.size >= MAX_SEEN_PER_DAY) continue;
    seen.add(id);
    entry.found += 1;
  }
  entry.seen = [...seen];
  return stats;
}

// The writer committed a suggestion: chosen findings were fixed, ignored ones dismissed.
export function recordDecisions(stats, text, findings = [], { app = '', now = Date.now() } = {}) {
  const entry = day(stats, dayKey(now));
  const mistakes = new Map(stats.mistakes.map((item) => [`${item.from}\u0000${item.to}`, item]));
  let changed = false;
  for (const finding of findings) {
    if (!Array.isArray(finding?.edits) || !finding.edits.length) continue;
    if (finding.ignored) { entry.dismissed += 1; changed = true; continue; }
    if (!(finding.choice >= 0)) continue;
    const fix = change(text, finding, finding.choice);
    if (!fix) continue;
    entry.fixed += 1;
    changed = true;
    const key = `${fix.from.toLocaleLowerCase()}\u0000${fix.to}`;
    const mistake = mistakes.get(key) || { from: fix.from.toLocaleLowerCase(), to: fix.to, count: 0, last: 0 };
    mistake.count += 1;
    mistake.last = now;
    mistakes.set(key, mistake);
    if (stats.historyEnabled) {
      stats.history.unshift({ id: randomUUID(), at: now, app: String(app || '').slice(0, 60), kind: String(finding.kind || (finding.source === 'learned' ? 'Learned' : 'Correction')).slice(0, 30), ...snippet(text, fix.start, fix.end, fix.to) });
    }
  }
  stats.mistakes = [...mistakes.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, MAX_MISTAKES);
  stats.history = stats.history.slice(0, MAX_HISTORY);
  return changed;
}

export function prune(stats, now = Date.now()) {
  const oldest = dayKey(now - KEEP_DAYS * 86400000);
  for (const key of Object.keys(stats.days)) if (key < oldest) delete stats.days[key];
  const cutoff = now - KEEP_DAYS * 86400000;
  stats.history = stats.history.filter((item) => item.at >= cutoff).slice(0, MAX_HISTORY);
  return stats;
}

// What the window shows. `days` runs oldest to newest and always has CHART_DAYS entries.
export function summarize(stats, now = Date.now(), historyLimit = 300) {
  const today = stats.days[dayKey(now)] || { words: 0, found: 0, fixed: 0, dismissed: 0 };
  const days = [];
  for (let back = CHART_DAYS - 1; back >= 0; back -= 1) {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - back);
    const key = dayKey(date.getTime());
    const entry = stats.days[key];
    days.push({ day: key, words: entry?.words || 0, found: entry?.found || 0, fixed: entry?.fixed || 0, dismissed: entry?.dismissed || 0 });
  }
  const total = days.reduce((sum, item) => ({ words: sum.words + item.words, found: sum.found + item.found, fixed: sum.fixed + item.fixed, dismissed: sum.dismissed + item.dismissed }), { words: 0, found: 0, fixed: 0, dismissed: 0 });
  const decided = total.fixed + total.dismissed;
  return {
    today: { words: today.words, found: today.found, fixed: today.fixed, dismissed: today.dismissed },
    month: { ...total, acceptRate: decided ? Math.round((100 * total.fixed) / decided) : null },
    days,
    top: stats.mistakes.slice(0, 5).map(({ from, to, count }) => ({ from, to, count })),
    historyEnabled: stats.historyEnabled,
    historyCount: stats.history.length,
    history: [...stats.history].sort((a, b) => b.at - a.at).slice(0, historyLimit),
  };
}

export function parseStatsFile(contents) {
  const parsed = JSON.parse(contents);
  const stats = emptyStats();
  if (parsed?.historyEnabled === false) stats.historyEnabled = false;
  if (parsed?.days && typeof parsed.days === 'object') {
    for (const [key, value] of Object.entries(parsed.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== 'object') continue;
      const number = (field) => Math.max(0, Math.floor(Number(value[field]) || 0));
      stats.days[key] = {
        words: number('words'), found: number('found'), fixed: number('fixed'), dismissed: number('dismissed'),
        fields: Object.fromEntries(Object.entries(value.fields || {}).filter(([, words]) => Number.isFinite(words)).slice(0, MAX_FIELDS_PER_DAY)),
        seen: Array.isArray(value.seen) ? value.seen.filter((id) => typeof id === 'string').slice(0, MAX_SEEN_PER_DAY) : [],
      };
    }
  }
  if (Array.isArray(parsed?.mistakes)) {
    stats.mistakes = parsed.mistakes.filter((item) => typeof item?.from === 'string' && typeof item?.to === 'string')
      .map((item) => ({ from: item.from.slice(0, 60), to: item.to.slice(0, 60), count: Math.max(0, Number(item.count) || 0), last: Number(item.last) || 0 })).slice(0, MAX_MISTAKES);
  }
  if (Array.isArray(parsed?.history) && stats.historyEnabled) {
    stats.history = parsed.history.filter((item) => typeof item?.id === 'string' && Number.isFinite(item.at) && typeof item.from === 'string' && typeof item.to === 'string')
      .map((item) => ({ id: item.id, at: item.at, app: String(item.app || ''), kind: String(item.kind || ''), lead: String(item.lead || ''), from: item.from, to: item.to, tail: String(item.tail || '') }))
      .slice(0, MAX_HISTORY);
  }
  return stats;
}

export function createWritingStats(directory) {
  const file = path.join(directory, STATS_FILE);
  let stats = emptyStats();
  let writes = Promise.resolve();
  let timer;
  const persist = () => {
    writes = writes.catch(() => {}).then(async () => {
      await mkdir(directory, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(stats), { flag: 'wx' });
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch(() => {});
      }
    });
    return writes;
  };
  // Reviews happen at every pause in typing; their counts are saved a little later, together.
  const persistSoon = () => { clearTimeout(timer); timer = setTimeout(() => { void persist().catch(() => {}); }, 4000); };
  return {
    async load() {
      try { stats = prune(parseStatsFile(await readFile(file, 'utf8'))); }
      catch (error) { if (error.code !== 'ENOENT') stats = emptyStats(); }
      return summarize(stats);
    },
    summary: (now) => summarize(stats, now),
    review(fieldKey, text, findings) { recordReview(stats, fieldKey, text, findings); persistSoon(); },
    async decide(text, findings, details) {
      if (!recordDecisions(stats, text, findings, details)) return false;
      prune(stats);
      clearTimeout(timer);
      await persist();
      return true;
    },
    async setHistoryEnabled(enabled) {
      stats.historyEnabled = Boolean(enabled);
      if (!stats.historyEnabled) stats.history = [];
      clearTimeout(timer);
      await persist();
    },
    async clearHistory() { stats.history = []; clearTimeout(timer); await persist(); },
    async removeEntry(id) { stats.history = stats.history.filter((item) => item.id !== id); clearTimeout(timer); await persist(); },
    async resetStats() { stats = { ...emptyStats(), historyEnabled: stats.historyEnabled, history: stats.history }; clearTimeout(timer); await persist(); },
    entry: (id) => stats.history.find((item) => item.id === id),
    flush: () => { clearTimeout(timer); return persist(); },
  };
}
