// Proofreading mode: where checking happens and whether any text may leave this device.
//
//   'offline'  (default) Text is checked only by the bundled Harper checker on this device.
//              ClearWrite makes no AI or provider network request, even when a provider is
//              configured.
//   'ai'       The user explicitly opted in. Eligible text is sent to the selected provider
//              (Gemini or ChatGPT) after the usual pause. If a request fails, the on-device
//              result is shown instead.
//
// Every provider request goes through createProofreadingRouter().requestAi, which refuses in
// Offline only mode before any provider code runs.

export const PROOFREADING_MODES = Object.freeze(['offline', 'ai']);
export const DEFAULT_PROOFREADING_MODE = 'offline';

export const ENGLISH_DIALECTS = Object.freeze({
  american: 'American English',
  british: 'British English',
  australian: 'Australian English',
  canadian: 'Canadian English',
  indian: 'Indian English',
});
export const DEFAULT_ENGLISH_DIALECT = 'american';

// Spelling and grammar correction works on the device. These actions rewrite text and need
// an AI provider, so they are only offered in AI-assisted mode.
export const AI_ONLY_ACTIONS = Object.freeze(['clearer', 'professional', 'friendly', 'continue', 'reply']);

export function actionRequiresAi(action) {
  return AI_ONLY_ACTIONS.includes(action);
}

export function normalizeProofreadingMode(value) {
  if (!PROOFREADING_MODES.includes(value)) throw new Error('Choose Offline only or AI-assisted.');
  return value;
}

export function normalizeEnglishDialect(value) {
  if (!Object.hasOwn(ENGLISH_DIALECTS, value)) throw new Error('Choose a supported English dialect.');
  return value;
}

export const OFFLINE_MIGRATION_NOTICE = 'ClearWrite now checks your writing on this device by default (Offline only). Your AI provider settings are kept. Choose AI-assisted on the Live writing page if you want to use them again.';

// Reads saved preferences. Existing installs (which predate the mode setting) move to Offline
// only, keep their provider settings, and keep the dialect they were already using (Indian
// English was the only dialect before). New installs start Offline only with American English.
export function migrateProofreadingPreferences(raw) {
  const saved = raw && typeof raw === 'object' ? raw : {};
  const existingInstall = saved.privacyDefaultsVersion === 1;
  const hasMode = PROOFREADING_MODES.includes(saved.proofreadingMode);
  const mode = hasMode ? saved.proofreadingMode : DEFAULT_PROOFREADING_MODE;
  const dialect = Object.hasOwn(ENGLISH_DIALECTS, saved.englishDialect)
    ? saved.englishDialect
    : existingInstall ? 'indian' : DEFAULT_ENGLISH_DIALECT;
  return { mode, dialect, notice: existingInstall && !hasMode ? OFFLINE_MIGRATION_NOTICE : '' };
}

export class OfflineModeError extends Error {
  constructor(action = 'correct') {
    super(actionRequiresAi(action)
      ? 'This action needs AI-assisted mode. Choose AI-assisted on the Live writing page to use it.'
      : 'Offline only mode is on, so no text is sent to an AI provider.');
    this.name = 'OfflineModeError';
    this.code = 'OFFLINE_MODE';
  }
}

// getMode():  current mode ('offline' | 'ai'), read at call time
// isAiReady(): whether the selected provider is configured and has a model
// sendToProvider(action, text, signal): the only function that contacts a provider
export function createProofreadingRouter({ getMode, isAiReady, sendToProvider }) {
  if (typeof sendToProvider !== 'function') throw new Error('A provider function is required.');
  const canUseAi = () => getMode() === 'ai' && Boolean(isAiReady());
  return {
    canUseAi,
    reviewSource: () => (canUseAi() ? 'ai' : 'local'),
    async requestAi(action, text, signal) {
      if (getMode() !== 'ai') throw new OfflineModeError(action);
      if (!isAiReady()) throw new Error('The selected AI provider is not connected. Set it up in Settings, or switch to Offline only.');
      return sendToProvider(action, text, signal);
    },
    // Correction with the on-device checker always run in parallel. Returns
    //   { source: 'ai', output, local }          AI answered (local is a promise)
    //   { source: 'local', local }                Offline only / localOnly / AI not ready
    //   { source: 'local', local, aiError }       AI-assisted request failed: fallback
    // A request cancelled by the user or a newer edit (cancelSignal) is not a failure and
    // rethrows instead of falling back.
    async correctWithFallback(text, { proofreadLocal, signal, cancelSignal, localOnly = false } = {}) {
      const local = proofreadLocal(text);
      if (localOnly || !canUseAi()) return { source: 'local', local: await local };
      try {
        return { source: 'ai', output: await this.requestAi('correct', text, signal), local };
      } catch (error) {
        if (cancelSignal?.aborted) throw error;
        return { source: 'local', local: await local, aiError: error };
      }
    },
  };
}
