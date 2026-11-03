export const MAX_LIVE_DRAFT_LENGTH = 6000;
export const MIN_LIVE_DRAFT_LENGTH = 12;

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
  return snapshot?.active === true && snapshot.changed === true && snapshot.readOnly !== true;
}
