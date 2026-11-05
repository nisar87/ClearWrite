import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { actionRequiresAi, AI_ONLY_ACTIONS, createProofreadingRouter, DEFAULT_PROOFREADING_MODE, migrateProofreadingPreferences, normalizeEnglishDialect, normalizeProofreadingMode, OFFLINE_MIGRATION_NOTICE } from './proofreading-mode.js';

function fakeProvider() {
  const calls = [];
  return { calls, send: async (action, text) => { calls.push({ action, text }); return `AI:${text}`; } };
}

// Any accidental network use during these tests fails loudly.
function guardNetwork(t) {
  const original = globalThis.fetch;
  const attempts = [];
  globalThis.fetch = async (...args) => { attempts.push(String(args[0])); throw new Error('Network blocked in test'); };
  t.after(() => { globalThis.fetch = original; });
  return attempts;
}

test('new installations default to Offline only', () => {
  assert.equal(DEFAULT_PROOFREADING_MODE, 'offline');
  const fresh = migrateProofreadingPreferences(undefined);
  assert.deepEqual(fresh, { mode: 'offline', dialect: 'american', notice: '' });
  assert.equal(migrateProofreadingPreferences({}).mode, 'offline');
});

test('Offline only makes zero provider calls, even with Gemini or ChatGPT configured and ready', async (t) => {
  const network = guardNetwork(t);
  for (const provider of ['gemini', 'chatgpt']) {
    const fake = fakeProvider();
    const router = createProofreadingRouter({ getMode: () => 'offline', isAiReady: () => true, sendToProvider: fake.send });
    assert.equal(router.canUseAi(), false, provider);
    assert.equal(router.reviewSource(), 'local');
    for (const action of ['correct', ...AI_ONLY_ACTIONS]) {
      await assert.rejects(router.requestAi(action, 'Teh draft text that must stay local.'), { code: 'OFFLINE_MODE' });
    }
    assert.equal(fake.calls.length, 0, `${provider}: no request reached the provider`);
  }
  assert.deepEqual(network, []);
});

test('AI-assisted sends to the provider only after the user opts in, and only when the provider is ready', async () => {
  let mode = 'offline';
  let ready = false;
  const fake = fakeProvider();
  const router = createProofreadingRouter({ getMode: () => mode, isAiReady: () => ready, sendToProvider: fake.send });
  await assert.rejects(router.requestAi('correct', 'Draft.'), { code: 'OFFLINE_MODE' });
  mode = 'ai';
  await assert.rejects(router.requestAi('correct', 'Draft.'), /not connected/);
  assert.equal(router.reviewSource(), 'local', 'opted in but no provider: still checked locally');
  ready = true;
  assert.equal(router.reviewSource(), 'ai');
  assert.equal(await router.requestAi('correct', 'Draft.'), 'AI:Draft.');
  assert.deepEqual(fake.calls, [{ action: 'correct', text: 'Draft.' }]);
  mode = 'offline';
  await assert.rejects(router.requestAi('clearer', 'Draft.'), /needs AI-assisted mode/);
  assert.equal(fake.calls.length, 1, 'switching back to Offline only stops requests immediately');
});

test('ordinary proofreading never requires AI; rewrite and reply actions do', () => {
  assert.equal(actionRequiresAi('correct'), false);
  for (const action of ['clearer', 'professional', 'friendly', 'continue', 'reply']) assert.equal(actionRequiresAi(action), true, action);
});

test('migration: existing installs move to Offline only, keep provider settings, and are told once', () => {
  const existing = { provider: 'gemini', selectedModels: { gemini: 'gemini-2.5-flash' }, monitorEnabled: true, privacyDefaultsVersion: 1 };
  const migrated = migrateProofreadingPreferences(existing);
  assert.equal(migrated.mode, 'offline');
  assert.equal(migrated.dialect, 'indian', 'keeps the dialect existing installs were already checked with');
  assert.equal(migrated.notice, OFFLINE_MIGRATION_NOTICE);
  assert.equal(existing.provider, 'gemini', 'provider settings are not modified');
  const optedIn = migrateProofreadingPreferences({ ...existing, proofreadingMode: 'ai', englishDialect: 'british' });
  assert.deepEqual(optedIn, { mode: 'ai', dialect: 'british', notice: '' }, 'a saved choice persists and the notice is not repeated');
  assert.equal(migrateProofreadingPreferences({ ...existing, proofreadingMode: 'cloud' }).mode, 'offline', 'unknown values fall back to Offline only');
});

test('mode and dialect values are validated', () => {
  assert.equal(normalizeProofreadingMode('ai'), 'ai');
  assert.throws(() => normalizeProofreadingMode('auto'), /Offline only or AI-assisted/);
  assert.equal(normalizeEnglishDialect('canadian'), 'canadian');
  assert.throws(() => normalizeEnglishDialect('klingon'), /supported English dialect/);
});

test('structure: provider streaming calls exist only inside the gated provider function', () => {
  const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  const gated = source.slice(source.indexOf('async function sendToProvider('), source.indexOf('// end sendToProvider'));
  assert.ok(gated.length > 0, 'sendToProvider is present');
  const outside = source.replace(gated, '');
  const streamCalls = outside.match(/chatgpt\.streamResponse\(|streamGemini\(\{/g) || [];
  // The only remaining direct call is the explicit "Test Gemini" button in Settings.
  assert.equal(streamCalls.length, 1, outside.match(/.*(chatgpt\.streamResponse\(|streamGemini\(\{).*/g)?.join('\n'));
  assert.match(source, /async function testGeminiConnection\(\)[\s\S]{0,400}streamGemini\(\{/);
  assert.match(source, /spellcheck: false/, 'Chromium spellchecker (downloads dictionaries) is disabled');
});

test('AI-assisted failure falls back to the on-device result without changing the mode', async () => {
  let mode = 'ai';
  const local = async (text) => ({ supported: true, correctedText: text.replace('a example', 'an example'), findings: [] });
  const failing = createProofreadingRouter({ getMode: () => mode, isAiReady: () => true, sendToProvider: async () => { throw new Error('fetch failed'); } });
  const result = await failing.correctWithFallback('This is a example.', { proofreadLocal: local });
  assert.equal(result.source, 'local');
  assert.match(result.aiError.message, /fetch failed/);
  assert.equal(result.local.correctedText, 'This is an example.');
  assert.equal(mode, 'ai', 'never silently switches mode');

  const timeout = AbortSignal.timeout(1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const slow = createProofreadingRouter({ getMode: () => 'ai', isAiReady: () => true, sendToProvider: async (_a, _t, signal) => { signal.throwIfAborted(); return 'late'; } });
  assert.equal((await slow.correctWithFallback('This is a example.', { proofreadLocal: local, signal: timeout })).source, 'local', 'a timeout falls back');

  const cancel = new AbortController();
  cancel.abort();
  await assert.rejects(slow.correctWithFallback('This is a example.', { proofreadLocal: local, signal: cancel.signal, cancelSignal: cancel.signal }), 'a user/newer-edit cancel does not produce a stale fallback');
});

test('correctWithFallback in Offline only uses only the local checker, even when AI is ready', async () => {
  const fake = fakeProvider();
  let localCalls = 0;
  const router = createProofreadingRouter({ getMode: () => 'offline', isAiReady: () => true, sendToProvider: fake.send });
  const result = await router.correctWithFallback('Teh draft.', { proofreadLocal: async (text) => { localCalls += 1; return { supported: true, correctedText: text.replace('Teh', 'The'), findings: [] }; } });
  assert.deepEqual([result.source, result.local.correctedText, localCalls, fake.calls.length], ['local', 'The draft.', 1, 0]);
  const forcedLocal = createProofreadingRouter({ getMode: () => 'ai', isAiReady: () => true, sendToProvider: fake.send });
  assert.equal((await forcedLocal.correctWithFallback('Teh draft.', { proofreadLocal: async () => ({ supported: true, correctedText: '', findings: [] }), localOnly: true })).source, 'local');
  assert.equal(fake.calls.length, 0, 'localOnly (dictionary/dialect re-checks) never contacts the provider');
});
