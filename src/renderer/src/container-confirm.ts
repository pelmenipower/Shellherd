import { LOCAL_CONTAINER_HOST, type InventoryAction, type InventoryRow } from '../../shared/containers';

export interface ContainerConfirmation { title: string; body: string; requireTyping: string | null; confirmLabel: string }

/** 'diesem Computer' for LOCAL_CONTAINER_HOST, else hostName. */
export function hostLabel(hostId: string, hostName: string): string {
  return hostId === LOCAL_CONTAINER_HOST ? 'diesem Computer' : hostName;
}

/** Dialog text for an inventory action; null = run without dialog (start only). Removing always requires typing the name. */
export function confirmationFor(row: InventoryRow, action: InventoryAction, where: string): ContainerConfirmation | null {
  const name = row.name;
  switch (action) {
    case 'start': return null;
    case 'stop': return { title: 'Container stoppen?', body: `Container „${name}“ auf ${where} wird gestoppt.`, requireTyping: null, confirmLabel: 'Stoppen' };
    case 'restart': return { title: 'Container neu starten?', body: `Container „${name}“ auf ${where} wird neu gestartet.`, requireTyping: null, confirmLabel: 'Neu starten' };
    case 'remove':
      switch (row.ref.kind) {
        case 'images': return { title: 'Image entfernen?', body: `Image „${name}“ auf ${where} wird entfernt.`, requireTyping: name, confirmLabel: 'Entfernen' };
        case 'volumes': return { title: 'Volume entfernen?', body: `Volume „${name}“ auf ${where} wird gelöscht. Die Daten gehen verloren.`, requireTyping: name, confirmLabel: 'Entfernen' };
        default: return {
          title: 'Container entfernen?',
          body: `Container „${name}“ auf ${where} wird entfernt. Anonyme Volumes bleiben erhalten und erscheinen unter Volumes.`,
          requireTyping: name, confirmLabel: 'Entfernen',
        };
      }
  }
}
