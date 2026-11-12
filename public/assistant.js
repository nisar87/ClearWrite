const api = window.clearWrite;
const $ = (id) => document.getElementById(id);
let latest = null;
let editing = false;
let editKey = '';
let flashTimer;
let actionsOpen = false;
let actionsKey = '';

const ACTION_LABELS = { correct: 'Correction', clearer: 'Rephrased', professional: 'Professional tone', friendly: 'Friendly tone', continue: 'Continuation', reply: 'Suggested reply' };

function formatShortcut(value) {
  return String(value || 'Ctrl+Shift+Space').replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl').replace(/\+/g, ' + ');
}

function diffTokens(text) {
  return text.match(/[\p{L}\p{N}_]+(?:['’.-][\p{L}\p{N}_]+)*|\s+|[^\s\p{L}\p{N}_]+/gu) || [];
}

// Word-level LCS diff. Removed words are marked in the original, added words in the suggestion.
function renderDiff(original, corrected, left, right) {
  left.replaceChildren();
  right.replaceChildren();
  const a = diffTokens(original);
  const b = diffTokens(corrected);
  if (a.length * b.length > 1_000_000) {
    left.textContent = original;
    right.textContent = corrected;
    return 0;
  }
  const cols = b.length + 1;
  const dp = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * cols + j] = a[i] === b[j] ? dp[(i + 1) * cols + j + 1] + 1 : Math.max(dp[(i + 1) * cols + j], dp[i * cols + j + 1]);
    }
  }
  const ops = [];
  const add = (kind, token) => {
    const last = ops.at(-1);
    if (last?.kind === kind) last.text += token;
    else ops.push({ kind, text: token });
  };
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { add('same', a[i++]); j++; }
    else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) add('removed', a[i++]);
    else add('added', b[j++]);
  }
  while (i < a.length) add('removed', a[i++]);
  while (j < b.length) add('added', b[j++]);
  // A word replaced by another is one change, not a removal plus an addition.
  let changes = 0;
  let replacing = false;
  for (const op of ops) {
    if (op.kind === 'same') { left.append(op.text); right.append(op.text); replacing = false; continue; }
    if (!op.text.trim()) { (op.kind === 'removed' ? left : right).append(op.text); continue; }
    if (!(op.kind === 'added' && replacing)) changes += 1;
    replacing = op.kind === 'removed';
    const mark = document.createElement(op.kind === 'removed' ? 'del' : 'ins');
    mark.className = op.kind === 'removed' ? 'diff-removed' : 'diff-added';
    mark.textContent = op.text;
    (op.kind === 'removed' ? left : right).append(mark);
  }
  return changes;
}

function show(id, visible) { $(id).classList.toggle('hidden', !visible); }

function statusIcon(status) {
  if (status === 'working' || status === 'pending') return status;
  if (status === 'suggestion') return 'suggestion';
  if (status === 'clean' || status === 'applied' || status === 'done') return 'ok';
  if (status === 'error') return 'error';
  if (status === 'paused') return 'paused';
  return 'quiet';
}

function inDictionary(state, word) {
  const target = String(word || '').trim().toLocaleLowerCase();
  return (state.dictionaryWords || []).some((entry) => entry.toLocaleLowerCase() === target);
}

function suggestionFor(state) {
  if (state.mode === 'manual') {
    if (state.status !== 'done') return null;
    const local = state.source === 'local';
    return { text: state.result || '', source: state.source || 'ai', supported: state.supported, sourceLabel: local ? 'On-device check' : ACTION_LABELS[state.action] || 'Suggestion', findings: state.findings || [], needsChoice: state.needsChoice || 0, note: state.note || '' };
  }
  return state.suggestion || null;
}

function render(state) {
  if (!state) return;
  const previous = latest;
  latest = state;
  const manual = state.mode === 'manual';
  const suggestion = suggestionFor(state);
  const key = `${state.mode}|${state.text}|${suggestion?.text ?? ''}`;
  if (key !== editKey) { editing = false; editKey = key; }
  // The action menu closes when the source changes (manual selection vs. live field) or a new
  // result arrives, so it always refers to the text currently on screen.
  const nextActionsKey = `${state.mode}|${state.text}|${state.revision ?? ''}|${state.status}`;
  if (nextActionsKey !== actionsKey) { actionsOpen = false; actionsKey = nextActionsKey; }
  if (!previous || previous.text !== state.text || previous.status !== state.status) $('inline-error').textContent = '';

  $('panel').dataset.status = state.status;
  $('panel').dataset.mode = state.mode;
  $('panel-context').textContent = manual ? 'Selected text' : state.appLabel ? `Live writing · ${state.appLabel}` : 'Live writing';
  $('status-icon').className = `status-icon status-${statusIcon(state.status)}`;
  if (!flashTimer) $('status-line').textContent = state.flash || state.statusLine || '';
  if (state.flash) flash(state.flash);
  $('pin-button').setAttribute('aria-pressed', String(state.pinned !== false));
  show('pin-notice', state.pinned === false && !manual);
  $('pin-button').title = state.pinned !== false ? 'Keeping on top of other windows (click to allow it behind)' : 'Not on top (click to keep on top of other windows)';

  const hasText = Boolean(state.text);
  show('empty-state', !manual && !hasText);
  if (!manual && !hasText) {
    $('empty-title').textContent = state.status === 'paused' ? state.statusLine : state.statusLine || 'Start typing in any text field.';
    $('empty-detail').textContent = state.status === 'paused'
      ? state.detail || ''
      : `Suggestions appear here after you pause typing. To check other text, select it and press ${formatShortcut(state.shortcut)}.`;
  }
  show('resume-button', !manual && state.status === 'paused');

  show('source-block', hasText);
  $('source-label').textContent = manual ? 'Your selection' : state.replaceSupported === false ? 'Your text (document)' : 'Your text';
  $('source-meta').textContent = hasText ? `${state.text.length.toLocaleString()} characters` : '';

  const editedText = state.editedText ?? suggestion?.text ?? '';
  const changed = Boolean(suggestion && editedText !== state.text);
  show('suggestion-block', Boolean(suggestion));
  if (suggestion) {
    $('suggestion-label').textContent = suggestion.sourceLabel || 'Suggestion';
    if (changed && !editing) {
      const count = renderDiff(state.text || '', editedText, $('source-text'), $('suggestion-text'));
      $('source-meta').textContent = `${count} change${count === 1 ? '' : 's'}`;
    } else {
      $('source-text').textContent = state.text || '';
      if (!editing) $('suggestion-text').textContent = changed ? editedText
        : suggestion.source === 'local' && suggestion.supported === false ? 'This text was not checked. See the reason below.'
        : suggestion.needsChoice > 0 ? 'Possible mistakes found. Review the alternatives below.'
        : 'No corrections found by this check.';
    }
    $('suggestion-text').classList.toggle('no-change', !changed);
    if (!editing) $('suggestion-edit').value = editedText;
    show('suggestion-text', !editing);
    show('suggestion-edit', editing);
    show('edit-button', changed || editing);
    $('edit-button').textContent = editing ? 'Done' : 'Edit';
    $('edit-button').setAttribute('aria-pressed', String(editing));
    const notes = [];
    if (suggestion.note) notes.push(suggestion.note);
    if (suggestion.needsChoice) notes.push(`${suggestion.needsChoice} possible issue${suggestion.needsChoice === 1 ? '' : 's'} need${suggestion.needsChoice === 1 ? 's' : ''} your judgement and ${suggestion.needsChoice === 1 ? 'was' : 'were'} not changed. Pick an option below or ignore it.`);
    if (changed && !manual && state.replaceSupported === false) {
      notes.push(state.canApply ? 'Apply changes only the highlighted words in your document; the rest is left as it is.' : 'This app exposes a whole document, so use Copy and paste the part you need.');
    }
    if (changed && !manual && state.canApply && suggestion.action && suggestion.action !== 'correct') notes.push('Apply replaces all of the text in this field.');
    if (changed && !manual && suggestion.source === 'ai') notes.push('AI suggestions can be wrong. Review the highlighted changes before applying.');
    if (suggestion.source === 'local') notes.push('On-device English check: it catches common spelling and grammar mistakes, not all of them.');
    $('suggestion-note').textContent = notes.join(' ');
    show('suggestion-note', notes.length > 0);
    // Each finding can be accepted (pick an option), ignored, or reset on its own. Findings
    // without exact edits (older or AI results) are listed for information only.
    const findings = (suggestion.findings || []).map((finding, index) => ({ finding, index })).filter(({ finding }) => finding.original);
    const visible = findings.slice(0, 12);
    $('findings').replaceChildren(...visible.map(({ finding, index }) => {
      const item = document.createElement('li');
      item.dataset.index = String(index);
      const choosable = Array.isArray(finding.edits);
      const chosen = choosable && !finding.ignored && finding.choice >= 0;
      item.classList.toggle('resolved', chosen);
      item.classList.toggle('ignored', Boolean(finding.ignored));
      const word = document.createElement('b');
      word.textContent = finding.original;
      item.append(word);
      if (!choosable) item.append(` ${finding.suggestions?.length ? `→ ${finding.suggestions.join(' / ')}` : ''}`);
      if (finding.message) { const small = document.createElement('small'); small.textContent = finding.message; item.append(small); }
      const controls = document.createElement('span');
      controls.className = 'finding-controls';
      if (choosable && !finding.ignored) {
        finding.edits.forEach((edit, option) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'finding-option';
          const label = edit.text || finding.suggestions?.[option] || '';
          button.textContent = label.trim() ? label : '(remove)';
          const selectedOption = finding.choice === option;
          button.setAttribute('aria-pressed', String(selectedOption));
          button.title = selectedOption ? 'Chosen. Click to keep your original text here.' : `Use “${button.textContent}”`;
          button.addEventListener('click', () => run(() => api.chooseFinding(index, selectedOption ? -1 : option), button));
          controls.append(button);
        });
      }
      if (choosable) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'link-button';
        toggle.textContent = finding.ignored ? 'Show again' : 'Ignore';
        toggle.title = finding.ignored ? 'Review this finding again' : 'Keep your original text and hide this finding';
        toggle.addEventListener('click', () => run(() => api.chooseFinding(index, finding.ignored ? -1 : 'ignore'), toggle));
        controls.append(toggle);
      }
      // Only spelling flags can be fixed by teaching the checker a word, and only on request.
      if (finding.kind === 'Spelling' && !inDictionary(state, finding.original)) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'link-button add-word';
        add.textContent = 'Add to dictionary';
        add.title = `Stop flagging “${finding.original}” (stored only on this device)`;
        add.addEventListener('click', () => run(() => api.addWordFromPanel(finding.original), add));
        controls.append(add);
      }
      if (controls.childElementCount) item.append(controls);
      return item;
    }));
    // Opened from an underline in the editor: bring that finding into view and mark it.
    if (Number.isSafeInteger(state.focusFinding)) {
      const target = $('findings').querySelector(`li[data-index="${state.focusFinding}"]`);
      if (target) { target.classList.add('focused'); target.scrollIntoView({ block: 'nearest' }); target.querySelector('button')?.focus(); }
    }
    if (findings.length > visible.length) {
      const more = document.createElement('li');
      more.className = 'findings-more';
      more.textContent = `${findings.length - visible.length} more not shown. Use Edit to review the rest.`;
      $('findings').append(more);
    }
    show('findings', findings.length > 0);
    const hints = Array.isArray(state.hints) ? state.hints : [];
    $('hints').replaceChildren(...hints.map((hint) => {
      const item = document.createElement('li');
      const label = document.createElement('b');
      label.textContent = 'Clarity';
      item.append(label, ` ${hint.message}`);
      return item;
    }));
    show('hints', hints.length > 0);
  } else {
    $('source-text').textContent = state.text || '';
  }

  const available = Array.isArray(state.actions) ? state.actions : [];
  const working = state.status === 'working';
  const menuAlwaysOpen = manual && state.status === 'ready';
  const menuVisible = available.length > 0 && !working && (menuAlwaysOpen || actionsOpen);
  show('actions', menuVisible);
  $('actions').querySelectorAll('[data-action]').forEach((button) => {
    const offered = available.includes(button.dataset.action);
    button.classList.toggle('hidden', !offered);
    // Correct always works (on-device in Offline only). Rewrite, tone, continue and reply need AI.
    const needsAi = button.dataset.action !== 'correct';
    const blocked = needsAi && !state.aiAvailable;
    button.disabled = blocked;
    button.classList.toggle('needs-ai', needsAi && !state.aiAvailable);
    button.title = blocked ? (state.proofreadingMode === 'ai' ? `Set up ${state.providerName} in Settings to use this action` : 'Needs AI-assisted mode (choose it on the ClearWrite Home page)') : '';
  });
  $('actions').querySelectorAll('.action-group').forEach((group) => { group.classList.toggle('hidden', !group.querySelector('[data-action]:not(.hidden)')); });
  show('more-button', available.length > 0 && !working && !menuAlwaysOpen);
  $('more-button').setAttribute('aria-expanded', String(menuVisible));
  $('more-button').textContent = menuVisible ? 'Hide actions' : 'More actions';
  show('ai-hint', menuVisible && !state.aiAvailable);
  $('ai-hint').textContent = state.proofreadingMode === 'ai'
    ? `Rewrite, tone and reply actions need ${state.providerName}; set it up in Settings. Correct works on this device.`
    : 'Offline only: Correct runs on this device. Rewrite, tone and reply actions need AI-assisted mode.';
  if (state.status === 'error' && state.detail) $('inline-error').textContent = state.detail;

  show('cancel-button', working);
  show('retry-button', !manual && Boolean(state.canRetry || state.status === 'clean' || state.status === 'suggestion') && !working);
  show('undo-button', !manual && Boolean(state.canUndo));
  show('copy-button', Boolean(state.canCopy));
  show('apply-button', Boolean(state.canApply));
  $('copy-button').textContent = state.replyOnly ? 'Copy reply' : 'Copy';
  $('apply-button').textContent = manual ? 'Replace selection' : state.applyMode === 'spans' ? 'Apply fixes' : 'Apply';
  $('apply-button').disabled = editing && $('suggestion-edit').value === state.text;

  $('privacy-line').textContent = state.proofreadingMode !== 'ai'
    ? 'Offline only: checked on this device; nothing is sent'
    : manual
    ? `Sent to ${state.providerName} only when you choose an AI action`
    : state.status === 'paused'
      ? 'Nothing is being read while paused'
      : suggestion?.source === 'local' || !state.connected
        ? 'Checked on this device; nothing was sent'
        : `Checked with ${state.providerName} after you pause`;
}

function flash(message) {
  clearTimeout(flashTimer);
  $('status-line').textContent = message;
  flashTimer = setTimeout(() => { flashTimer = undefined; $('status-line').textContent = latest?.statusLine || ''; }, 1600);
}

async function run(action, button) {
  $('inline-error').textContent = '';
  if (button) button.disabled = true;
  try { await action(); }
  catch (error) { $('inline-error').textContent = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
  finally { if (button) button.disabled = false; }
}

document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
  actionsOpen = false;
  // The revision ties a live-field action to the exact text on screen.
  void run(() => api.transform(button.dataset.action, latest?.revision));
}));
$('close-button').addEventListener('click', () => run(() => api.dismiss()));
$('pin-button').addEventListener('click', () => run(() => api.setPinned(!(latest?.pinned !== false))));
$('pin-notice-button').addEventListener('click', () => run(() => api.setPinned(true)));
$('resume-button').addEventListener('click', () => run(() => api.setMonitor(true), $('resume-button')));
$('cancel-button').addEventListener('click', () => run(() => api.cancel(), $('cancel-button')));
$('retry-button').addEventListener('click', () => run(() => api.retry(), $('retry-button')));
$('undo-button').addEventListener('click', () => run(() => api.undo(), $('undo-button')));
$('copy-button').addEventListener('click', () => run(async () => { await api.copy(); flash('Copied to clipboard'); }, $('copy-button')));
$('apply-button').addEventListener('click', () => run(() => api.replace(), $('apply-button')));
$('more-button').addEventListener('click', () => {
  actionsOpen = !actionsOpen;
  render(latest);
  if (actionsOpen) $('actions').querySelector('[data-action]:not(.hidden):not(:disabled)')?.focus();
});
$('open-app').addEventListener('click', () => run(() => api.showApp()));
$('edit-button').addEventListener('click', () => {
  editing = !editing;
  if (editing) { $('suggestion-edit').value = latest?.editedText ?? suggestionFor(latest)?.text ?? ''; }
  render(latest);
  if (editing) $('suggestion-edit').focus();
});
$('suggestion-edit').addEventListener('input', () => {
  void api.updateResult($('suggestion-edit').value).catch(() => {});
  if (latest) latest = { ...latest, editedText: $('suggestion-edit').value };
  $('apply-button').disabled = $('suggestion-edit').value === latest?.text;
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (editing) { editing = false; render(latest); return; }
  if (actionsOpen) { actionsOpen = false; render(latest); $('more-button').focus(); return; }
  void run(() => api.dismiss());
});

api.onAssistant(render);
void api.assistantReady().then((state) => { if (state && !latest) render(state); }).catch(() => {});
