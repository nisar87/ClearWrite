const api = window.clearWrite;
const $ = (id) => document.getElementById(id);
let latest = null;

function diffTokens(text) {
  return text.match(/[\p{L}\p{N}_]+(?:['’.-][\p{L}\p{N}_]+)*|\s+|[^\s\p{L}\p{N}_]+/gu) || [];
}

function renderDiff(original, corrected) {
  const left = diffTokens(original);
  const right = diffTokens(corrected);
  const a = $('original-diff');
  const b = $('corrected-diff');
  a.replaceChildren();
  b.replaceChildren();
  if (!original || !corrected || original === corrected) {
    $('changes-section').classList.add('hidden');
    return;
  }
  if (left.length * right.length > 1_000_000) {
    a.textContent = original;
    b.textContent = corrected;
    $('changes-section').classList.remove('hidden');
    return;
  }
  const cols = right.length + 1;
  const dp = new Uint32Array((left.length + 1) * cols);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      dp[i * cols + j] = left[i] === right[j]
        ? dp[(i + 1) * cols + j + 1] + 1
        : Math.max(dp[(i + 1) * cols + j], dp[i * cols + j + 1]);
    }
  }
  const ops = [];
  const add = (kind, token) => {
    const last = ops.at(-1);
    if (last?.kind === kind) last.text += token;
    else ops.push({ kind, text: token });
  };
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { add('same', left[i++]); j++; }
    else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) add('removed', left[i++]);
    else add('added', right[j++]);
  }
  while (i < left.length) add('removed', left[i++]);
  while (j < right.length) add('added', right[j++]);
  for (const op of ops) {
    if (op.kind === 'removed') {
      const mark = document.createElement('mark'); mark.className = 'diff-removed'; mark.textContent = op.text; a.append(mark);
    } else a.append(document.createTextNode(op.kind === 'same' ? op.text : ''));
    if (op.kind === 'added') {
      const mark = document.createElement('mark'); mark.className = 'diff-added'; mark.textContent = op.text; b.append(mark);
    } else b.append(document.createTextNode(op.kind === 'same' ? op.text : ''));
  }
  $('changes-section').classList.remove('hidden');
}

function render(state) {
  latest = state;
  const waiting = state.status === 'waiting';
  const working = state.status === 'working';
  $('selected-text').textContent = state.text || 'No text captured. Select text in another app and try again.';
  $('source-label').textContent = state.monitor ? (state.replaceSupported ? 'ACTIVE FIELD' : 'ACTIVE DOCUMENT') : 'YOUR SELECTION';
  $('selection-counter').textContent = state.text ? `${state.text.length.toLocaleString()} characters` : '';
  $('assistant-dot').classList.toggle('on', Boolean(state.connected));
  $('provider-label').textContent = state.monitor
    ? `Sent to ${state.provider === 'gemini' ? 'Google Gemini' : 'ChatGPT'} after a pause`
    : `Sent to ${state.provider === 'gemini' ? 'Google Gemini' : 'ChatGPT'} only after your choice`;
  $('actions').classList.toggle('hidden', state.monitor || state.status === 'working' || state.status === 'done');
  $('result-section').classList.toggle('hidden', state.status !== 'done');
  $('working-row').classList.toggle('hidden', !waiting && !working);
  $('working-row').querySelector('.spinner').classList.toggle('hidden', waiting);
  $('cancel-button').classList.toggle('hidden', waiting);
  $('inline-error').textContent = state.status === 'error' ? state.message || '' : '';
  $('result-state').textContent = state.status === 'done' ? (state.unchanged ? 'No change needed' : 'Review before using') : '';
  if (waiting) $('working-label').textContent = state.action || 'Waiting for you to pause…';
  if (working) $('working-label').textContent = `${state.action || 'Working'}…`;
  if (state.status === 'done' || working) $('result-text').value = state.result || '';
  if (state.status === 'done') renderDiff(state.text || '', state.result || '');
  else $('changes-section').classList.add('hidden');
  $('result-title').textContent = state.action || 'Suggestion';
  $('replace-button').textContent = state.monitor ? 'Apply correction' : 'Replace selected text';
  $('replace-button').classList.toggle('hidden', Boolean(state.replyOnly || (state.monitor && !state.replaceSupported)));
  $('replace-button').disabled = !state.connected || (state.status === 'done' && state.unchanged);
  $('copy-button').textContent = state.replyOnly ? 'Copy reply' : 'Copy';
  $('actions').querySelectorAll('button').forEach((button) => { button.disabled = !state.connected; });
  if (!state.connected && state.status === 'ready') $('inline-error').textContent = `Connect ${state.provider === 'gemini' ? 'Gemini API' : 'ChatGPT plan usage'} in ClearWrite settings to use AI actions.`;
}

document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
  $('inline-error').textContent = '';
  try { await api.transform(button.dataset.action); }
  catch (error) { $('inline-error').textContent = error.message; }
}));
$('result-text').addEventListener('input', () => {
  api.updateResult($('result-text').value);
  $('replace-button').disabled = !latest?.connected || $('result-text').value === (latest?.text || '');
});
$('close-button').addEventListener('click', () => api.dismiss());
$('back-button').addEventListener('click', () => { $('result-section').classList.add('hidden'); $('actions').classList.remove('hidden'); });
$('copy-button').addEventListener('click', async () => {
  const button = $('copy-button');
  try {
    await api.copy();
    if (latest?.monitor) {
      button.textContent = 'Copied';
      setTimeout(() => { if (button.isConnected) button.textContent = latest?.replyOnly ? 'Copy reply' : 'Copy'; }, 1300);
    }
  } catch (error) { $('inline-error').textContent = error.message; }
});
$('replace-button').addEventListener('click', async () => {
  $('replace-button').disabled = true;
  try { await api.replace(); } catch (error) { $('inline-error').textContent = `${error.message} You can still copy the suggestion.`; }
  finally { $('replace-button').disabled = false; }
});
$('cancel-button').addEventListener('click', () => api.cancel());
$('open-app').addEventListener('click', () => api.showApp());
api.onAssistant(render);
