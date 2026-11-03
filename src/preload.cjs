const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clearWrite', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  connect: () => ipcRenderer.invoke('app:connect'),
  cancelConnect: () => ipcRenderer.invoke('app:cancel-connect'),
  disconnect: () => ipcRenderer.invoke('app:disconnect'),
  openUsage: () => ipcRenderer.invoke('app:open-usage'),
  updateSettings: (settings) => ipcRenderer.invoke('app:update-settings', settings),
  updateProvider: (provider) => ipcRenderer.invoke('app:update-provider', provider),
  setMonitor: (enabled) => ipcRenderer.invoke('app:set-monitor', enabled),
  pauseMonitor: (period) => ipcRenderer.invoke('app:pause-monitor', period),
  saveGeminiKey: (key) => ipcRenderer.invoke('gemini:save-key', key),
  removeGeminiKey: () => ipcRenderer.invoke('gemini:remove-key'),
  testGemini: () => ipcRenderer.invoke('gemini:test'),
  refreshModels: () => ipcRenderer.invoke('app:refresh-models'),
  begin: () => ipcRenderer.invoke('assistant:begin'),
  transform: (action) => ipcRenderer.invoke('assistant:transform', action),
  replace: () => ipcRenderer.invoke('assistant:replace'),
  copy: () => ipcRenderer.invoke('assistant:copy'),
  updateResult: (value) => ipcRenderer.invoke('assistant:update-result', value),
  dismiss: () => ipcRenderer.invoke('assistant:dismiss'),
  cancel: () => ipcRenderer.invoke('assistant:cancel'),
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
