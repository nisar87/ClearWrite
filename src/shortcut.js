// Tracks what is actually registered with the OS separately from the preferred value.
// Root cause fixed here: the previous registerShortcut() returned early whenever the
// requested accelerator equalled the saved preference, so at startup the global shortcut
// was never registered and both the manual action and "reopen panel" were dead.
export function createShortcutRegistrar(globalShortcut, onPress) {
  let registered = '';
  return {
    get registered() { return registered; },
    register(value) {
      if (typeof value !== 'string' || !value || value.length > 80) return false;
      if (registered === value && globalShortcut.isRegistered(value)) return true;
      let ok = false;
      try { ok = globalShortcut.register(value, onPress); } catch { ok = false; }
      if (!ok) return false;
      if (registered && registered !== value) globalShortcut.unregister(registered);
      registered = value;
      return true;
    },
  };
}
