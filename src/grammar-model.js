// On-device grammar model (layer 1 of the roadmap): a small sentence-level correction model
// (assets/models/grammar-model.json) whose edits pass model-filter.js before they are offered.
// Runs inside the proofreading worker. Optional: when the model files or the runtime are not
// installed, it reports nothing and Harper's result stands. Nothing is downloaded at runtime.
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeModelEdits } from './model-filter.js';

// Chosen on the development split of the benchmark (see benchmark/README.md): the strictest
// setting with no wrong changes and no changes to clean text.
export const CONTEXT_THRESHOLD = 1.5;
const MAX_SENTENCE_LENGTH = 400;
const CACHE_LIMIT = 500;

let state;
let loading;
let loadError = '';

async function load() {
  if (state !== undefined) return state;
  loading ??= (async () => {
    try {
      const models = fileURLToPath(new URL('../assets/models/', import.meta.url));
      const manifest = JSON.parse(await readFile(path.join(models, 'grammar-model.json'), 'utf8'));
      for (const file of Object.keys(manifest.files)) await access(path.join(models, manifest.name, file));
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = models;
      const corrector = await pipeline('text2text-generation', manifest.name, { dtype: 'q8' });
      state = { corrector, cache: new Map(), name: manifest.name };
    } catch (error) {
      loadError = String(error?.message || error).slice(0, 300);
      state = null;
    }
    return state;
  })();
  return loading;
}

export async function grammarModelStatus() {
  const model = await load();
  return model ? { available: true, name: model.name } : { available: false, error: loadError };
}

async function correctSentence(model, sentence) {
  if (model.cache.has(sentence)) {
    const value = model.cache.get(sentence);
    model.cache.delete(sentence);
    model.cache.set(sentence, value);
    return value;
  }
  const [result] = await model.corrector(sentence, { max_new_tokens: Math.min(256, sentence.length + 32), do_sample: false, num_beams: 1 });
  const corrected = String(result?.generated_text ?? '').trim();
  model.cache.set(sentence, corrected);
  while (model.cache.size > CACHE_LIMIT) model.cache.delete(model.cache.keys().next().value);
  return corrected;
}

// Sentences as [startCodePoint, text] (trimmed), skipping ones that are too long or not prose.
export function sentences(text) {
  const result = [];
  const pattern = /[^.!?\n]+(?:[.!?]+["'”’)\]]*)?/gu;
  let match;
  while ((match = pattern.exec(text))) {
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    const sentence = raw.trim();
    if (!sentence || sentence.length > MAX_SENTENCE_LENGTH || !/\p{L}{2,}/u.test(sentence)) continue;
    if ((sentence.match(/\p{L}+/gu) || []).length < 3) continue;
    result.push([[...text.slice(0, match.index + lead)].length, sentence]);
  }
  return result;
}

// Findings (same shape as Harper's) for model edits that pass the filter and do not touch a
// Harper finding or a protected span (URLs, code, identifiers).
export async function modelFindings(text, { speller, protectedRanges = [], covered = [] } = {}) {
  const model = await load();
  if (!model) return [];
  const blocked = [...protectedRanges, ...covered.map((finding) => ({ start: finding.start, end: finding.end }))];
  const overlaps = (start, end) => blocked.some((range) => start < range.end && end > range.start);
  const findings = [];
  for (const [offset, sentence] of sentences(text)) {
    const sentenceEnd = offset + [...sentence].length;
    if (blocked.some((range) => range.start < sentenceEnd && range.end > offset && protectedRanges.includes(range))) continue;
    const corrected = await correctSentence(model, sentence);
    if (!corrected || corrected === sentence) continue;
    for (const edit of safeModelEdits(sentence, corrected, speller, CONTEXT_THRESHOLD)) {
      const start = offset + edit.start;
      const end = offset + edit.end;
      if (overlaps(start, end)) continue;
      findings.push({
        message: edit.reason === 'capitalisation' ? 'Capitalise the first word of a sentence.' : 'The on-device grammar model suggests this word fits the sentence better.',
        original: edit.before,
        suggestions: [edit.after],
        edits: [{ start, end, text: edit.after }],
        choice: 0,
        appliedLocally: true,
        kind: 'Grammar',
        source: 'model',
        start,
        end,
      });
    }
  }
  return findings;
}
