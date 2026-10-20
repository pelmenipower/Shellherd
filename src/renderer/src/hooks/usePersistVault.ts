import { useCallback, useRef } from 'react';
import type { Vault } from '../../../shared/vault/types';
import type { VaultSessionResult } from '../../../shared/ipc';
import { errorText } from '../error-text';
import { t } from '../i18n';
import { notify } from '../notice-store';

export interface PersistDeps {
  vault: () => Vault | null;
  setVault: (vault: Vault) => void;
  setVaultPath: (path: string) => void;
  setBusy: (busy: boolean) => void;
  setSaved: (saved: boolean) => void;
  save: (vault: Vault) => Promise<VaultSessionResult>;
}

/** Optimistic save with rollback; a failed save offers a retry that only runs on the unchanged vault. */
export async function persistVaultWith(deps: PersistDeps, inProgress: { current: boolean }, updatedVault: Vault, failureTitle?: string): Promise<boolean> {
  const previousVault = deps.vault();
  if (!previousVault || inProgress.current) return false;
  inProgress.current = true;
  deps.setSaved(false);
  deps.setBusy(true);
  deps.setVault(updatedVault);
  try {
    const result = await deps.save(updatedVault);
    deps.setVault(result.vault);
    deps.setVaultPath(result.filePath);
    deps.setSaved(true);
    return true;
  } catch (caughtError) {
    deps.setVault(previousVault);
    notify.error(failureTitle ?? t('app:notices.vaultNotSaved'), {
      body: errorText(caughtError, t('app:errors.vaultFailed')),
      action: {
        label: t('common:actions.retry'),
        // Only retry on the state the failed save started from; a newer save must not be overwritten.
        run: () => {
          if (inProgress.current) notify.info(t('app:notices.notRetried'), { body: t('app:notices.retryBusy') });
          else if (deps.vault() === previousVault) void persistVaultWith(deps, inProgress, updatedVault, failureTitle);
          else notify.info(t('app:notices.notRetried'), { body: t('app:notices.retryChanged') });
        },
      },
    });
    return false;
  } finally {
    inProgress.current = false;
    deps.setBusy(false);
  }
}

export function usePersistVault(vault: Vault | null, setters: Pick<PersistDeps, 'setVault' | 'setVaultPath' | 'setBusy' | 'setSaved'>):
  (updatedVault: Vault, failureTitle?: string) => Promise<boolean> {
  const vaultRef = useRef(vault);
  vaultRef.current = vault;
  const inProgress = useRef(false);
  const { setVault, setVaultPath, setBusy, setSaved } = setters;
  return useCallback((updatedVault, failureTitle) => persistVaultWith(
    { vault: () => vaultRef.current, setVault, setVaultPath, setBusy, setSaved, save: next => window.desktopApi.saveCurrentVault({ vault: next }) },
    inProgress, updatedVault, failureTitle), [setVault, setVaultPath, setBusy, setSaved]);
}
