import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
const idsIn = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const idsUsed = (script) => new Set([...script.matchAll(/\$\(\s*['`]([a-z0-9-]+)['`]\s*\)/g)].map((match) => match[1]));

for (const [page, script] of [['index.html', 'app.js'], ['assistant.html', 'assistant.js'], ['card.html', 'card.js']]) {
  test(`every element ${script} looks up exists in ${page}`, () => {
    const present = idsIn(read(page));
    const missing = [...idsUsed(read(script))].filter((id) => !present.has(id));
    assert.deepEqual(missing, []);
  });
}

test('every page loads the shared design tokens before its own styles', () => {
  for (const page of ['index.html', 'assistant.html', 'badge.html', 'card.html']) {
    const html = read(page);
    const tokens = html.indexOf('tokens.css');
    assert.ok(tokens > 0, `${page} does not load tokens.css`);
    assert.ok([...html.matchAll(/href="\.?\/?([a-z-]+\.css)"/g)].every((match) => match[1] === 'tokens.css' || html.indexOf(match[1]) > tokens), `${page} loads a stylesheet before tokens.css`);
  }
});

test('every icon the main window uses is defined', () => {
  const html = read('index.html');
  const defined = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]));
  const used = [...html.matchAll(/<use href="#([^"]+)"/g), ...read('app.js').matchAll(/'#(i-[a-z-]+)'/g)].map((match) => match[1]);
  assert.deepEqual(used.filter((id) => !defined.has(id)), []);
});

test('every settings tab has a panel', () => {
  const html = read('index.html');
  const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]);
  const panels = [...html.matchAll(/data-panel="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabs, panels);
});
