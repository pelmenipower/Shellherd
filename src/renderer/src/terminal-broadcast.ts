import type { TerminalTab } from './terminal-tabs';

/** Plain SSH or local shell, connected; never containers, pods, RDP, SFTP, clusters or the welcome tab. */
export function broadcastEligible(tab: Pick<TerminalTab, 'connection' | 'status'>): boolean {
  const { protocol, view, target, kube } = tab.connection;
  return tab.status === 'connected' && !view && !target && !kube && (protocol === 'ssh' || protocol === 'powershell' || (protocol === 'cmd' || protocol === 'bash' || protocol === 'zsh' || protocol === 'fish'));
}

/** Terminal replies (DSR, DA, focus, mouse reports) must not be typed into the other members. */
export function broadcastable(data: string): boolean {
  return !/^\x1b\[(?:[?>]?[\d;]*[Rcn]|[IO]|M[\s\S]{3}|<[\d;]+[Mm])$/.test(data);
}

let members: readonly string[] = [];
export const broadcastGroup = {
  set(tabIds: readonly string[]): void { members = tabIds.length >= 2 ? [...tabIds] : []; },
  /** The other members when tabId is one, else []. */
  others(tabId: string): readonly string[] { return members.includes(tabId) ? members.filter(id => id !== tabId) : []; },
};
