import { LOCAL_CONTAINER_HOST, type InventoryAction, type InventoryRow } from '../../shared/containers';
import { t } from './i18n';

export interface ContainerConfirmation { title: string; body: string; requireTyping: string | null; confirmLabel: string }

/** 'diesem Computer' / 'this computer' for LOCAL_CONTAINER_HOST, else hostName. */
export function hostLabel(hostId: string, hostName: string): string {
  return hostId === LOCAL_CONTAINER_HOST ? t('containers:confirm.thisComputer') : hostName;
}

/** Dialog text for an inventory action; null = run without dialog (start only). Removing always requires typing the name. */
export function confirmationFor(row: InventoryRow, action: InventoryAction, where: string): ContainerConfirmation | null {
  const name = row.name;
  switch (action) {
    case 'start': return null;
    case 'stop': return {
      title: t('containers:confirm.stop.title'), body: t('containers:confirm.stop.body', { name, where }),
      requireTyping: null, confirmLabel: t('containers:confirm.stop.confirm'),
    };
    case 'restart': return {
      title: t('containers:confirm.restart.title'), body: t('containers:confirm.restart.body', { name, where }),
      requireTyping: null, confirmLabel: t('containers:confirm.restart.confirm'),
    };
    case 'remove': {
      const confirmLabel = t('common:actions.remove');
      switch (row.ref.kind) {
        case 'images': return { title: t('containers:confirm.removeImage.title'), body: t('containers:confirm.removeImage.body', { name, where }), requireTyping: name, confirmLabel };
        case 'volumes': return { title: t('containers:confirm.removeVolume.title'), body: t('containers:confirm.removeVolume.body', { name, where }), requireTyping: name, confirmLabel };
        default: return { title: t('containers:confirm.removeContainer.title'), body: t('containers:confirm.removeContainer.body', { name, where }), requireTyping: name, confirmLabel };
      }
    }
  }
}
