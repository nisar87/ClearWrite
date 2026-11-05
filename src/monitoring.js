export const DEFAULT_EXCLUDED_PROCESSES = Object.freeze(['clearwrite', 'cmd', 'powershell', 'pwsh', 'windowsterminal', 'wt', 'regedit']);

export function normalizeProcessNames(values, maximum = 40) {
  if (!Array.isArray(values)) throw new Error('App names must be a list.');
  const names = values.map((value) => {
    if (typeof value !== 'string') throw new Error('App names must be text.');
    return value.trim().toLowerCase().replace(/\.exe$/i, '');
  }).filter(Boolean);
  if (names.some((name) => !/^[a-z0-9._-]{1,80}$/.test(name))) throw new Error('Use Windows process names containing letters, numbers, dots, underscores, or hyphens.');
  const unique = [...new Set(names)];
  if (unique.length > maximum) throw new Error(`Choose up to ${maximum} apps.`);
  return unique;
}

export function isProcessAllowed(processName, restrictToAllowed, allowedApps, excludedApps = []) {
  const name = typeof processName === 'string' ? processName.toLowerCase().replace(/\.exe$/i, '') : '';
  if (!name || DEFAULT_EXCLUDED_PROCESSES.includes(name) || excludedApps.includes(name)) return false;
  return !restrictToAllowed || allowedApps.includes(name);
}

export function monitoringPauseDeadline(period, now = Date.now()) {
  if (period === 'hour') return now + 60 * 60 * 1000;
  if (period === 'tomorrow') {
    const deadline = new Date(now);
    deadline.setDate(deadline.getDate() + 1);
    deadline.setHours(0, 0, 0, 0);
    return deadline.getTime();
  }
  throw new Error('Choose a supported monitoring pause.');
}

export function isMonitoringActive(enabled, pausedUntil = 0, now = Date.now()) {
  return enabled === true && (!Number.isFinite(pausedUntil) || pausedUntil <= now);
}

// Remote-desktop and virtual-machine viewers draw the remote screen as one opaque surface,
// so UI Automation on this PC cannot see the text fields inside them.
export const REMOTE_SESSION_PROCESSES = Object.freeze(['mstsc', 'msrdc', 'vmconnect', 'vmware', 'vmware-remotemks', 'virtualboxvm', 'wfica32', 'cdviewer', 'anydesk', 'teamviewer', 'vncviewer', 'tvnviewer']);

export function isRemoteSessionApp(processName) {
  const name = typeof processName === 'string' ? processName.toLowerCase().replace(/\.exe$/i, '') : '';
  return REMOTE_SESSION_PROCESSES.includes(name);
}
