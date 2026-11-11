const api = window.clearWrite;
const $ = (id) => document.getElementById(id);
let current = null;

function requireApi(method) {
  if (!api || typeof api[method] !== 'function') {
    throw new Error('ClearWrite’s desktop connection did not load. Restart the app; if this persists, check startup.log in your ClearWrite data folder.');
  }
  return api[method].bind(api);
}

function showNotice(message, settings = false) {
  const target = $(settings ? 'settings-notice' : 'notice');
  if (target) target.textContent = message || '';
}

function formatShortcut(value) {
  return value.replaceAll('CommandOrControl', 'Ctrl').replaceAll('Control', 'Ctrl').replaceAll('Shift', 'Shift').replaceAll('+', ' + ');
}

function render(state) {
  current = state;
  renderUpdates(state);
  const isGemini = state.provider === 'gemini';
  const chatgptConnected = state.session.status === 'connected' && state.session.sharing;
  const connected = isGemini ? state.geminiConfigured && state.models.length > 0 : chatgptConnected;
  const configured = isGemini ? state.geminiConfigured : chatgptConnected;
  const reconnectNeeded = state.session.status === 'connected' && !state.session.sharing;
  $('status-dot').classList.toggle('on', connected);
  $('status-label').textContent = connected ? `${isGemini ? 'Gemini' : 'ChatGPT'} ready` : isGemini && state.geminiConfigured ? 'Gemini needs attention' : state.session.status === 'connecting' ? 'Connecting…' : reconnectNeeded ? 'Plan usage disabled' : 'Not connected';
  $('rail-status-dot').classList.toggle('on', connected);
  $('rail-status-label').textContent = connected ? (isGemini ? 'Gemini connected' : state.session.profileLabel || 'ChatGPT connected') : isGemini && state.geminiConfigured ? 'Gemini needs attention' : reconnectNeeded ? 'Reconnect ChatGPT' : `${isGemini ? 'Gemini' : 'ChatGPT'} not connected`;
  $('rail-status-detail').textContent = connected ? 'Ready for writing actions' : isGemini && state.geminiConfigured ? 'Check the Gemini key or model list' : reconnectNeeded ? 'Plan usage needs permission' : 'Connect to enable AI actions';
  $('connect-section').classList.toggle('hidden', isGemini || connected);
  $('gemini-connect-section').classList.toggle('hidden', !isGemini || state.geminiConfigured);
  $('connected-section').classList.toggle('hidden', !configured);
  $('connect-button').disabled = false;
  $('connect-button').innerHTML = state.session.status === 'connecting' ? 'Cancel sign-in' : 'Continue with ChatGPT <span aria-hidden="true">→</span>';
  $('account-label').textContent = isGemini ? 'Google Gemini' : state.session.profileLabel || 'ChatGPT';
  $('account-email').textContent = isGemini ? (connected ? 'Gemini API key is saved securely on this device.' : state.geminiError || 'Key saved; model list unavailable.') : state.session.identity?.email || 'ChatGPT plan usage is enabled.';
  document.querySelector('.provider-avatar').textContent = isGemini ? 'G' : 'O';
  document.querySelector('.connected-badge').innerHTML = `<i></i>${connected ? 'Ready' : 'Configured'}`;
  $('usage-button').classList.toggle('hidden', isGemini);
  $('settings-connection').textContent = chatgptConnected ? `${state.session.profileLabel || 'ChatGPT'} · plan usage enabled` : state.session.status === 'connecting' ? 'Waiting for OpenAI sign-in…' : reconnectNeeded ? 'Signed in, but ChatGPT plan usage is not enabled.' : 'Not connected';
  $('disconnect-button').classList.toggle('hidden', !chatgptConnected);
  $('reconnect-button').classList.toggle('hidden', state.session.status !== 'connected' || state.session.sharing);
  $('provider-select').value = state.provider;
  $('gemini-status').textContent = state.geminiConfigured ? state.geminiError || 'Gemini API key verified and saved on this device.' : 'No Gemini API key saved.';
  if (!state.geminiConfigured && state.geminiError) $('gemini-status').textContent = state.geminiError;
  $('gemini-remove-button').classList.toggle('hidden', !state.geminiConfigured);
  $('gemini-refresh-button').classList.toggle('hidden', !state.geminiConfigured);
  $('gemini-test-button').classList.toggle('hidden', !state.geminiConfigured);
  $('footer-provider').textContent = state.proofreadingMode === 'ai' ? (isGemini ? 'AI: Google Gemini' : 'AI: ChatGPT') : 'On-device checking';
  const chatgptAvailable = state.session?.status !== 'unavailable';
  $('chatgpt-card').classList.toggle('hidden', !chatgptAvailable);
  $('gemini-card').classList.toggle('hidden', !isGemini && chatgptAvailable);
  const chatgptOption = $('provider-select').querySelector('option[value="chatgpt"]');
  chatgptOption.disabled = !chatgptAvailable && !isGemini ? false : !chatgptAvailable;
  chatgptOption.textContent = chatgptAvailable ? 'ChatGPT plan' : 'ChatGPT plan (not included in this build)';
  if (!chatgptAvailable) $('connect-section').classList.add('hidden');
  $('live-provider-label').textContent = connected
    ? `Live suggestions via ${isGemini ? 'Google Gemini' : 'ChatGPT'}`
    : `${isGemini ? 'Gemini' : 'ChatGPT'} is not connected`;
  $('live-model-label').textContent = state.selectedModel ? state.models.find((model) => model.slug === state.selectedModel)?.displayName || '' : '';
  $('shortcut-chip').textContent = formatShortcut(state.shortcut);
  $('shortcut-input').value = state.shortcut;
  const timedPause = Boolean(state.monitorEnabled && state.monitorPausedUntil > Date.now());
  const monitoring = Boolean(state.monitorEnabled && !timedPause);
  $('monitor-heading').textContent = monitoring ? 'On' : timedPause ? `Paused until ${new Date(state.monitorPausedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Paused';
  $('monitor-status').textContent = (state.monitorStatus || (monitoring ? 'Waiting for a text field' : 'Monitoring paused')) +
    (monitoring && state.panelPinned === false ? ' · The writing panel is not pinned on top, so the app you type in can cover it. Pin it from the panel or the tray.' : '');
  $('monitor-toggle-label').textContent = monitoring ? 'Checking on' : 'Checking off';
  $('monitor-toggle').classList.toggle('on', monitoring);
  $('monitor-toggle').setAttribute('aria-pressed', String(monitoring));
  $('monitor-indicator').classList.toggle('on', monitoring);
  $('pause-monitor-hour').disabled = !state.monitorEnabled;
  $('pause-monitor-tomorrow').disabled = !state.monitorEnabled;
  $('startup-toggle').checked = Boolean(state.startupEnabled);
  $('excluded-apps-input').value = (state.excludedApps || []).join(', ');
  $('allowed-apps-input').value = (state.allowedApps || []).join(', ');
  $('restrict-apps-toggle').checked = Boolean(state.restrictToAllowedApps);
  const focusedApp = state.lastFocusedApp || '';
  const builtInExclusions = ['clearwrite', 'cmd', 'powershell', 'pwsh', 'windowsterminal', 'wt', 'regedit'];
  const appExcluded = builtInExclusions.includes(focusedApp) || (state.excludedApps || []).includes(focusedApp);
  const appAllowed = Boolean(state.restrictToAllowedApps && (state.allowedApps || []).includes(focusedApp));
  $('monitor-current-app').textContent = focusedApp ? `Last app: ${focusedApp}` : monitoring ? 'Click into any text field' : 'Turn checking on to start';
  $('current-app-name').textContent = focusedApp || 'No app yet';
  $('allow-current-app').disabled = !focusedApp || appExcluded || appAllowed;
  $('allow-current-app').textContent = appExcluded ? 'Always excluded' : appAllowed ? 'Allowed' : 'Add to allowed apps';
  document.querySelectorAll('input[name="theme"]').forEach((input) => { input.checked = input.value === (state.theme || 'system'); });
  const theme = state.theme || 'system';
  $('theme-button').title = `Theme: ${theme[0].toUpperCase()}${theme.slice(1)} (click to change)`;
  $('theme-button').querySelector('use').setAttribute('href', theme === 'dark' ? '#i-moon' : theme === 'light' ? '#i-sun' : '#i-monitor');
  const select = $('model-select');
  select.replaceChildren();
  for (const model of state.models) {
    const option = document.createElement('option');
    option.value = model.slug;
    option.textContent = model.displayName;
    option.selected = model.slug === state.selectedModel;
    select.append(option);
  }
  if (!state.models.length) {
    const option = document.createElement('option');
    option.textContent = 'No models available';
    select.append(option);
  }
  select.disabled = !state.models.length;
  renderProofreading(state, { isGemini, connected });
  showNotice(state.notice);
  showNotice(state.notice, true);
}

function openUpdates() {
  showPage('settings', 'appearance');
  $('updates-section').scrollIntoView({ block: 'start' });
}

function renderUpdates(state) {
  const update = state.updates || { status: 'unavailable' };
  const status = update.status;
  const messages = {
    unavailable: 'Use the Windows Setup installer to enable in-app updates. ZIP and source copies are updated manually.',
    idle: 'Ready to check for updates.', checking: 'Checking GitHub for updates...',
    current: 'You are up to date.', available: `Version ${update.availableVersion} is available.`,
    downloading: `Downloading update: ${Math.floor(update.percent || 0)}%`,
    downloaded: `Version ${update.availableVersion} is downloaded and verified. Install when you are ready.`,
    installing: 'Installing update. ClearWrite will restart.', error: update.error || 'The update could not be completed. Try again.',
  };
  $('update-version').textContent = `Installed version: ${update.currentVersion || ''}`;
  document.querySelector('.footer-version').textContent = update.currentVersion || '';
  $('update-status').textContent = messages[status] || messages.idle;
  $('update-check').disabled = !update.supported || ['checking', 'downloading', 'downloaded', 'installing'].includes(status);
  $('update-download').classList.toggle('hidden', !update.availableVersion || !['available', 'error'].includes(status));
  $('update-cancel').classList.toggle('hidden', status !== 'downloading');
  $('update-install').classList.toggle('hidden', status !== 'downloaded');
  $('update-progress').classList.toggle('hidden', status !== 'downloading');
  $('update-progress').value = update.percent || 0;
  $('automatic-updates').checked = state.automaticUpdates !== false;
  $('automatic-updates').disabled = !update.supported;
  const visible = ['available', 'downloading', 'downloaded'].includes(status);
  $('update-banner').classList.toggle('hidden', !visible);
  $('update-banner-text').textContent = visible ? messages[status] : '';
}

$('update-banner-open').addEventListener('click', openUpdates);
$('update-releases').addEventListener('click', () => { void requireApi('openReleases')(); });
for (const [id, method] of [['update-check', 'checkUpdates'], ['update-download', 'downloadUpdate'], ['update-cancel', 'cancelUpdate'], ['update-install', 'installUpdate']]) {
  $(id).addEventListener('click', async () => {
    try { await requireApi(method)(); }
    catch { $('update-status').textContent = 'The update could not be completed. Please try again.'; }
  });
}
$('automatic-updates').addEventListener('change', async () => {
  try { await requireApi('setAutomaticUpdates')($('automatic-updates').checked); }
  catch { if (current) renderUpdates(current); }
});
api?.onOpenUpdates(openUpdates);

function renderProofreading(state, { isGemini, connected }) {
  const offline = state.proofreadingMode !== 'ai';
  const providerLabel = isGemini ? 'Google Gemini' : 'ChatGPT';
  $('mode-offline').checked = offline;
  $('mode-ai').checked = !offline;
  $('mode-ai-detail').textContent = `After you pause, text is sent to ${providerLabel} for context-aware fixes. Rephrase, tone and reply become available. If a request fails, the on-device result is shown.`;
  $('mode-note').textContent = state.modeNotice
    || (!offline && !connected ? `${providerLabel} is not set up yet, so text is checked on this device for now. Set it up in Settings › AI.` : '');
  $('scope-wrap').classList.toggle('hidden', offline);
  $('tile-mode').textContent = offline ? 'This PC' : providerLabel;
  $('tile-mode-detail').textContent = offline ? 'Nothing is sent anywhere' : connected ? 'AI-assisted, after a pause' : `${providerLabel} not set up yet`;
  if (offline) {
    $('status-dot').classList.add('on');
    $('status-label').textContent = 'On this PC only';
    $('rail-status-dot').classList.add('on');
    $('rail-status-label').textContent = 'On this PC only';
    $('rail-status-detail').textContent = 'Nothing is sent anywhere';
    $('live-provider-label').textContent = 'Checked on this device; no text is sent anywhere';
    $('live-model-label').textContent = '';
  } else {
    $('live-provider-label').textContent = connected ? `AI-assisted: eligible text is sent to ${providerLabel} after a pause` : `AI-assisted: ${providerLabel} is not set up, so text is checked on this device`;
  }
  if (state.session?.status === 'unavailable') {
    $('settings-connection').textContent = 'Not installed. ChatGPT sign-in needs the optional DevKit (see README); Offline only and Gemini work without it.';
    $('connect-button').disabled = true;
    $('connect-button').textContent = 'ChatGPT sign-in not installed';
  }
  const select = $('dialect-select');
  if (!select.options.length) {
    for (const [value, label] of Object.entries(state.englishDialects || {})) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
  }
  select.value = state.englishDialect || 'american';
  $('underlines-toggle').checked = state.showUnderlines !== false;
  document.querySelectorAll('input[name="suggestion-style"]').forEach((input) => { input.checked = input.value === (state.suggestionStyle || 'inline'); });
  document.querySelectorAll('input[name="ai-scope"]').forEach((input) => {
    input.checked = input.value === (state.aiReviewScope || 'unsure');
    input.disabled = state.proofreadingMode !== 'ai';
  });
  const list = $('dictionary-list');
  list.replaceChildren(...(state.dictionaryWords || []).map((word) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = word;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Remove “${word}” from your dictionary`;
    remove.setAttribute('aria-label', `Remove ${word} from your dictionary`);
    remove.addEventListener('click', async () => {
      try { await requireApi('removeDictionaryWord')(word); showNotice(`Removed “${word}” from your dictionary.`, true); }
      catch (error) { showNotice(error.message, true); }
    });
    item.append(label, remove);
    return item;
  }));
  renderLearning(state);
  $('tile-words').textContent = (state.dictionaryWords || []).length.toLocaleString();
  $('dictionary-location').textContent = `${(state.dictionaryWords || []).length.toLocaleString()} word${(state.dictionaryWords || []).length === 1 ? '' : 's'}. Stored only on this device${state.dictionaryLocation ? ` (${state.dictionaryLocation})` : ''}; never uploaded or written to logs.`;
}

function renderLearning(state) {
  const patterns = (state.learnedPatterns || []).filter((pattern) => pattern.trusted || pattern.suppressed || pattern.accepts + pattern.rejects > 0);
  const list = $('learning-list');
  list.replaceChildren(...patterns.slice(0, 200).map((pattern) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    const status = pattern.trusted ? 'suggested automatically' : pattern.suppressed ? 'ignored automatically' : 'learning';
    label.textContent = `${pattern.from} → ${pattern.to} (${status}; accepted ${pattern.accepts}, ignored ${pattern.rejects})`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Forget “${pattern.from} → ${pattern.to}”`;
    remove.setAttribute('aria-label', `Forget ${pattern.from} to ${pattern.to}`);
    remove.addEventListener('click', async () => {
      try { await requireApi('forgetLearned')(pattern.from, pattern.to); showNotice('Forgotten.', true); }
      catch (error) { showNotice(error.message, true); }
    });
    item.append(label, remove);
    return item;
  }));
  $('learning-clear').disabled = !patterns.length;
  $('tile-learned').textContent = patterns.filter((pattern) => pattern.trusted).length.toLocaleString();
  $('learning-location').textContent = `${patterns.length.toLocaleString()} learned change${patterns.length === 1 ? '' : 's'}. Stored only on this device; never uploaded or written to logs.`;
}

$('learning-clear').addEventListener('click', async () => {
  try { await requireApi('forgetAllLearned')(); showNotice('ClearWrite forgot everything it learned from you.', true); }
  catch (error) { showNotice(error.message, true); }
});

document.querySelectorAll('input[name="proofreading-mode"]').forEach((input) => input.addEventListener('change', async () => {
  if (!input.checked) return;
  try {
    await requireApi('setProofreadingMode')(input.value);
    showNotice(input.value === 'ai' ? 'AI-assisted mode is on. Eligible text is sent to your selected provider after a pause.' : 'Offline only: text is checked on this device and nothing is sent anywhere.');
  } catch (error) {
    showNotice(error.message);
    if (current) render(current);
  }
}));
$('underlines-toggle').addEventListener('change', async () => {
  try { await requireApi('setShowUnderlines')($('underlines-toggle').checked); showNotice($('underlines-toggle').checked ? 'Mistakes are underlined in supported editors.' : 'Underlines are off; suggestions stay in the panel.', true); }
  catch (error) { showNotice(error.message, true); }
});
document.querySelectorAll('input[name="suggestion-style"]').forEach((input) => input.addEventListener('change', async () => {
  if (!input.checked) return;
  try { await requireApi('setSuggestionStyle')(input.value); showNotice(input.value === 'inline' ? 'Suggestions appear in your text; click the widget for the full panel.' : 'The panel opens next to the field while you write.', true); }
  catch (error) { showNotice(error.message, true); }
}));
document.querySelectorAll('input[name="ai-scope"]').forEach((input) => input.addEventListener('change', async () => {
  if (!input.checked) return;
  try {
    await requireApi('setAiScope')(input.value);
    showNotice(input.value === 'unsure' ? 'Only text the device could not settle is sent to the AI.' : 'Every changed paragraph is sent to the AI for review.', true);
  } catch (error) { showNotice(error.message, true); }
}));
$('dialect-select').addEventListener('change', async () => {
  try { await requireApi('setDialect')($('dialect-select').value); showNotice('English dialect saved.', true); }
  catch (error) { showNotice(error.message, true); }
});
async function addDictionaryWordFromInput() {
  const input = $('dictionary-input');
  try {
    const result = await requireApi('addDictionaryWord')(input.value);
    showNotice(result.added ? `Added “${result.word}” to your dictionary.` : `“${result.word}” is already in your dictionary.`, true);
    input.value = '';
  } catch (error) { showNotice(String(error.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''), true); }
}
$('dictionary-add').addEventListener('click', addDictionaryWordFromInput);
$('dictionary-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') void addDictionaryWordFromInput(); });

const PAGES = {
  live: { title: 'Home', subtitle: 'Spelling and grammar help in every app you write in.' },
  settings: { title: 'Settings', subtitle: 'Suggestions, writing, privacy, AI and updates.' },
};
function showTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== name));
}
function showPage(page, tab) {
  document.querySelectorAll('[data-page]').forEach((item) => item.classList.toggle('active', item.dataset.page === page));
  for (const name of Object.keys(PAGES)) $(`${name}-page`).classList.toggle('hidden', name !== page);
  $('page-label').textContent = PAGES[page].title;
  $('page-subtitle').textContent = PAGES[page].subtitle;
  if (tab) showTab(tab);
}
document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.tab)));
document.querySelector('.tabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('.tab')];
  const index = tabs.findIndex((tab) => tab.classList.contains('active'));
  const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  showTab(next.dataset.tab);
  next.focus();
});
$('shortcut-chip').addEventListener('click', () => { showPage('settings', 'general'); $('shortcut-input').focus(); });
$('gemini-settings-button').addEventListener('click', () => $('gemini-key-input').focus());
async function setTheme(value) {
  try { await requireApi('setTheme')(value); }
  catch (error) { showNotice(error.message, true); }
}
$('theme-button').addEventListener('click', () => {
  const order = ['system', 'light', 'dark'];
  void setTheme(order[(order.indexOf(current?.theme || 'system') + 1) % order.length]);
});
document.querySelectorAll('input[name="theme"]').forEach((input) => input.addEventListener('change', () => { if (input.checked) void setTheme(input.value); }));
$('provider-select').addEventListener('change', async () => {
  try { await requireApi('updateProvider')($('provider-select').value); showNotice('AI provider updated.', true); }
  catch (error) { showNotice(error.message, true); }
});
$('gemini-save-button').addEventListener('click', async () => {
  const key = $('gemini-key-input').value;
  if (!key.trim()) { showNotice('Paste your Gemini API key first.', true); return; }
  $('gemini-save-button').disabled = true;
  $('gemini-save-button').textContent = 'Verifying…';
  try {
    await requireApi('saveGeminiKey')(key);
    $('gemini-key-input').value = '';
    showNotice('Gemini API key verified and saved.', true);
  } catch (error) { showNotice(error.message, true); }
  finally { $('gemini-save-button').disabled = false; $('gemini-save-button').textContent = 'Verify and save'; }
});
$('gemini-remove-button').addEventListener('click', async () => {
  if (!confirm('Remove the encrypted Gemini API key from this device?')) return;
  try { await requireApi('removeGeminiKey')(); showNotice('Gemini API key removed.', true); }
  catch (error) { showNotice(error.message, true); }
});
$('gemini-refresh-button').addEventListener('click', async () => {
  try { await requireApi('refreshModels')(); showNotice('Gemini model list refreshed.', true); }
  catch (error) { showNotice(error.message, true); }
});
$('gemini-test-button').addEventListener('click', async () => {
  $('gemini-test-button').disabled = true;
  $('gemini-test-button').textContent = 'Testing…';
  showNotice('Sending a short synthetic test prompt to Gemini…', true);
  try {
    const result = await requireApi('testGemini')();
    showNotice(`Gemini generated a test response using ${result.model}.`, true);
  } catch (error) { showNotice(error.message, true); }
  finally { $('gemini-test-button').disabled = false; $('gemini-test-button').textContent = 'Test Gemini'; }
});

$('connect-button').addEventListener('click', async () => {
  if (current?.session.status === 'connecting') {
    try {
      await requireApi('cancelConnect')();
      showNotice('Sign-in cancelled. You can start a fresh attempt.');
    } catch (error) { showNotice(error.message); }
    return;
  }
  showNotice('Opening OpenAI sign-in in your browser…');
  try { await requireApi('connect')(); }
  catch (error) {
    if (!/sign-in was cancelled|request was cancelled/i.test(error.message || '')) showNotice(error.message);
  }
});
$('usage-button').addEventListener('click', () => { try { requireApi('openUsage')(); } catch (error) { showNotice(error.message); } });
$('disconnect-button').addEventListener('click', async () => {
  if (!confirm('Disconnect ChatGPT from ClearWrite on this PC?')) return;
  await api.disconnect();
});
$('reconnect-button').addEventListener('click', async () => {
  try { await requireApi('connect')(); }
  catch (error) { showNotice(error.message); }
});
$('model-select').addEventListener('change', async () => {
  try { await api.updateSettings({ model: $('model-select').value }); showNotice('Model saved.'); }
  catch (error) { showNotice(error.message); }
});
$('shortcut-save').addEventListener('click', async () => {
  try { await api.updateSettings({ shortcut: $('shortcut-input').value.trim() }); showNotice('Shortcut saved.', true); }
  catch (error) { showNotice(error.message, true); }
});
$('startup-toggle').addEventListener('change', async () => {
  try { await api.updateSettings({ startupEnabled: $('startup-toggle').checked }); showNotice('Startup preference saved.', true); }
  catch (error) { showNotice(error.message, true); }
});
$('excluded-apps-save').addEventListener('click', async () => {
  const names = $('excluded-apps-input').value.split(',').map((name) => name.trim()).filter(Boolean);
  try { await api.updateSettings({ excludedApps: names }); showNotice('App exclusions saved.', true); }
  catch (error) { showNotice(error.message, true); }
});
$('allowed-apps-save').addEventListener('click', async () => {
  const names = $('allowed-apps-input').value.split(',').map((name) => name.trim()).filter(Boolean);
  try {
    await api.updateSettings({ allowedApps: names, restrictToAllowedApps: $('restrict-apps-toggle').checked });
    showNotice('Allowed apps saved.', true);
  } catch (error) { showNotice(error.message, true); }
});
$('restrict-apps-toggle').addEventListener('change', async () => {
  try { await api.updateSettings({ restrictToAllowedApps: $('restrict-apps-toggle').checked }); showNotice('App monitoring mode saved.', true); }
  catch (error) { showNotice(error.message, true); }
});
$('allow-current-app').addEventListener('click', async () => {
  const processName = current?.lastFocusedApp;
  if (!processName) return;
  const names = [...new Set([...(current.allowedApps || []), processName])];
  try {
    await api.updateSettings({ allowedApps: names, restrictToAllowedApps: true });
    showNotice(`${processName} added. Monitoring is now limited to apps in the allowlist.`, true);
  } catch (error) { showNotice(error.message, true); }
});
$('pause-monitor-hour').addEventListener('click', async () => {
  try { await api.pauseMonitor('hour'); showNotice('Monitoring will resume in one hour.'); }
  catch (error) { showNotice(error.message); }
});
$('pause-monitor-tomorrow').addEventListener('click', async () => {
  try { await api.pauseMonitor('tomorrow'); showNotice('Monitoring will resume tomorrow.'); }
  catch (error) { showNotice(error.message); }
});

$('monitor-toggle').addEventListener('click', async () => {
  $('monitor-toggle').disabled = true;
  const active = Boolean(current?.monitorEnabled && !(current?.monitorPausedUntil > Date.now()));
  try { await requireApi('setMonitor')(!active); }
  catch (error) { showNotice(error.message); }
  finally { $('monitor-toggle').disabled = false; }
});

if (api) {
  api.onState(render);
  api.getState().then(render).catch((error) => showNotice(error.message));
} else {
  showNotice('The desktop connection did not load. Restart ClearWrite before connecting.');
}
