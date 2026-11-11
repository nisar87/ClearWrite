// The ClearWrite widget in the corner of the field being edited: checking, number of issues,
// or all clear. A click opens the full panel.
const api = window.clearWrite;
const badge = document.getElementById('badge');
const label = document.getElementById('badge-text');

api.onBadge((state) => {
  badge.className = `badge ${state.status}`;
  label.textContent = state.status === 'issues' ? (state.count > 9 ? '9+' : String(state.count)) : state.status === 'clear' ? '✓' : state.status === 'error' ? '!' : '';
  const title = state.status === 'issues' ? `${state.count} suggestion${state.count === 1 ? '' : 's'}. Click to review in ClearWrite.`
    : state.status === 'clear' ? 'ClearWrite found nothing to fix. Click to open ClearWrite.'
      : state.status === 'error' ? 'ClearWrite could not check this text. Click for details.'
        : 'ClearWrite is checking…';
  badge.title = title;
  badge.setAttribute('aria-label', title);
});
badge.addEventListener('click', () => { void api.badgeClick(); });
