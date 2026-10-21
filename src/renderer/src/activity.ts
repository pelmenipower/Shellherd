const EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const;

/** Capture listeners (passive) for input events; `send` runs on the first event and then at most once per `throttleMs`. Returns the remover. */
export function reportActivity(target: Window, send: () => void, throttleMs = 10_000, now: () => number = Date.now): () => void {
  let last: number | null = null;
  const listener = (): void => {
    const time = now();
    if (last !== null && time - last < throttleMs) return;
    last = time;
    send();
  };
  const options = { capture: true, passive: true };
  for (const type of EVENTS) target.addEventListener(type, listener, options);
  return () => { for (const type of EVENTS) target.removeEventListener(type, listener, options); };
}
