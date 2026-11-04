export const MAX_LIVE_DRAFT_LENGTH = 6000;
export const MIN_LIVE_DRAFT_LENGTH = 12;

const URL_PATTERN = /\b(?:(?:https?|ftp):\/\/|www\.)[^\s<>"'`]+|\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:\/[^\s<>"'`]*)?/giu;
const EMAIL_PATTERN = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu;
const BROWSER_PROCESSES = new Set(['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc']);

export function prepareLiveDraft(value) {
  if (typeof value !== 'string') throw new Error('Draft text must be plain text.');
  const text = value.trim();
  if (text.length > MAX_LIVE_DRAFT_LENGTH) throw new Error(`Live drafts are limited to ${MAX_LIVE_DRAFT_LENGTH.toLocaleString()} characters.`);
  return text;
}

export function isReadyForLiveProofread(value) {
  return typeof value === 'string' && value.trim().length >= MIN_LIVE_DRAFT_LENGTH;
}

export function isUserEditSnapshot(snapshot) {
  return snapshot?.active === true && snapshot.changed === true &&
    snapshot.editable === true && snapshot.readOnly === false;
}

export function isPendingMonitorTextEdit(snapshot, pending) {
  return pending?.monitor === true && snapshot?.active === true &&
    snapshot.editable === true && snapshot.readOnly === false &&
    snapshot.key === pending.key && typeof snapshot.text === 'string' && snapshot.text !== pending.text;
}

export function isSamePendingMonitorText(snapshot, pending) {
  return pending?.monitor === true && snapshot?.active === true &&
    snapshot.editable === true && snapshot.readOnly === false &&
    snapshot.key === pending.key && snapshot.text === pending.text;
}

export function isBrowserAddressField(snapshot) {
  const processName = typeof snapshot?.processName === 'string'
    ? snapshot.processName.toLowerCase().replace(/\.exe$/i, '')
    : '';
  if (!BROWSER_PROCESSES.has(processName)) return false;
  const fieldLabel = `${snapshot.controlName || ''} ${snapshot.automationId || ''}`;
  return /address(?:\s+and\s+search)?[\s_-]*bar|omnibox|url[\s_-]*bar|web\s+address/i.test(fieldLabel);
}

export function isEligibleMonitorField(snapshot) {
  return snapshot?.active === true && snapshot.editable === true && snapshot.readOnly === false &&
    typeof snapshot.text === 'string' && snapshot.text.length <= MAX_LIVE_DRAFT_LENGTH &&
    !isBrowserAddressField(snapshot);
}

export function hasProofreadableProse(value) {
  if (typeof value !== 'string') return false;
  const prose = value.replace(URL_PATTERN, ' ').replace(EMAIL_PATTERN, ' ').trim();
  if (prose.length < MIN_LIVE_DRAFT_LENGTH) return false;
  const words = prose.match(/[\p{L}]+(?:['’][\p{L}]+)*/gu) || [];
  return words.length >= 2 && words.filter((word) => word.length >= 2).length >= 2;
}

export function isLiveProofreadCandidate(snapshot, pending) {
  return isEligibleMonitorField(snapshot) &&
    (isUserEditSnapshot(snapshot) || isPendingMonitorTextEdit(snapshot, pending)) &&
    isReadyForLiveProofread(snapshot.text) && hasProofreadableProse(snapshot.text);
}

export function protectUrls(value) {
  let prefix = '__CLEARWRITE_LINK_';
  while (value.includes(prefix)) prefix = `_${prefix}`;
  const urls = [];
  const input = value.replace(URL_PATTERN, (url) => {
    const token = `${prefix}${urls.length}__`;
    urls.push({ token, url });
    return token;
  });
  return { input, original: value, urls };
}

export function restoreUrls(value, protectedDraft) {
  if (!protectedDraft.urls.length) return value;
  if (protectedDraft.urls.some(({ token }) => !value.includes(token))) return protectedDraft.original;
  return protectedDraft.urls.reduce((text, { token, url }) => text.replace(token, url), value);
}

export function appendContinuation(original, continuation) {
  const next = continuation.trim();
  if (!next || !original) return original + next;
  if (next.startsWith(original)) return next;
  if (/\s$/.test(original) || /^[,.;:!?)}\]]/.test(next)) return original + next;
  return `${original} ${next}`;
}

export function preserveOuterWhitespace(original, corrected) {
  const leading = original.match(/^\s*/u)?.[0] || '';
  const trailing = original.match(/\s*$/u)?.[0] || '';
  return `${leading}${corrected.trim()}${trailing}`;
}
