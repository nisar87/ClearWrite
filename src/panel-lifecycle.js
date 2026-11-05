// Single owner of the assistant panel's visibility.
//
// Visibility policy (documented in README "Writing panel behaviour"):
//   The panel becomes visible ONLY for one of these causes:
//     - 'writing'      a genuine edit with proofreadable text in an eligible field
//                      (not a focus event, not reading, not selection)
//     - 'restore'      the user asked for it (tray "Show writing panel" or the shortcut
//                      with nothing selected)
//     - 'manual-open'  the user selected text and pressed the shortcut
//   It hides ONLY for one of these causes:
//     - 'dismiss'      the user closed it (× or Esc)
//     - 'monitoring'   with active=false: the user paused or turned off monitoring
//     - 'manual-done'  a manual (selection) session finished via Copy/Replace/close
//   A manual session switches to the companion (without hiding) when the user makes a
//   genuine edit in a different eligible field than the one the selection came from.
//     - 'quit'
//   A companion dismissal is remembered for the dismissed field. The panel stays hidden
//   while the user keeps writing in that field and only returns on an explicit restore
//   or a genuine edit in a *different* field (a clearly new writing context).
//   Focus, blur, app switches, UI Automation read gaps, loading, results and errors are
//   content updates and never change visibility.
//
// Z-order: a pinned panel is always-on-top. An unpinned panel is a normal window, so the app
// being written in can cover it. It is raised (without focus, never shown from hidden) only
// when there is something new for the writer: the first genuine edit in a new field, and a
// review result. Nothing raises it on a timer or on focus/blur noise.

// Always-on-top level for a pinned panel. On Windows, Electron places windows set with the
// levels 'floating' (its default) through 'status' *behind the taskbar*: it calls
// SetWindowPos(panel, Shell_TrayWnd) on setAlwaysOnTop and again every time the panel is
// activated. When Windows has demoted the taskbar out of the topmost band, that call drops
// the panel's topmost status and the editor covers it. 'pop-up-menu' is the lowest level that
// uses plain HWND_TOPMOST. It does not cover the secure desktop (UAC) or exclusive full-screen.
export const PINNED_TOPMOST_LEVEL = 'pop-up-menu';
export const ELECTRON_BEHIND_TASKBAR_LEVELS = Object.freeze(['floating', 'torn-off-menu', 'modal-panel', 'main-menu', 'status']);

// Decides from the *native* window state (reported by the focus helper) whether a pinned,
// visible panel has lost its topmost status and must have it re-applied once.
export function needsTopmostRepair(lifecycle, native) {
  if (!lifecycle?.pinned || !lifecycle.visible) return false;
  if (!native || native.visible !== true) return false;
  return native.topmost === false;
}

export function createPanelLifecycle({ pinned = true } = {}) {
  return {
    visible: false,
    mode: 'none', // 'none' | 'companion' | 'manual'
    dismissedKey: null, // null = not dismissed; string = field key that was dismissed ('' = no field)
    resumeCompanion: false,
    manualSourceKey: null,
    attentionKey: null, // field the panel last came forward for
    raiseSeq: 0, // bumps when the unpinned panel should come to the front
    pinned: pinned !== false,
    reason: 'initial',
  };
}

const CONTENT_ONLY_EVENTS = new Set(['focus', 'blur', 'app-switch', 'field-gap', 'loading', 'error', 'renderer-reload', 'display-change']);

export function reducePanel(state, event) {
  switch (event?.type) {
    case 'writing': {
      if (state.mode === 'manual') {
        // Editing the field the selection came from keeps the manual session. A genuine edit
        // in any other eligible field is a new writing context: the panel switches to it in
        // place (it is already visible, so no window operation happens).
        if (event.key === state.manualSourceKey) return state;
        return { ...state, visible: true, mode: 'companion', dismissedKey: null, resumeCompanion: false, manualSourceKey: null, attentionKey: event.key, raiseSeq: state.raiseSeq + 1, reason: 'writing' };
      }
      if (state.dismissedKey !== null && event.key === state.dismissedKey) return state;
      if (state.visible && state.mode === 'companion' && state.dismissedKey === null) {
        // Already showing: only a new writing context brings it forward.
        return event.key === state.attentionKey ? state : { ...state, attentionKey: event.key, raiseSeq: state.raiseSeq + 1 };
      }
      return { ...state, visible: true, mode: 'companion', dismissedKey: null, attentionKey: event.key, raiseSeq: state.raiseSeq + 1, reason: 'writing' };
    }
    case 'restore':
      // An explicit request to see the panel: an unpinned panel that is already "visible" but
      // covered is also brought forward (the user's hotkey/tray action permits the raise).
      return {
        ...state,
        raiseSeq: state.raiseSeq + 1,
        visible: true,
        mode: state.mode === 'manual' ? 'manual' : 'companion',
        dismissedKey: null,
        reason: 'restore',
      };
    case 'manual-open':
      return {
        ...state,
        visible: true,
        mode: 'manual',
        // The live field the selection came from ('' when it was not a monitored field).
        manualSourceKey: typeof event.sourceKey === 'string' ? event.sourceKey : '',
        // The user explicitly asked for the panel, so an earlier companion dismissal ends.
        dismissedKey: null,
        resumeCompanion: state.mode === 'companion' ? state.visible : state.mode === 'manual' ? state.resumeCompanion : false,
        reason: 'manual-open',
      };
    case 'manual-done':
      if (state.mode !== 'manual') return state;
      return state.resumeCompanion && event.monitoring
        ? { ...state, visible: true, mode: 'companion', resumeCompanion: false, manualSourceKey: null, reason: 'manual-done' }
        : { ...state, visible: false, mode: 'none', resumeCompanion: false, manualSourceKey: null, reason: 'manual-done' };
    case 'dismiss':
      if (state.mode === 'manual') return reducePanel(state, { type: 'manual-done', monitoring: false });
      return { ...state, visible: false, mode: 'none', dismissedKey: typeof event.key === 'string' ? event.key : '', attentionKey: null, reason: 'dismiss' };
    case 'monitoring':
      if (event.active) return state;
      if (state.mode === 'manual') return { ...state, resumeCompanion: false, dismissedKey: null };
      return { ...state, visible: false, mode: 'none', dismissedKey: null, attentionKey: null, reason: 'monitoring-off' };
    case 'result':
      // A new suggestion for the field being written in.
      return state.visible && state.mode === 'companion' ? { ...state, raiseSeq: state.raiseSeq + 1 } : state;
    case 'pin':
      return { ...state, pinned: Boolean(event.pinned) };
    case 'quit':
      return { ...state, visible: false, mode: 'none', reason: 'quit' };
    default:
      if (CONTENT_ONLY_EVENTS.has(event?.type)) return state;
      throw new Error(`Unknown panel event: ${event?.type}`);
  }
}

// Native operations needed to move the window from `previous` to `next`.
// 'show' never takes keyboard focus except for an explicit manual selection session.
export function panelWindowOps(previous, next) {
  const ops = [];
  if (previous.pinned !== next.pinned) ops.push(next.pinned ? 'pin' : 'unpin');
  if (!previous.visible && next.visible) ops.push(next.mode === 'manual' ? 'show-focus' : 'show-inactive');
  else if (previous.visible && next.visible && next.mode === 'manual' && previous.mode !== 'manual') ops.push('focus');
  else if (previous.visible && !next.visible) ops.push('hide');
  // 'raise' moves an unpinned, visible companion to the top of the normal z-order without
  // activating it. It is never emitted for a hidden panel, a pinned panel, or manual mode.
  const shownInactive = ops.includes('show-inactive');
  if (next.visible && !next.pinned && next.mode === 'companion' && (shownInactive || next.raiseSeq !== previous.raiseSeq)) ops.push('raise');
  return ops;
}
