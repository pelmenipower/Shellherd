import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vault } from '../../../shared/vault/types';
import type { VaultSessionResult } from '../../../shared/ipc';
import { notify } from '../notice-store';
import { t } from '../i18n';
import { persistVaultWith, type PersistDeps } from './usePersistVault';

afterEach(() => vi.restoreAllMocks());

const vaultOf = (name: string) => ({ id: name, nodes: [], workspaces: [] }) as unknown as Vault;

function setup(save: PersistDeps['save'], current: Vault | null = vaultOf('old')) {
  const calls: string[] = [];
  let live = current;
  const deps: PersistDeps = {
    vault: () => live,
    setVault: vault => { live = vault; calls.push(`vault:${vault.id}`); },
    setVaultPath: path => calls.push(`path:${path}`),
    setBusy: busy => calls.push(`busy:${busy}`),
    setSaved: saved => calls.push(`saved:${saved}`),
    save,
  };
  return { deps, calls, setLive: (vault: Vault) => { live = vault; } };
}

describe('persistVaultWith', () => {
  it('saves optimistically and applies the result', async () => {
    const result = { vault: vaultOf('saved'), filePath: 'a.vault' } as unknown as VaultSessionResult;
    const { deps, calls } = setup(async () => result);
    expect(await persistVaultWith(deps, { current: false }, vaultOf('new'))).toBe(true);
    expect(calls).toEqual(['saved:false', 'busy:true', 'vault:new', 'vault:saved', 'path:a.vault', 'saved:true', 'busy:false']);
  });

  it('rolls back and offers a retry on failure', async () => {
    const error = vi.spyOn(notify, 'error').mockImplementation(() => undefined as never);
    const { deps, calls } = setup(async () => { throw new Error('x'); });
    const inProgress = { current: false };
    expect(await persistVaultWith(deps, inProgress, vaultOf('new'))).toBe(false);
    expect(calls).toEqual(['saved:false', 'busy:true', 'vault:new', 'vault:old', 'busy:false']);
    expect(inProgress.current).toBe(false);
    expect(error).toHaveBeenCalledWith(t('app:notices.vaultNotSaved'), expect.objectContaining({ action: expect.objectContaining({ label: t('common:actions.retry') }) }));
  });

  it('does not retry on a changed vault', async () => {
    const error = vi.spyOn(notify, 'error').mockImplementation(() => undefined as never);
    const info = vi.spyOn(notify, 'info').mockImplementation(() => undefined as never);
    const save = vi.fn(async () => { throw new Error('x'); });
    const { deps, setLive } = setup(save);
    await persistVaultWith(deps, { current: false }, vaultOf('new'));
    setLive(vaultOf('other'));
    const action = (error.mock.calls[0][1] as { action: { run: () => void } }).action;
    action.run();
    expect(info).toHaveBeenCalledWith(t('app:notices.notRetried'), { body: t('app:notices.retryChanged') });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('returns false while a save is in progress or without a vault', async () => {
    const save = vi.fn();
    expect(await persistVaultWith(setup(save).deps, { current: true }, vaultOf('new'))).toBe(false);
    expect(await persistVaultWith(setup(save, null).deps, { current: false }, vaultOf('new'))).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});
