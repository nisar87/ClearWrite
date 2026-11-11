// Personal learning (layer 2 of the roadmap). ClearWrite remembers, on this device only, which
// word-level changes the writer accepts and which they ignore:
//   - a change accepted at least twice (and far more often than ignored) is suggested again,
//     pre-selected, wherever the same word appears and nothing else already covers it;
//   - a suggestion the writer has ignored at least twice (more than accepted) is shown as ignored.
// Learning uses only the writer's own decisions, never provider output as training data. The
// file lives next to the personal dictionary; it is never uploaded or written to logs.
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const LEARNING_FILE = 'learned-corrections.json';
export const MAX_PATTERNS = 1000;
export const TRUST_ACCEPTS = 2;
export const SUPPRESS_REJECTS = 2;
const PHRASE = /^[\p{L}][\p{L}'’ -]{0,47}$/u;

const points = (value) => [...value];
const keyOf = (from, to) => `${from.toLocaleLowerCase()}\u0000${to}`;

// The changed words of a finding's chosen option: { from, to } spanning the finding and its
// edit, or null when it is not a short word-level change.
export function findingChange(text, finding, option = finding?.choice) {
  const edit = finding?.edits?.[option];
  if (!edit || !Number.isSafeInteger(finding.start) || !Number.isSafeInteger(finding.end)) return null;
  const source = points(text);
  const start = Math.min(finding.start, edit.start);
  const end = Math.max(finding.end, edit.end);
  const from = source.slice(start, end).join('');
  const to = source.slice(start, edit.start).join('') + edit.text + source.slice(edit.end, end).join('');
  if (from === to || !PHRASE.test(from.trim()) || !PHRASE.test(to.trim()) || from.trim() !== from || to.trim() !== to) return null;
  if (from.split(' ').length > 4 || to.split(' ').length > 4) return null;
  return { from, to };
}

export function isTrusted(pattern) {
  return pattern.accepts >= TRUST_ACCEPTS && pattern.accepts >= 3 * pattern.rejects;
}

export function isSuppressed(pattern) {
  return pattern.rejects >= SUPPRESS_REJECTS && pattern.rejects > pattern.accepts;
}

// Records the writer's decisions for one committed suggestion (applied, copied or replaced).
export function recordDecisions(patterns, text, findings = [], now = Date.now()) {
  const next = new Map(patterns.map((pattern) => [keyOf(pattern.from, pattern.to), { ...pattern }]));
  const touch = (change, field) => {
    const key = keyOf(change.from, change.to);
    const pattern = next.get(key) || { from: change.from.toLocaleLowerCase(), to: change.to, accepts: 0, rejects: 0 };
    pattern[field] += 1;
    pattern.lastUsed = now;
    next.set(key, pattern);
  };
  for (const finding of findings) {
    if (!Array.isArray(finding.edits)) continue;
    if (finding.ignored) {
      const change = findingChange(text, finding, 0);
      if (change) touch(change, 'rejects');
    } else if (finding.choice >= 0) {
      const change = findingChange(text, finding, finding.choice);
      if (change) touch(change, 'accepts');
    }
  }
  return [...next.values()].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_PATTERNS);
}

function matchCase(original, replacement) {
  if (original[0] && original[0] === original[0].toLocaleUpperCase() && original[0] !== original[0].toLocaleLowerCase()) {
    return replacement[0].toLocaleUpperCase() + replacement.slice(1);
  }
  return replacement;
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Applies what was learned to a suggestion's findings (same shape as on-device findings):
// suppressed suggestions become ignored; trusted changes are added where nothing covers them.
export function applyLearning(text, findings = [], patterns = []) {
  if (!patterns.length) return { findings, learned: 0, suppressed: 0 };
  const byKey = new Map(patterns.map((pattern) => [keyOf(pattern.from, pattern.to), pattern]));
  let suppressed = 0;
  const adjusted = findings.map((finding) => {
    if (!Array.isArray(finding.edits) || finding.ignored || !(finding.choice >= 0 || finding.edits.length)) return finding;
    const change = findingChange(text, finding, finding.choice >= 0 ? finding.choice : 0);
    const pattern = change && byKey.get(keyOf(change.from, change.to));
    if (!pattern || !isSuppressed(pattern)) return finding;
    suppressed += 1;
    return { ...finding, choice: -1, ignored: true, message: 'You usually ignore this suggestion.' };
  });
  const covered = adjusted.filter((finding) => Number.isSafeInteger(finding.start)).map((finding) => [finding.start, finding.end]);
  const added = [];
  const lowered = text.toLocaleLowerCase();
  for (const pattern of patterns.filter(isTrusted)) {
    const regex = new RegExp(`(?<![\\p{L}\\p{N}'’])${escape(pattern.from)}(?![\\p{L}\\p{N}'’])`, 'gu');
    let match;
    while ((match = regex.exec(lowered))) {
      const start = points(text.slice(0, match.index)).length;
      const end = start + points(match[0]).length;
      if (covered.some(([from, to]) => start < to && end > from)) continue;
      const original = points(text).slice(start, end).join('');
      const replacement = matchCase(original, pattern.to);
      if (replacement === original) continue;
      covered.push([start, end]);
      added.push({
        message: 'You usually make this change.',
        original,
        suggestions: [replacement],
        edits: [{ start, end, text: replacement }],
        choice: 0,
        ignored: false,
        appliedLocally: true,
        kind: 'Learned',
        source: 'learned',
        start,
        end,
      });
    }
  }
  return { findings: [...adjusted, ...added].sort((a, b) => (a.start ?? 0) - (b.start ?? 0)), learned: added.length, suppressed };
}

export function parseLearningFile(contents) {
  const parsed = JSON.parse(contents);
  const list = Array.isArray(parsed?.patterns) ? parsed.patterns : [];
  return list.filter((pattern) => typeof pattern?.from === 'string' && typeof pattern?.to === 'string' && PHRASE.test(pattern.from) && PHRASE.test(pattern.to))
    .map((pattern) => ({ from: pattern.from, to: pattern.to, accepts: Math.max(0, Number(pattern.accepts) || 0), rejects: Math.max(0, Number(pattern.rejects) || 0), lastUsed: Number(pattern.lastUsed) || 0 }))
    .slice(0, MAX_PATTERNS);
}

export function createLearningMemory(directory) {
  const file = path.join(directory, LEARNING_FILE);
  let patterns = [];
  let writes = Promise.resolve();
  const persist = () => {
    writes = writes.catch(() => {}).then(async () => {
      await mkdir(directory, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, patterns }, null, 2), { flag: 'wx' });
        await rename(temporary, file);
      } finally { await unlink(temporary).catch(() => {}); }
    });
    return writes;
  };
  return {
    file,
    async load() {
      try { patterns = parseLearningFile(await readFile(file, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw new Error('Learned corrections could not be read; the file was left unchanged.');
        patterns = [];
      }
      return this.list();
    },
    patterns: () => patterns,
    list: () => patterns.map((pattern) => ({ ...pattern, trusted: isTrusted(pattern), suppressed: isSuppressed(pattern) })),
    async record(text, findings) {
      const next = recordDecisions(patterns, text, findings);
      if (JSON.stringify(next) === JSON.stringify(patterns)) return false;
      patterns = next;
      await persist();
      return true;
    },
    async remove(from, to) {
      const before = patterns.length;
      patterns = patterns.filter((pattern) => keyOf(pattern.from, pattern.to) !== keyOf(String(from), String(to)));
      if (patterns.length !== before) await persist();
      return patterns.length !== before;
    },
    async clear() {
      patterns = [];
      await persist();
    },
  };
}
