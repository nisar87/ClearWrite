import { hasProofreadableProse, isReadyForLiveProofread } from './live-proofread.js';

// Content state for the active writing field. Visibility lives in panel-lifecycle.js.
//
// Every piece of asynchronous work (local check, AI request) is tagged with the session
// `revision` it was started for. The revision increases whenever the field or its text
// changes, when a correction is applied/undone, or when the session is cleared. A result
// is accepted only if its revision is still current, so an older result can never replace
// a newer draft or appear for a different field.
//
// Leaving the field (app switch, unsupported control, password field, UI Automation gap)
// is the 'away' event: it does NOT change the revision or discard the suggestion, so a
// short focus gap or a quick alt-tab cannot erase or restart work.

// Review timing. 650 ms after the last detected edit is long enough to skip mid-word
// keystrokes at normal typing speed (~150-250 ms between keys) yet still feels immediate
// when the writer pauses. The focus helper polls every 150 ms, so worst-case latency from
// pause to request is ~800 ms.
export const REVIEW_DEBOUNCE_MS = 650;
// AI requests that have not completed after this long are cancelled and the on-device
// result is shown instead, so the panel can never stay in "checking" indefinitely.
export const AI_REVIEW_TIMEOUT_MS = 25_000;

// Actions offered for the live field. 'reply' and 'continue' stay in the explicit
// selected-text workflow: a reply must come from text the user chose to select.
export const LIVE_ACTIONS = Object.freeze(['correct', 'clearer', 'professional', 'friendly']);
export const MANUAL_ACTIONS = Object.freeze(['correct', 'clearer', 'professional', 'friendly', 'continue', 'reply']);

export const MONITOR_PHASES = Object.freeze(['idle', 'focused', 'editing', 'reviewing', 'suggestion', 'applied', 'failed', 'away']);

export function createMonitorSession(revision = 0) {
  return {
    phase: 'idle',
    key: '',
    processName: '',
    text: '',
    snapshot: null,
    revision,
    suggestion: null,
    error: '',
    applied: null,
    awayReason: '',
    phaseBeforeAway: '',
  };
}

function withPhase(session, phase, extra = {}) {
  if (session.phase === 'away') return { ...session, ...extra, phaseBeforeAway: phase };
  return { ...session, ...extra, phase };
}

export function transitionMonitorSession(session, event) {
  switch (event.type) {
    case 'field': {
      const { snapshot } = event;
      const sameField = session.phase !== 'idle' && session.key === snapshot.key;
      if (!sameField) {
        return {
          ...createMonitorSession(session.revision + 1),
          phase: event.edited ? 'editing' : 'focused',
          key: snapshot.key,
          processName: snapshot.processName || '',
          text: snapshot.text,
          snapshot,
        };
      }
      if (session.text !== snapshot.text) {
        return {
          ...session,
          phase: 'editing',
          phaseBeforeAway: '',
          awayReason: '',
          text: snapshot.text,
          snapshot,
          revision: session.revision + 1,
          suggestion: null,
          error: '',
        };
      }
      return {
        ...session,
        phase: session.phase === 'away' ? session.phaseBeforeAway || 'focused' : session.phase,
        phaseBeforeAway: '',
        awayReason: '',
        snapshot,
      };
    }
    case 'away': {
      if (session.phase === 'idle') return { ...session, awayReason: event.reason || '' };
      return {
        ...session,
        phase: 'away',
        phaseBeforeAway: session.phase === 'away' ? session.phaseBeforeAway : session.phase,
        awayReason: event.reason || '',
      };
    }
    case 'reviewing':
      return event.revision === session.revision ? withPhase(session, 'reviewing', { error: '' }) : session;
    case 'suggestion':
      return event.revision === session.revision ? withPhase(session, 'suggestion', { suggestion: event.suggestion, error: '' }) : session;
    case 'failed':
      return event.revision === session.revision ? withPhase(session, 'failed', { error: event.error || '' }) : session;
    case 'applied':
      if (event.revision !== session.revision) return session;
      return withPhase(session, 'applied', {
        applied: { before: session.text, after: event.text },
        text: event.text,
        suggestion: null,
        revision: session.revision + 1,
      });
    case 'undone':
      if (event.revision !== session.revision || !session.applied) return session;
      return withPhase(session, 'focused', { text: session.applied.before, applied: null, revision: session.revision + 1 });
    case 'clear':
      return createMonitorSession(session.revision + 1);
    default:
      throw new Error(`Unknown monitor transition: ${event.type}`);
  }
}

export function isCurrentRevision(session, revision) {
  return Number.isSafeInteger(revision) && session.revision === revision && session.phase !== 'idle';
}

// Small per-field cache so returning to an already-reviewed draft (undo, retype, focus
// return) reuses the result instead of sending the same text again.
export function createReviewCache(limit = 24) {
  const entries = new Map();
  const id = (key, text) => `${key}\u0000${text}`;
  return {
    get(key, text) {
      const name = id(key, text);
      if (!entries.has(name)) return undefined;
      const value = entries.get(name);
      entries.delete(name);
      entries.set(name, value);
      return value;
    },
    set(key, text, value) {
      const name = id(key, text);
      entries.delete(name);
      entries.set(name, value);
      while (entries.size > limit) entries.delete(entries.keys().next().value);
    },
    clear() { entries.clear(); },
    get size() { return entries.size; },
  };
}

// One pending callback at a time; scheduling again restarts the delay.
export function createDebouncer(delay, timers = globalThis) {
  let handle;
  return {
    schedule(callback) {
      if (handle !== undefined) timers.clearTimeout(handle);
      handle = timers.setTimeout(() => { handle = undefined; callback(); }, delay);
    },
    cancel() {
      if (handle !== undefined) timers.clearTimeout(handle);
      handle = undefined;
    },
    get pending() { return handle !== undefined; },
  };
}

const AWAY_LABELS = {
  password: 'Password fields are ignored',
  readonly: 'Read-only text is not checked',
  unsupported: 'This editor does not expose a supported text interface. Use the selection shortcut.',
  uncertainEditor: 'Text is readable, but editing could not be verified. Use the selection shortcut.',
  providerTimeout: 'The editor is not responding to accessibility requests',
  providerError: 'The editor could not be read through accessibility',
  fieldGap: 'The editor is temporarily unavailable',
  focusChanged: 'Waiting for the focused editor',
  foreignEditor: 'Waiting for accessibility focus to match the active window',
  noFocus: 'Waiting for a text field',
  disabled: 'Disabled text fields are ignored',
  nonTextControl: 'Not a text editor',
  excludedApp: 'Suggestions are off for this app',
  notAllowed: 'This app is not in your allowlist',
  tooLong: 'This field is too long to check',
  addressBar: 'Address bars are not checked',
  app: 'Waiting for a text field',
  remote: 'Remote Desktop and virtual-machine windows do not expose their text fields. Run ClearWrite inside that session to check text there.',
};

// Pure view model for the companion panel. Only data for the current revision is shown.
export function monitorView(session, { connected = false, provider = 'chatgpt', appLabel = '' } = {}) {
  const providerName = provider === 'gemini' ? 'Google Gemini' : 'ChatGPT';
  const base = {
    mode: 'companion',
    phase: session.phase,
    text: '',
    suggestion: null,
    connected,
    provider,
    providerName,
    replaceSupported: Boolean(session.snapshot?.replaceSupported),
    canApply: false,
    canCopy: false,
    canUndo: false,
    canRetry: false,
    actions: [],
    status: 'quiet',
    statusLine: connected ? 'Ready. Suggestions appear after you pause typing.' : 'Ready. On-device checks run after you pause typing.',
    detail: '',
    appLabel,
  };
  const phase = session.phase === 'away' ? session.phaseBeforeAway || 'focused' : session.phase;
  const awayLine = session.phase === 'away' ? AWAY_LABELS[session.awayReason] || AWAY_LABELS.app : '';
  if (session.phase === 'idle') return { ...base, statusLine: AWAY_LABELS[session.awayReason] || 'Start typing in any text field.' };
  const text = session.text || '';
  // Actions are offered whenever the panel shows the field's text (not while only focused).
  const view = { ...base, text, revision: session.revision, actions: text.trim() ? LIVE_ACTIONS : [] };
  switch (phase) {
    case 'focused':
      // Focus alone is not writing: the field's content is not echoed into the panel.
      return { ...view, text: '', actions: [], statusLine: awayLine || (text.trim() ? 'Watching this field. Edit to get suggestions.' : 'Watching this field. Start typing.') };
    case 'editing': {
      // Only promise a check when the text is long enough to be reviewed.
      const pendingLine = !text.trim() ? 'Watching this field. Start typing.'
        : isReadyForLiveProofread(text) && hasProofreadableProse(text) ? 'Will check when you pause…'
        : 'Keep typing. Checks start after a few words.';
      return { ...view, text: text.trim() ? text : '', status: text.trim() ? 'pending' : 'quiet', statusLine: awayLine || pendingLine };
    }
    case 'reviewing':
      return { ...view, status: 'working', statusLine: connected ? `Checking with ${providerName}…` : 'Checking on this device…' };
    case 'failed':
      return { ...view, status: 'error', statusLine: awayLine || 'Could not check this text', detail: session.error, canRetry: true };
    case 'applied':
      return { ...view, status: 'applied', statusLine: awayLine || 'Correction applied', canUndo: Boolean(session.applied) && base.replaceSupported };
    case 'suggestion': {
      const suggestion = session.suggestion;
      if (!suggestion) return view;
      const unchanged = suggestion.text === text;
      const skipped = suggestion.source === 'local' && suggestion.supported === false;
      // Findings with edits track the writer's choices; a chosen or ignored finding is resolved.
      const unresolved = suggestion.needsChoice > 0 || suggestion.findings?.some((finding) => (Array.isArray(finding.edits) ? !finding.ignored && !(finding.choice >= 0) : !finding.appliedLocally));
      return {
        ...view,
        suggestion,
        status: skipped ? 'quiet' : !unchanged || unresolved ? 'suggestion' : 'clean',
        statusLine: awayLine || (skipped ? 'Offline check skipped' : unresolved ? 'Possible mistakes need your review' : unchanged ? 'No corrections found' : 'Suggestion ready to review'),
        canCopy: !unchanged,
        canApply: !unchanged && base.replaceSupported,
      };
    }
    default:
      return view;
  }
}
