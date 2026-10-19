/** Focus rule of the connection cards and bars: they never pull the focus out of another input (e.g. the sidebar search). */
export function mayTakeFocus(panel: { contains(node: unknown): boolean } | null, activeElement: unknown, body: unknown): boolean {
  if (activeElement === null || activeElement === undefined || activeElement === body) return true;
  return panel?.contains(activeElement) ?? false;
}

/** Focuses `target` when the focus is already in the panel around `root` or nowhere in particular. */
export function focusIfAllowed(root: HTMLElement | null, target: HTMLElement | null): void {
  if (!target) return;
  const panel = root?.closest('.terminal-panel') ?? null;
  if (mayTakeFocus(panel, document.activeElement, document.body)) target.focus();
}
