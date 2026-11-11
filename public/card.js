// A suggestion card next to an underlined word: one click applies just that fix.
const api = window.clearWrite;
const $ = (id) => document.getElementById(id);
let current = null;

const KIND = { Spelling: 'Spelling', Learned: 'Your usual change', Grammar: 'Grammar', 'AI-check': 'Check the meaning', AI: 'Suggestion' };

function render(state) {
  current = state;
  $('card-error').textContent = '';
  if (!state) return;
  const finding = state.finding;
  $('card-kind').textContent = KIND[finding.kind] || (finding.kind ? finding.kind.replace(/([a-z])([A-Z])/g, '$1 $2') : 'Suggestion');
  $('card-kind').className = `card-kind ${finding.kind === 'Spelling' ? 'spelling' : finding.kind === 'Learned' ? 'learned' : 'grammar'}`;
  $('card-message').textContent = finding.message || '';
  $('card-original').textContent = finding.original;
  $('card-options').replaceChildren(...(finding.edits || []).map((edit, option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card-option';
    const label = finding.suggestions?.[option] ?? edit.text;
    button.textContent = label && label.trim() ? label : '(remove)';
    button.title = `Replace with “${button.textContent}”`;
    button.addEventListener('click', () => act(() => api.cardApply(state.index, option), button));
    return button;
  }));
  $('card-add').hidden = finding.kind !== 'Spelling';
  requestAnimationFrame(() => { void api.cardResize(Math.ceil(document.getElementById('card').getBoundingClientRect().height) + 2); });
}

async function act(action, button) {
  if (button) button.disabled = true;
  try { await action(); }
  catch (error) { $('card-error').textContent = error.message || String(error); void api.cardResize(Math.ceil(document.getElementById('card').getBoundingClientRect().height) + 2); }
  finally { if (button) button.disabled = false; }
}

$('card-close').addEventListener('click', () => { void api.cardClose(); });
$('card-ignore').addEventListener('click', (event) => act(() => api.cardIgnore(current.index), event.currentTarget));
$('card-add').addEventListener('click', (event) => act(() => api.cardAddWord(current.finding.original), event.currentTarget));
$('card-all').addEventListener('click', () => { void api.cardOpenPanel(current?.index); });
document.addEventListener('mouseenter', () => { void api.cardHover(true); });
document.addEventListener('mouseleave', () => { void api.cardHover(false); });
api.onCard(render);
