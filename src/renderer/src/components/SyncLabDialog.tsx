import { useEffect, useId, useRef, useState } from 'react';
import type { VaultSessionResult } from '../../../shared/ipc';
import type { SyncLabReply, SyncLabState } from '../../../shared/sync-lab';
import { normalizeSyncServerUrl } from '../../../shared/sync-server-url.mjs';
import { useNativeSurfaceBlock } from '../native-surface';
import { useT } from '../i18n';
import '../sync-lab.css';

/** Server login and local-only Vault unlock use separate requests and state. */
export function SyncLabDialog({ onClose, vaultName, onVaultChanged }: { onClose: () => void; vaultName?: string; onVaultChanged: (result: VaultSessionResult) => void }) {
  const { t } = useT(); const id = useId(); const [clientId] = useState(() => crypto.randomUUID());
  const dialog = useRef<HTMLDialogElement>(null); const close = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false); const pending = useRef(false);
  const [busy, setBusy] = useState(false); const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [vaultPassword, setVaultPassword] = useState('');
  const [state, setState] = useState<SyncLabState>({ phase: 'idle' });
  const [error, setError] = useState<Extract<SyncLabReply, { ok: false }>['code'] | null>(null);
  const normalized = normalizeSyncServerUrl(serverUrl, true);
  useNativeSurfaceBlock(true);
  useEffect(() => {
    mounted.current = true; dialog.current?.showModal(); close.current?.focus();
    return () => { mounted.current = false; void window.desktopApi.syncLabAction({ kind: 'close', clientId }).catch(() => {}); };
  }, [clientId]);
  async function connect(): Promise<void> {
    if (pending.current || !normalized || !username || !password) return;
    const serverPassword = password; setPassword('');
    pending.current = true; setBusy(true); setError(null);
    try {
      await window.desktopApi.syncLabAction({ kind: 'close', clientId });
      if (!mounted.current) return;
      const discovery = await window.desktopApi.syncLabAction({ kind: 'connect', clientId, serverUrl: normalized });
      if (!mounted.current) return;
      if (!discovery.ok) { setError(discovery.code); return; }
      if (discovery.state.server?.authentication !== 'password') { setError('unavailable'); return; }
      const reply = await window.desktopApi.syncLabAction({ kind: 'signIn', clientId, username, password: serverPassword });
      if (!mounted.current) return;
      if (reply.ok) setState(reply.state);
      else setError(reply.code);
    } catch { if (mounted.current) setError('connection'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function disconnect(): Promise<void> {
    if (pending.current) return; pending.current = true; setBusy(true);
    try {
      await window.desktopApi.syncLabAction({ kind: 'close', clientId });
      if (mounted.current) { setState({ phase: 'idle' }); setError(null); }
    } catch { if (mounted.current) setError('failed'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function sync(kind: 'synchronize' | 'keepLocal' | 'importVault'): Promise<void> {
    if (pending.current || (kind === 'importVault' && !vaultPassword) || (kind === 'keepLocal' && !state.sync?.conflictRevision)) return;
    const localPassword = vaultPassword; setVaultPassword(''); pending.current = true; setBusy(true); setError(null);
    try {
      const request = kind === 'importVault' ? { kind, clientId, password: localPassword } as const : kind === 'keepLocal' ? { kind, clientId, reviewed: true, revision: state.sync!.conflictRevision! } as const : { kind, clientId } as const;
      const reply = await window.desktopApi.syncLabAction(request);
      if (!mounted.current) return;
      if (reply.ok) { setState(reply.state); if (reply.vaultChanged) onVaultChanged(reply.vaultChanged); }
      else setError(reply.code);
    } catch { if (mounted.current) setError('connection'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const errorText = error && ({
    unavailable: t('syncLab:errors.unavailable'), invalid: t('syncLab:errors.invalid'), stale: t('syncLab:errors.stale'),
    mismatch: t('syncLab:errors.mismatch'), expired: t('syncLab:errors.expired'), failed: t('syncLab:errors.failed'), connection: t('syncLab:errors.connection'), authentication: t('syncLab:errors.authentication'),
    syncLocked: t('syncLab:errors.syncLocked'), syncChanged: t('syncLab:errors.syncChanged'), syncHistory: t('syncLab:errors.syncHistory'),
    syncWrongVault: t('syncLab:errors.syncWrongVault'), syncRecovery: t('syncLab:errors.syncRecovery'), syncLimit: t('syncLab:errors.syncLimit'),
    syncConflict: t('syncLab:errors.syncConflict'), syncBindings: t('syncLab:errors.syncBindings'), samePassword: t('syncLab:errors.samePassword'),
  })[error];
  return <dialog ref={dialog} className="confirm-dialog sync-lab-dialog" aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-notice`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="sync-lab-heading"><div><span className="sync-lab-badge">{t('syncLab:badge')}</span><h2 id={`${id}-title`}>{t('syncLab:title')}</h2></div>
      <button ref={close} type="button" className="secondary-button" onClick={onClose}>{t('common:actions.close')}</button></header>
    <p id={`${id}-notice`} className="sync-lab-notice">{t('syncLab:notice')}</p>
    <div className="sync-server-route" aria-label={t('syncLab:routeLabel')}>
      <span>{t('syncLab:thisDevice')}</span><span aria-hidden="true">↔</span><strong>{t('syncLab:centralServer')}</strong><span aria-hidden="true">↔</span><span>{t('syncLab:otherDevices')}</span>
    </div>
    <ol className="sync-lab-steps" aria-label={t('syncLab:stepsLabel')}>
      <li aria-current={state.phase === 'idle' ? 'step' : undefined}>{t('syncLab:stepServer')}</li>
      <li aria-current={busy ? 'step' : undefined}>{t('syncLab:stepAuthorize')}</li><li aria-current={state.account?.signedIn ? 'step' : undefined}>{t('syncLab:stepSync')}</li>
    </ol>
    {errorText && <p className="field-error" role="alert">{errorText}</p>}
    {!state.account?.signedIn && <form className="sync-server-form" onSubmit={event => { event.preventDefault(); void connect(); }}>
      <label htmlFor={`${id}-server-url`}>{t('syncLab:serverUrl')}</label>
      <input id={`${id}-server-url`} type="url" value={serverUrl} placeholder={t('syncLab:serverPlaceholder')} maxLength={2048}
        autoComplete="off" spellCheck={false} disabled={busy} aria-invalid={serverUrl.trim() !== '' && !normalized || undefined}
        aria-describedby={`${id}-server-hint`} onChange={event => { setServerUrl(event.target.value); setError(null); }} />
      <p className="settings-hint" id={`${id}-server-hint`}>{t('syncLab:serverHint')}</p>
      <label htmlFor={`${id}-username`}>{t('syncLab:username')}</label>
      <input id={`${id}-username`} value={username} maxLength={64} autoComplete="username" spellCheck={false} disabled={busy}
        onChange={event => { setUsername(event.target.value); setError(null); }} />
      <label htmlFor={`${id}-password`}>{t('syncLab:serverPassword')}</label>
      <input id={`${id}-password`} type="password" value={password} maxLength={1024} autoComplete="off" disabled={busy}
        aria-describedby={`${id}-password-hint`} onChange={event => { setPassword(event.target.value); setError(null); }} />
      <p className="settings-hint" id={`${id}-password-hint`}>{t('syncLab:passwordHint')}</p>
      <button className="primary-button" type="submit" disabled={busy || !normalized || !/^[a-zA-Z0-9_.-]{1,64}$/.test(username) || !password}>{busy ? t('syncLab:connecting') : t('syncLab:connect')}</button>
    </form>}
    {state.account?.signedIn && state.server && <section className="sync-server-ready" role="status">
      <h3>{t('syncLab:readyTitle')}</h3>
      <dl><dt>{t('syncLab:serverUrl')}</dt><dd>{state.server.serverUrl}</dd><dt>{t('syncLab:username')}</dt><dd>{state.account.username}</dd></dl>
      <p>{t('syncLab:readyHint')}</p><p className="sync-lab-notice">{t('syncLab:manualNotice')}</p>
      {vaultName ? <section aria-label={t('syncLab:vaultSync')}>
        <p>{t('syncLab:activeVault', { name: vaultName })}</p>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void sync('synchronize')}>{busy ? t('syncLab:syncing') : t('syncLab:syncNow')}</button>
      </section> : <form className="sync-server-form" onSubmit={event => { event.preventDefault(); void sync('importVault'); }}>
        <label htmlFor={`${id}-vault-password`}>{t('syncLab:localVaultPassword')}</label>
        <input id={`${id}-vault-password`} type="password" value={vaultPassword} maxLength={1024} autoComplete="off" disabled={busy}
          aria-describedby={`${id}-vault-password-hint`} onChange={event => { setVaultPassword(event.target.value); setError(null); }} />
        <p className="settings-hint" id={`${id}-vault-password-hint`}>{t('syncLab:localVaultHint')}</p>
        <button type="submit" className="primary-button" disabled={busy || !vaultPassword}>{busy ? t('syncLab:syncing') : t('syncLab:downloadVault')}</button>
      </form>}
      {state.sync && <section className="sync-result" role="status">
        <p>{state.sync.status === 'synced' ? t('syncLab:synced') : state.sync.status === 'bindings' ? t('syncLab:bindingsNeeded', { count: state.sync.conflicts }) : t('syncLab:conflictsKept', { count: state.sync.conflicts })}</p>
        {(state.sync.skipped ?? 0) > 0 && <p>{t('syncLab:skipped', { count: state.sync.skipped })}</p>}
        {state.sync.approvals > 0 && <p>{t('syncLab:approvalsNeeded', { count: state.sync.approvals })}</p>}
        {state.sync.canKeepLocal && <><p>{t('syncLab:keepLocalHint')}</p><button type="button" className="secondary-button" disabled={busy} onClick={() => void sync('keepLocal')}>{t('syncLab:keepLocal')}</button></>}
      </section>}
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void disconnect()}>{t('syncLab:changeServer')}</button>
    </section>}
  </dialog>;
}
