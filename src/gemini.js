const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

function responseError(status) {
  if (status === 401 || status === 403) return new Error('Google rejected this Gemini API key, or Gemini API access is not enabled for its project.');
  if (status === 404) return new Error('Google could not find that Gemini model. Refresh the model list and choose another.');
  if (status === 429) return new Error('Gemini rate limit reached. Wait a moment and try again.');
  if (status >= 500) return new Error('Gemini is temporarily unavailable. Try again shortly.');
  return new Error(`Gemini request failed (${status}). Check the key, model, and request settings.`);
}

async function request(url, apiKey, options = {}, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      headers: { 'x-goog-api-key': apiKey, ...options.headers },
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error('Could not reach Gemini. Check your internet connection and try again.');
  }
  if (!response.ok) throw responseError(response.status);
  return response;
}

export async function listGeminiModels(apiKey, fetchImpl = fetch) {
  const response = await request(`${API_ROOT}/models?pageSize=100`, apiKey, {}, fetchImpl);
  let body;
  try { body = await response.json(); }
  catch { throw new Error('Google returned an unreadable Gemini model list.'); }
  return (Array.isArray(body.models) ? body.models : [])
    .filter((model) => {
      if (typeof model.name !== 'string' || !/^models\/[\w.-]+$/.test(model.name) ||
          !model.supportedGenerationMethods?.includes('generateContent')) return false;
      const slug = model.name.slice('models/'.length);
      return /^(gemini|gemma)-/i.test(slug) &&
        !/(?:^|[-.])(tts|transcribe|computer-use|robotics|deep-research|research|omni|nano|lyria)(?:[-.]|$)/i.test(slug);
    })
    .map((model) => ({
      slug: model.name.slice('models/'.length),
      displayName: model.displayName || model.name.slice('models/'.length),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function appendText(payload, onDelta) {
  const text = (payload.candidates?.[0]?.content?.parts || [])
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .join('');
  if (text) onDelta(text);
  return text;
}

export async function streamGemini({ apiKey, model, input, instructions, signal, onDelta, fetchImpl = fetch }) {
  if (!/^[\w.-]+$/.test(model)) throw new Error('Choose a valid Gemini model.');
  const response = await request(`${API_ROOT}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, apiKey, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{ role: 'user', parts: [{ text: input }] }],
      generationConfig: { temperature: 0.2 },
    }),
  }, fetchImpl);
  if (!response.body) throw new Error('Gemini did not return a response stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = '';
  const consume = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let payload;
    try { payload = JSON.parse(data); }
    catch { throw new Error('Gemini returned an invalid response stream.'); }
    result += appendText(payload, onDelta);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) consume(line);
      if (done) break;
    }
    if (buffer) consume(buffer);
  } finally {
    reader.releaseLock();
  }
  return { text: result };
}
