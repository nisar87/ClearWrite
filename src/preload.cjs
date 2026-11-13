const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clearWrite', {
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  cancelUpdate: () => ipcRenderer.invoke('updates:cancel'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  setAutomaticUpdates: (value) => ipcRenderer.invoke('updates:automatic', value),
  openReleases: () => ipcRenderer.invoke('updates:releases'),
  openLink: (name) => ipcRenderer.invoke('app:open-link', name),
  onOpenUpdates: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:open-updates', listener);
    return () => ipcRenderer.removeListener('app:open-updates', listener);
  },
  getState: () => ipcRenderer.invoke('app:get-state'),
  connect: () => ipcRenderer.invoke('app:connect'),
  cancelConnect: () => ipcRenderer.invoke('app:cancel-connect'),
  disconnect: () => ipcRenderer.invoke('app:disconnect'),
  openUsage: () => ipcRenderer.invoke('app:open-usage'),
  updateSettings: (settings) => ipcRenderer.invoke('app:update-settings', settings),
  updateProvider: (provider) => ipcRenderer.invoke('app:update-provider', provider),
  setMonitor: (enabled) => ipcRenderer.invoke('app:set-monitor', enabled),
  setProofreadingMode: (mode) => ipcRenderer.invoke('app:set-proofreading-mode', mode),
  setDialect: (dialect) => ipcRenderer.invoke('app:set-dialect', dialect),
  setAiScope: (scope) => ipcRenderer.invoke('app:set-ai-scope', scope),
  listDictionary: () => ipcRenderer.invoke('dictionary:list'),
  addDictionaryWord: (word) => ipcRenderer.invoke('dictionary:add', word),
  removeDictionaryWord: (word) => ipcRenderer.invoke('dictionary:remove', word),
  forgetLearned: (from, to) => ipcRenderer.invoke('learning:remove', from, to),
  forgetAllLearned: () => ipcRenderer.invoke('learning:clear'),
  addWordFromPanel: (word) => ipcRenderer.invoke('assistant:add-word', word),
  chooseFinding: (index, option) => ipcRenderer.invoke('assistant:choose-finding', index, option),
  pauseMonitor: (period) => ipcRenderer.invoke('app:pause-monitor', period),
  saveGeminiKey: (key) => ipcRenderer.invoke('gemini:save-key', key),
  removeGeminiKey: () => ipcRenderer.invoke('gemini:remove-key'),
  testGemini: () => ipcRenderer.invoke('gemini:test'),
  refreshModels: () => ipcRenderer.invoke('app:refresh-models'),
  begin: () => ipcRenderer.invoke('assistant:begin'),
  transform: (action, revision) => ipcRenderer.invoke('assistant:transform', action, revision),
  replace: () => ipcRenderer.invoke('assistant:replace'),
  copy: () => ipcRenderer.invoke('assistant:copy'),
  updateResult: (value) => ipcRenderer.invoke('assistant:update-result', value),
  dismiss: () => ipcRenderer.invoke('assistant:dismiss'),
  cancel: () => ipcRenderer.invoke('assistant:cancel'),
  undo: () => ipcRenderer.invoke('assistant:undo'),
  retry: () => ipcRenderer.invoke('assistant:retry'),
  setPinned: (pinned) => ipcRenderer.invoke('assistant:set-pinned', pinned),
  assistantReady: () => ipcRenderer.invoke('assistant:ready'),
  showApp: () => ipcRenderer.invoke('app:show'),
  proofreadLive: (text, requestId) => ipcRenderer.invoke('live:proofread', text, requestId),
  cancelLive: () => ipcRenderer.invoke('live:cancel'),
  readClipboard: () => ipcRenderer.invoke('live:read-clipboard'),
  copyText: (text) => ipcRenderer.invoke('live:copy', text),
  onLiveDelta: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('live:delta', listener);
    return () => ipcRenderer.removeListener('live:delta', listener);
  },
  underlineHover: (index) => ipcRenderer.invoke('underlines:hover', index),
  badgeClick: () => ipcRenderer.invoke('badge:click'),
  cardApply: (index, option) => ipcRenderer.invoke('card:apply', index, option),
  cardIgnore: (index) => ipcRenderer.invoke('card:ignore', index),
  cardAddWord: (word) => ipcRenderer.invoke('card:add-word', word),
  cardOpenPanel: (index) => ipcRenderer.invoke('card:open-panel', index),
  cardClose: () => ipcRenderer.invoke('card:close'),
  cardHover: (inside) => ipcRenderer.invoke('card:hover', inside),
  cardResize: (height) => ipcRenderer.invoke('card:resize', height),
  setSuggestionStyle: (style) => ipcRenderer.invoke('app:set-suggestion-style', style),
  setTheme: (theme) => ipcRenderer.invoke('app:set-theme', theme),
  setHistoryEnabled: (enabled) => ipcRenderer.invoke('stats:set-history', enabled),
  clearHistory: () => ipcRenderer.invoke('stats:clear-history'),
  removeHistoryEntry: (id) => ipcRenderer.invoke('stats:remove', id),
  resetStats: () => ipcRenderer.invoke('stats:reset'),
  copyHistoryEntry: (id, which) => ipcRenderer.invoke('stats:copy', id, which),
  onBadge: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('badge:state', listener);
    return () => ipcRenderer.removeListener('badge:state', listener);
  },
  onCard: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('card:state', listener);
    return () => ipcRenderer.removeListener('card:state', listener);
  },
  openUnderline: (index) => ipcRenderer.invoke('underlines:open', index),
  setShowUnderlines: (enabled) => ipcRenderer.invoke('app:set-underlines', enabled),
  onUnderlines: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('underlines:state', listener);
    return () => ipcRenderer.removeListener('underlines:state', listener);
  },
  onState: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('app:state', listener);
    return () => ipcRenderer.removeListener('app:state', listener);
  },
  onAssistant: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('assistant:state', listener);
    return () => ipcRenderer.removeListener('assistant:state', listener);
  },
});
