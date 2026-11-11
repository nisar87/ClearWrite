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
  renderStats(state.stats);
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
  history: { title: 'History', subtitle: 'Corrections you made in the last 90 days, kept only on this PC.' },
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
document.querySelectorAll('[data-goto]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.goto)));
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

// ---------------------------------------------------------------------------
// Writing stats (Home) and correction history.
// ---------------------------------------------------------------------------
const SVG = 'http://www.w3.org/2000/svg';
let lastStats = null;

function svg(tag, attributes = {}, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  parent?.append(node);
  return node;
}

function dayLabel(key, style = 'short') {
  const [year, month, date] = key.split('-').map(Number);
  const value = new Date(year, month - 1, date);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (style === 'long') {
    if (value.toDateString() === today.toDateString()) return 'Today';
    if (value.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return value.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  }
  return value.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function niceMax(value) {
  if (value <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const factor of [1, 2, 2.5, 5, 10]) if (factor * step >= value) return factor * step;
  return 10 * step;
}

function renderChart(days) {
  const host = $('chart');
  const width = Math.max(320, host.clientWidth || 800);
  const height = 190;
  const left = 34;
  const right = 8;
  const top = 10;
  const bottom = 24;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = niceMax(Math.max(1, ...days.map((day) => Math.max(day.found, day.fixed))));
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'chart-svg' });
  for (const step of [0, 0.5, 1]) {
    const y = top + plotHeight - step * plotHeight;
    svg('line', { x1: left, x2: width - right, y1: y, y2: y, class: step === 0 ? 'axis' : 'grid' }, chart);
    svg('text', { x: left - 8, y: y + 4, class: 'tick', 'text-anchor': 'end' }, chart).textContent = Math.round(step * max).toLocaleString();
  }
  const slot = plotWidth / days.length;
  const bar = Math.max(2, Math.min(9, slot / 2 - 2));
  days.forEach((day, index) => {
    const x = left + index * slot + slot / 2;
    const group = svg('g', { class: 'day' }, chart);
    svg('title', {}, group).textContent = `${dayLabel(day.day, 'long')}: ${day.found} found, ${day.fixed} fixed, ${day.words.toLocaleString()} words checked`;
    svg('rect', { x: left + index * slot, y: top, width: slot, height: plotHeight, class: 'hit' }, group);
    const foundHeight = (day.found / max) * plotHeight;
    const fixedHeight = (day.fixed / max) * plotHeight;
    if (day.found) svg('rect', { x: x - bar - 1, y: top + plotHeight - foundHeight, width: bar, height: foundHeight, rx: Math.min(3, bar / 2), class: 'bar-found' }, group);
    if (day.fixed) svg('rect', { x: x + 1, y: top + plotHeight - fixedHeight, width: bar, height: fixedHeight, rx: Math.min(3, bar / 2), class: 'bar-fixed' }, group);
    if (index % 7 === days.length % 7 - 1 || index === days.length - 1) {
      svg('text', { x, y: height - 6, class: 'tick', 'text-anchor': index === days.length - 1 ? 'end' : 'middle' }, chart).textContent = index === days.length - 1 ? 'Today' : dayLabel(day.day);
    }
  });
  host.replaceChildren(chart);
}

function changeItem(entry, { actions = false } = {}) {
  const item = document.createElement(actions ? 'div' : 'li');
  item.className = actions ? 'history-item' : 'change-item';
  const text = document.createElement('div');
  text.className = 'change-text';
  const lead = document.createElement('span'); lead.className = 'context'; lead.textContent = entry.lead;
  const from = document.createElement('del'); from.textContent = entry.from;
  const to = document.createElement('ins'); to.textContent = entry.to;
  const tail = document.createElement('span'); tail.className = 'context'; tail.textContent = entry.tail;
  text.append(lead, from, to, tail);
  const meta = document.createElement('div');
  meta.className = 'change-meta';
  const kind = document.createElement('span');
  kind.className = `kind kind-${(entry.kind || 'correction').toLowerCase()}`;
  kind.textContent = entry.kind || 'Correction';
  const when = document.createElement('span');
  when.textContent = [new Date(entry.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), entry.app].filter(Boolean).join(' · ');
  meta.append(kind, when);
  const body = document.createElement('div');
  body.className = 'change-body';
  body.append(text, meta);
  item.append(body);
  if (actions) {
    const tools = document.createElement('div');
    tools.className = 'row-actions';
    const copy = document.createElement('button');
    copy.className = 'text-button';
    copy.type = 'button';
    copy.textContent = 'Copy original';
    copy.title = 'Copies the text as it was before this fix, to paste it back';
    copy.addEventListener('click', async () => {
      try { await requireApi('copyHistoryEntry')(entry.id, 'before'); $('history-notice').textContent = 'Original text copied. Paste it in your app to undo the fix.'; }
      catch (error) { $('history-notice').textContent = error.message; }
    });
    const remove = document.createElement('button');
    remove.className = 'icon-button small';
    remove.type = 'button';
    remove.title = 'Remove from history';
    remove.setAttribute('aria-label', `Remove ${entry.from} to ${entry.to} from history`);
    remove.innerHTML = '<svg class="icon"><use href="#i-trash"/></svg>';
    remove.addEventListener('click', async () => {
      try { await requireApi('removeHistoryEntry')(entry.id); }
      catch (error) { $('history-notice').textContent = error.message; }
    });
    tools.append(copy, remove);
    item.append(tools);
  }
  return item;
}

function renderHistory(stats) {
  const query = $('history-search').value.trim().toLocaleLowerCase();
  const all = stats?.history || [];
  const entries = query ? all.filter((entry) => `${entry.lead}${entry.from} ${entry.to}${entry.tail} ${entry.app} ${entry.kind}`.toLocaleLowerCase().includes(query)) : all;
  const groups = new Map();
  for (const entry of entries) {
    const date = new Date(entry.at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const blocks = [...groups].map(([key, items]) => {
    const section = document.createElement('section');
    section.className = 'history-day';
    const heading = document.createElement('h3');
    heading.textContent = `${dayLabel(key, 'long')} · ${items.length} fix${items.length === 1 ? '' : 'es'}`;
    const list = document.createElement('div');
    list.className = 'card history-card';
    list.append(...items.map((entry) => changeItem(entry, { actions: true })));
    section.append(heading, list);
    return section;
  });
  $('history-list').replaceChildren(...blocks);
  const enabled = stats?.historyEnabled !== false;
  $('history-toggle').checked = enabled;
  $('history-clear').disabled = !all.length;
  const total = Math.max(stats?.historyCount || 0, all.length);
  $('history-count').textContent = !all.length ? '' : query ? `${entries.length} of ${all.length} shown` : total > all.length ? `Latest ${all.length} of ${total.toLocaleString()}` : `${total.toLocaleString()} correction${total === 1 ? '' : 's'}`;
  $('history-empty').classList.toggle('hidden', entries.length > 0);
  $('history-empty-title').textContent = !enabled ? 'History is off' : query && all.length ? 'No matching corrections' : 'No corrections yet';
  $('history-empty-detail').textContent = !enabled
    ? 'Fixes are still counted on Home, but no text is kept. Turn on “Keep history” to list your corrections here.'
    : query && all.length ? 'Try a different word.' : 'When you apply or copy a fix, it is listed here with a few words around it, so you can check what changed. History stays on this PC and is deleted after 90 days.';
  const count = $('nav-history-count');
  const today = stats?.today?.fixed || 0;
  count.textContent = today > 99 ? '99+' : String(today);
  count.classList.toggle('hidden', !today);
  count.title = `${today} fixed today`;
}

let lastStatsKey = '';
function renderStats(stats) {
  if (!stats) return;
  // The window state is republished often (monitor status); redraw only when stats changed.
  const key = JSON.stringify(stats);
  if (key === lastStatsKey) return;
  lastStatsKey = key;
  lastStats = stats;
  const { today, month, days } = stats;
  $('tile-fixed').textContent = today.fixed.toLocaleString();
  $('tile-fixed-detail').textContent = today.found ? `${today.found.toLocaleString()} mistake${today.found === 1 ? '' : 's'} found` : 'No mistakes found yet';
  $('tile-words').textContent = today.words.toLocaleString();
  $('tile-words-detail').textContent = month.words ? `${month.words.toLocaleString()} in the last 30 days` : 'In every app you write in';
  $('tile-accept').textContent = month.acceptRate === null ? '–' : `${month.acceptRate}%`;
  $('tile-accept-detail').textContent = month.acceptRate === null ? 'Last 30 days' : `${month.fixed.toLocaleString()} fixed, ${month.dismissed.toLocaleString()} dismissed · 30 days`;
  $('chart-summary').textContent = month.found || month.fixed
    ? `${month.found.toLocaleString()} found and ${month.fixed.toLocaleString()} fixed in ${month.words.toLocaleString()} words.`
    : 'Mistakes found and fixed each day. Start writing and this fills in.';
  $('chart').setAttribute('aria-label', `Last 30 days: ${month.found} mistakes found, ${month.fixed} fixed`);
  renderChart(days);
  $('chart-table-body').replaceChildren(...days.slice().reverse().filter((day) => day.words || day.found || day.fixed || day.dismissed).map((day) => {
    const row = document.createElement('tr');
    for (const value of [dayLabel(day.day, 'long'), day.words.toLocaleString(), day.found, day.fixed, day.dismissed]) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
    return row;
  }));
  const recent = (stats.history || []).slice(0, 4);
  $('recent-list').replaceChildren(...recent.map((entry) => changeItem(entry)));
  $('recent-empty').classList.toggle('hidden', recent.length > 0);
  $('recent-empty').textContent = stats.historyEnabled === false ? 'History is off. Turn it on from the History page.' : 'Fixes you apply or copy appear here.';
  $('top-list').replaceChildren(...(stats.top || []).map((item) => {
    const row = document.createElement('li');
    const change = document.createElement('span');
    change.className = 'change-text';
    const from = document.createElement('del'); from.textContent = item.from;
    const to = document.createElement('ins'); to.textContent = item.to;
    change.append(from, to);
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${item.count}×`;
    row.append(change, count);
    return row;
  }));
  $('top-empty').classList.toggle('hidden', (stats.top || []).length > 0);
  renderHistory(stats);
}

let chartResize;
window.addEventListener('resize', () => {
  clearTimeout(chartResize);
  chartResize = setTimeout(() => { if (lastStats) renderChart(lastStats.days); }, 120);
});
document.querySelectorAll('[data-page="live"]').forEach((button) => button.addEventListener('click', () => { if (lastStats) requestAnimationFrame(() => renderChart(lastStats.days)); }));
$('history-search').addEventListener('input', () => renderHistory(lastStats));
$('history-toggle').addEventListener('change', async () => {
  const enabled = $('history-toggle').checked;
  if (!enabled && (lastStats?.history || []).length && !confirm('Turn off history? The corrections kept so far will be deleted. Your counts on Home are kept.')) {
    $('history-toggle').checked = true;
    return;
  }
  try { await requireApi('setHistoryEnabled')(enabled); $('history-notice').textContent = enabled ? 'History is on.' : 'History is off and was cleared.'; }
  catch (error) { $('history-notice').textContent = error.message; }
});
$('history-clear').addEventListener('click', async () => {
  if (!confirm('Delete every correction in your history? Your counts on Home are kept.')) return;
  try { await requireApi('clearHistory')(); $('history-notice').textContent = 'History cleared.'; }
  catch (error) { $('history-notice').textContent = error.message; }
});
$('stats-reset').addEventListener('click', async () => {
  if (!confirm('Reset all writing stats (words checked, mistakes found and fixed)? History is kept unless you clear it.')) return;
  try { await requireApi('resetStats')(); showNotice('Writing stats reset.', true); }
  catch (error) { showNotice(error.message, true); }
});
