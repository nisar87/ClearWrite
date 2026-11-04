export function createMonitorSession() {
  return {
    phase: 'idle',
    key: '',
    processName: '',
    text: '',
    snapshot: null,
    revision: 0,
    dismissedKey: '',
  };
}

export function transitionMonitorSession(session, event) {
  switch (event.type) {
    case 'field': {
      const { snapshot } = event;
      const fieldChanged = session.key !== snapshot.key;
      const textChanged = session.text !== snapshot.text;
      const returning = session.phase === 'idle' || session.phase === 'searching';
      const revision = session.revision + Number(fieldChanged || textChanged || returning);
      const dismissedKey = fieldChanged ? '' : session.dismissedKey;
      const dismissed = dismissedKey === snapshot.key;
      const unchangedFocused = !fieldChanged && !textChanged && !event.edited && !returning;
      return {
        ...session,
        phase: dismissed ? 'dismissed' : unchangedFocused ? session.phase : event.edited ? 'editing' : 'focused',
        key: snapshot.key,
        processName: snapshot.processName || '',
        text: snapshot.text,
        snapshot,
        revision,
        dismissedKey,
      };
    }
    case 'searching':
      return session.phase === 'searching'
        ? session
        : { ...session, phase: 'searching', revision: session.revision + 1 };
    case 'reviewing':
      return event.revision === session.revision ? { ...session, phase: 'reviewing' } : session;
    case 'suggestion':
      return event.revision === session.revision ? { ...session, phase: 'suggestion' } : session;
    case 'failed':
      return event.revision === session.revision ? { ...session, phase: 'focused' } : session;
    case 'applied':
      return event.revision === session.revision ? { ...session, phase: 'suggestion', text: event.text } : session;
    case 'dismiss':
      return { ...session, phase: 'dismissed', dismissedKey: session.key, revision: session.revision + 1 };
    case 'restore':
      return { ...session, phase: session.key ? 'focused' : 'searching', dismissedKey: '', revision: session.revision + 1 };
    case 'clear':
      return { ...createMonitorSession(), revision: session.revision + 1 };
    default:
      throw new Error(`Unknown monitor transition: ${event.type}`);
  }
}
