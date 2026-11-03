import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadableStream } from 'node:stream/web';
import { listGeminiModels, streamGemini } from './gemini.js';

test('model discovery keeps only models that support content generation', async () => {
  const models = await listGeminiModels('test-key', async (_url, options) => {
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    return Response.json({ models: [
      { name: 'models/gemini-flash', displayName: 'Gemini Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-2.5-flash-preview-tts', displayName: 'Gemini Flash TTS', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/antigravity-agent-preview', displayName: 'Antigravity Agent Preview', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embedding', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
      { name: 'not-a-model-path', supportedGenerationMethods: ['generateContent'] },
    ] });
  });
  assert.deepEqual(models, [{ slug: 'gemini-flash', displayName: 'Gemini Flash' }]);
});

test('model discovery maps authorization errors without leaking response bodies', async () => {
  await assert.rejects(
    listGeminiModels('secret', async () => new Response('sensitive provider detail', { status: 403 })),
    /Google rejected this Gemini API key/,
  );
});

test('streaming sends the selected text and instructions, then emits text deltas', async () => {
  let sent;
  const chunks = [
    'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"there"}]}}]}\n\n',
  ];
  const response = new Response(new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(new TextEncoder().encode(chunk));
      else controller.close();
    },
  }));
  const deltas = [];
  const result = await streamGemini({
    apiKey: 'test-key', model: 'gemini-flash', input: 'draft', instructions: 'correct it',
    onDelta: (delta) => deltas.push(delta),
    fetchImpl: async (_url, options) => {
      sent = JSON.parse(options.body);
      assert.equal(options.headers['x-goog-api-key'], 'test-key');
      return response;
    },
  });
  assert.equal(sent.contents[0].parts[0].text, 'draft');
  assert.equal(sent.systemInstruction.parts[0].text, 'correct it');
  assert.deepEqual(deltas, ['Hello ', 'there']);
  assert.equal(result.text, 'Hello there');
});
