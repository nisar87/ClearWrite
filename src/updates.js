export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_STARTUP_MS = 20_000;

export function updateErrorMessage(error) {
  return /checksum|sha512|signature|integrity/i.test(String(error?.message || error))
    ? 'Update verification failed. Nothing was installed. Try downloading again later.'
    : 'Could not complete the update. Check your internet connection and try again.';
}

export function createUpdateManager({ updater, version, automatic = true, onState = () => {},
  notify = () => {}, prepareInstall = async () => true, timers = globalThis }) {
  let state = { supported: Boolean(updater), status: updater ? 'idle' : 'unavailable',
    currentVersion: version, availableVersion: '', percent: 0, automatic: Boolean(automatic),
    checkedAt: '', error: '' };
  let disposed = false;
  let operation = '';
  let cancellationToken;
  let cancelling = false;
  let startupTimer;
  let periodicTimer;
  let notifiedVersion = '';
  const listeners = [];
  const snapshot = () => ({ ...state });
  function change(patch) {
    if (disposed) return;
    state = { ...state, ...patch };
    onState(snapshot());
  }
  function listen(event, handler) { updater.on(event, handler); listeners.push([event, handler]); }
  function stopTimers() { timers.clearTimeout(startupTimer); timers.clearInterval(periodicTimer); }
  function schedule() {
    stopTimers();
    if (disposed || !updater || !state.automatic) return;
    startupTimer = timers.setTimeout(() => { void check(); }, UPDATE_STARTUP_MS);
    periodicTimer = timers.setInterval(() => { void check(); }, UPDATE_INTERVAL_MS);
    startupTimer?.unref?.(); periodicTimer?.unref?.();
  }
  if (updater) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowPrerelease = version.includes('-');
    // Setting the channel enables downgrades in electron-updater, so reset this after it.
    updater.channel = version.includes('-') ? 'beta' : 'latest';
    updater.allowDowngrade = false;
    listen('update-available', (info) => {
      change({ status: 'available', availableVersion: info.version, percent: 0, error: '' });
      if (notifiedVersion !== info.version) { notifiedVersion = info.version; notify(info.version); }
    });
    listen('update-not-available', () => change({ status: 'current', availableVersion: '', error: '' }));
    listen('download-progress', (progress) => {
      if (!cancelling && state.status === 'downloading') change({ percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)) });
    });
    listen('update-downloaded', (info) => {
      if (!cancelling) change({ status: 'downloaded', availableVersion: info.version, percent: 100, error: '' });
    });
    listen('error', (error) => { if (!cancelling) change({ status: 'error', error: updateErrorMessage(error) }); });
  }
  async function check() {
    if (disposed || !updater || operation || ['downloaded', 'installing'].includes(state.status)) return snapshot();
    operation = 'check';
    change({ status: 'checking', error: '' });
    try {
      const result = await updater.checkForUpdates();
      cancellationToken = result?.cancellationToken;
      change({ checkedAt: new Date().toISOString() });
    } catch (error) { change({ status: 'error', error: updateErrorMessage(error) }); }
    finally { operation = ''; }
    return snapshot();
  }
  async function download() {
    if (disposed || !updater || operation || !['available', 'error'].includes(state.status) || !state.availableVersion) return snapshot();
    // A cancelled token cannot be reused. Recheck before retrying a cancelled download.
    if (!cancellationToken || cancellationToken.cancelled) {
      await check();
      if (state.status !== 'available' || operation) return snapshot();
    }
    operation = 'download'; cancelling = false;
    change({ status: 'downloading', percent: 0, error: '' });
    try { await updater.downloadUpdate(cancellationToken); }
    catch (error) { if (!cancelling) change({ status: 'error', error: updateErrorMessage(error) }); }
    finally {
      if (cancelling) change({ status: 'available', percent: 0, error: '' });
      cancelling = false; operation = '';
    }
    return snapshot();
  }
  function cancel() {
    if (operation === 'download') { cancelling = true; cancellationToken?.cancel(); }
    return snapshot();
  }
  async function install() {
    if (disposed || !updater || operation || state.status !== 'downloaded') return snapshot();
    operation = 'install';
    try {
      if (await prepareInstall()) {
        change({ status: 'installing', error: '' });
        updater.quitAndInstall(true, true);
      }
    } catch (error) { change({ status: 'error', error: updateErrorMessage(error) }); }
    finally { operation = ''; }
    return snapshot();
  }
  return {
    snapshot, check, download, cancel, install,
    setAutomatic(value) { change({ automatic: Boolean(value) }); schedule(); },
    start: schedule,
    dispose() {
      disposed = true; stopTimers(); cancellationToken?.cancel();
      // Keep the no-op-after-disposal error listener until process exit: a network
      // request may reject after shutdown starts, and EventEmitter errors must be handled.
      for (const [event, handler] of listeners) if (event !== 'error') updater.removeListener(event, handler);
    },
  };
}
