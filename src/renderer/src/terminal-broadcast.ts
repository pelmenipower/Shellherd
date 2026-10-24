import type { TerminalTab } from './terminal-tabs';

/** Plain SSH or local shell, connected; never containers, pods, RDP, SFTP, clusters or the welcome tab. */
export function broadcastEligible(tab: Pick<TerminalTab, 'connection' | 'status'>): boolean {
  const { protocol, view, target, kube } = tab.connection;
  return tab.status === 'connected' && !view && !target && !kube && (protocol === 'ssh' || protocol === 'powershell' || protocol === 'cmd');
}

let members: readonly string[] = [];
export const broadcastGroup = {
  set(tabIds: readonly string[]): void { members = tabIds.length >= 2 ? [...tabIds] : []; },
  /** The other members when tabId is one, else []. */
  others(tabId: string): readonly string[] { return members.includes(tabId) ? members.filter(id => id !== tabId) : []; },
};
