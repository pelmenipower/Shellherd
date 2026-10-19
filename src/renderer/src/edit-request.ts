// Edit bus: the TerminalPanel error card cannot reach App.editNode through props (U4), so the
// main window registers one handler here. Secondary windows register none.
let current: ((connectionId: string) => void) | null = null;

/** The window that can edit connections registers one handler; returns the unsubscribe. */
export function onEditRequest(handler: (connectionId: string) => void): () => void {
  current = handler;
  return () => { if (current === handler) current = null; };
}

/** True while a handler is registered (main window only). */
export function canEditConnections(): boolean {
  return current !== null;
}

export function requestEdit(connectionId: string): void {
  current?.(connectionId);
}
