import { useEffect, useId, useRef, useState } from 'react';
import { normalizeDeviceName, DEVICE_NAME_MAX } from '../../../shared/device-name';
import { formatDateTime } from '../../../shared/format';
import type { VaultSessionResult } from '../../../shared/ipc';
import { formatRecoveryCode, normalizeRecoveryCode, RECOVERY_CODE_INPUT_MAX } from '../../../shared/recovery-code';
import type { SyncLabErrorCode, SyncLabReply, SyncLabRequest, SyncLabState } from '../../../shared/sync-lab';
import { needsPrivateNetwork, normalizeSyncServerUrl } from '../../../shared/sync-server-url.mjs';
import { useNativeSurfaceBlock } from '../native-surface';
import { useT } from '../i18n';
import { canRevoke, enrollReady, importReady, inviteReady, needsRecoveryCode, passwordTooShort, recoveryCodeValid } from '../sync-lab-view';
import '../sync-lab.css';

type SyncDevice = NonNullable<SyncLabState['devices']>[number];
type DropClient<R> = R extends unknown ? Omit<R, 'clientId'> : never;
type Draft = DropClient<SyncLabRequest>;
type OkHandler = (reply: Extract<SyncLabReply, { ok: true }>) => void;
type Translate = ReturnType<typeof useT>['t'];
type EnrolledVia = { enrolledVia?: 'password' | 'invite'; invitedBy?: string };

/** How a device joined, as one text; the three keys stay literal so the catalog check sees them. */
function enrolledHow(t: Translate, device: EnrolledVia): string {
  if (device.enrolledVia !== 'invite') return t('syncLab:deviceEnrolledByPassword');
  return device.invitedBy !== undefined ? t('syncLab:deviceEnrolledBy', { name: device.invitedBy }) : t('syncLab:deviceEnrolledByUnknown');
}

/** One-time recovery code; the parent owns the state and drops it on "noted" and on unmount. No copy button on purpose. */
export function RecoveryCodeNotice({ code, onNoted }: { code: string; onNoted: () => void }) {
  const { t } = useT();
  return <section className="sync-result" role="status" aria-label={t('syncLab:recoveryCodeTitle')}>
    <h3>{t('syncLab:recoveryCodeTitle')}</h3>
    <p className="sync-lab-notice">{t('syncLab:recoveryCodeNew')}</p>
    <code className="sync-lab-code">{formatRecoveryCode(code)}</code>
    <button type="button" className="primary-button" onClick={onNoted}>{t('syncLab:recoveryCodeNoted')}</button>
  </section>;
}

/** Warning plus explicit checkbox for a server ID that is already enrolled at another address (C1); only the checkbox unlocks enrollment. */
export function EnrolledElsewhere({ url, confirmed, busy, onChange }: { url: string; confirmed: boolean; busy: boolean; onChange: (confirmed: boolean) => void }) {
  const { t } = useT();
  return <>
    <p className="sync-lab-notice">{t('syncLab:enrolledElsewhere', { url })}</p>
    <label className="sync-lab-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => onChange(event.target.checked)} />{t('syncLab:enrolledElsewhereConfirm')}</label>
  </>;
}

/** One-time enrollment code for a new device; the parent owns the state and drops it on "done" and on unmount. No copy button on purpose. */
export function InviteCodeNotice({ code, onDone }: { code: string; onDone: () => void }) {
  const { t } = useT();
  return <section className="sync-result" role="status" aria-label={t('syncLab:inviteCodeTitle')}>
    <h3>{t('syncLab:inviteCodeTitle')}</h3>
    <p className="sync-lab-notice">{t('syncLab:inviteCodeNew')}</p>
    <code className="sync-lab-code">{formatRecoveryCode(code)}</code>
    <button type="button" className="primary-button" onClick={onDone}>{t('syncLab:inviteCodeDone')}</button>
  </section>;
}

/** Question before the sync key is renewed (C2). */
export function RotateConfirm({ busy, onYes, onCancel }: { busy: boolean; onYes: () => void; onCancel: () => void }) {
  const { t } = useT();
  return <div className="sync-lab-confirm" role="group" aria-label={t('syncLab:rotateKey')}>
    <p className="sync-lab-notice">{t('syncLab:rotateKeyConfirm')}</p>
    <button type="button" className="primary-button" disabled={busy} onClick={onYes}>{t('syncLab:rotateKeyYes')}</button>
    <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>{t('common:actions.cancel')}</button>
  </div>;
}

/** Roster notices: new devices and revived devices each need an acknowledgement (B8, E11). */
export function DeviceNotices({ newDevices, revived, busy, onAcknowledge }: { newDevices: NonNullable<SyncLabState['newDevices']>; revived: NonNullable<SyncLabState['revived']>; busy: boolean; onAcknowledge: (id: string) => void }) {
  const { t } = useT();
  return <>
    {newDevices.map(device => <div key={device.id} className="sync-lab-confirm" role="alert">
      <p className="sync-lab-notice">{t('syncLab:newDevice', { name: device.name, how: enrolledHow(t, device) })}</p>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => onAcknowledge(device.id)}>{t('syncLab:acknowledgeDevice')}</button>
    </div>)}
    {revived.map(device => <div key={device.id} className="sync-lab-confirm" role="alert">
      <p className="sync-lab-notice">{t('syncLab:deviceRevived', { name: device.name })}</p>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => onAcknowledge(device.id)}>{t('syncLab:acknowledgeDevice')}</button>
    </div>)}
  </>;
}

/** Removal of foreign objects with the opt-in for foreign encrypted versions (B8). */
export function RemoveForeign({ versions, busy, onVersions, onRemove }: { versions: boolean; busy: boolean; onVersions: (versions: boolean) => void; onRemove: () => void }) {
  const { t } = useT();
  return <>
    <p>{t('syncLab:removeForeignHint')}</p>
    <label className="sync-lab-check"><input type="checkbox" checked={versions} disabled={busy} onChange={event => onVersions(event.target.checked)} />{t('syncLab:removeForeignVersions')}</label>
    {versions && <p className="sync-lab-notice">{t('syncLab:removeForeignVersionsHint')}</p>}
    <button type="button" className="secondary-button" disabled={busy} onClick={onRemove}>{t('syncLab:removeForeign')}</button>
  </>;
}

/** Devices of the account in server order; the own and revoked devices have no remove button. */
export function SyncDeviceList({ devices, busy, onRevoke }: { devices: SyncDevice[]; busy: boolean; onRevoke: (id: string) => void }) {
  const { t } = useT();
  return <section className="sync-device-access" aria-label={t('syncLab:devicesTitle')}>
    <h3>{t('syncLab:devicesTitle')}</h3>
    <ul>{devices.map(device => <li key={device.id}>
      <strong>{device.name}</strong>{' '}
      {device.self && <span className="sync-lab-badge">{t('syncLab:deviceSelf')}</span>}{' '}
      {device.ephemeral && <span className="sync-lab-badge">{t('syncLab:deviceEphemeral')}</span>}{' '}
      {device.revokedAt !== null && <span className="sync-lab-badge">{t('syncLab:deviceRevoked')}</span>}{' '}
      <span className="sync-lab-caption">{formatDateTime(device.enrolledAt, 'short')}</span>{' '}
      <span className="sync-lab-caption">{enrolledHow(t, device)}</span>{' '}
      {canRevoke(device) && <button type="button" className="secondary-button" disabled={busy} onClick={() => onRevoke(device.id)}>{t('syncLab:revokeDevice')}</button>}
    </li>)}</ul>
    {devices.some(canRevoke) && <p className="settings-hint">{t('syncLab:revokeHint')}</p>}
  </section>;
}

/** Server connection, device enrollment and Vault sync use separate requests and state. */
export function SyncLabDialog({ onClose, vaultName, onVaultChanged }: { onClose: () => void; vaultName?: string; onVaultChanged: (result: VaultSessionResult) => void }) {
  const { t } = useT(); const id = useId(); const [clientId] = useState(() => crypto.randomUUID());
  const dialog = useRef<HTMLDialogElement>(null); const close = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false); const pending = useRef(false);
  const [busy, setBusy] = useState(false); const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [codeInput, setCodeInput] = useState(''); const [newPassword, setNewPassword] = useState(''); const [repeatPassword, setRepeatPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null); const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [enrollMode, setEnrollMode] = useState<'password' | 'invite' | null>(null); const [enrollCode, setEnrollCode] = useState('');
  const [state, setState] = useState<SyncLabState>({ phase: 'idle' });
  const [error, setError] = useState<SyncLabErrorCode | null>(null);
  const [privateChecked, setPrivateChecked] = useState(false);
  const [elsewhereConfirmed, setElsewhereConfirmed] = useState(false); const [confirmRotate, setConfirmRotate] = useState(false); const [removeVersions, setRemoveVersions] = useState(false);
  const privateCandidate = needsPrivateNetwork(serverUrl);
  const privateNetwork = privateCandidate && privateChecked;
  const normalized = normalizeSyncServerUrl(serverUrl, { loopback: true, private: privateNetwork });
  useNativeSurfaceBlock(true);
  useEffect(() => {
    mounted.current = true; dialog.current?.showModal(); close.current?.focus();
    return () => { mounted.current = false; void window.desktopApi.syncLabAction({ kind: 'close', clientId }).catch(() => {}); };
  }, [clientId]);
  /** Runs one request with the shared busy/error handling; the recovery code from a reply goes to local state only. */
  async function exec(draft: Draft, onOk?: OkHandler): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError(null);
    try {
      const reply = await window.desktopApi.syncLabAction({ ...draft, clientId } as SyncLabRequest);
      if (!mounted.current) return false;
      if (!reply.ok) { setError(reply.code); if (reply.state) setState(reply.state); return false; }
      setState(reply.state);
      if (reply.recoveryCode) setRecoveryCode(reply.recoveryCode);
      if (reply.inviteCode) setInviteCode(reply.inviteCode);
      onOk?.(reply);
      return true;
    } catch { if (mounted.current) setError('connection'); return false; }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function connect(): Promise<void> {
    if (pending.current || !normalized) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      await window.desktopApi.syncLabAction({ kind: 'close', clientId });
      if (!mounted.current) return;
      const discovery = await window.desktopApi.syncLabAction(privateNetwork ? { kind: 'connect', clientId, serverUrl: normalized, privateNetwork: true } : { kind: 'connect', clientId, serverUrl: normalized });
      if (!mounted.current) return;
      if (!discovery.ok) { setError(discovery.code); return; }
      if (discovery.state.server?.authentication !== 'enrolled-device') { setError('unavailable'); return; }
      setState(discovery.state);
      if (!deviceName && discovery.state.enrolled) setDeviceName(discovery.state.enrolled.name);
    } catch { if (mounted.current) setError('connection'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function enroll(): Promise<void> {
    const elsewhere = Boolean(state.enrolledElsewhere);
    if (!enrollReady(username, password, deviceName, !elsewhere || elsewhereConfirmed)) return;
    const serverPassword = password; setPassword('');
    const draft: Draft = { kind: 'signIn', username, password: serverPassword, deviceName: normalizeDeviceName(deviceName) };
    await exec(elsewhere ? { ...draft, confirmElsewhere: true } : draft);
  }
  async function enrollInvite(): Promise<void> {
    const elsewhere = Boolean(state.enrolledElsewhere);
    if (!inviteReady(enrollCode, deviceName, !elsewhere || elsewhereConfirmed)) return;
    const typed = enrollCode; setEnrollCode('');
    const draft: Draft = { kind: 'signInWithInvite', code: typed, deviceName: normalizeDeviceName(deviceName) };
    await exec(elsewhere ? { ...draft, confirmElsewhere: true } : draft);
  }
  async function disconnect(): Promise<void> {
    if (pending.current) return; pending.current = true; setBusy(true);
    try {
      await window.desktopApi.syncLabAction({ kind: 'close', clientId });
      if (mounted.current) { setState({ phase: 'idle' }); setError(null); setRecoveryCode(null); setInviteCode(null); setEnrollCode(''); setEnrollMode(null); setElsewhereConfirmed(false); setConfirmRotate(false); setRemoveVersions(false); }
    } catch { if (mounted.current) setError('connection'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function sync(kind: 'synchronize' | 'keepLocal' | 'importVault' | 'removeForeign'): Promise<void> {
    const heldInvite = state.inviteKey === true;
    if (kind === 'importVault' && !importReady(codeInput, newPassword, repeatPassword, heldInvite)) return;
    if (kind === 'keepLocal' && !state.sync?.conflictRevision) return;
    const typed = normalizeRecoveryCode(codeInput);
    if (kind === 'synchronize' && needsRecoveryCode(error) && typed === null) return;
    const localPassword = newPassword;
    const draft: Draft = kind === 'importVault' ? (heldInvite ? { kind, password: localPassword } : { kind, recoveryCode: typed ?? '', password: localPassword })
      : kind === 'keepLocal' ? { kind, reviewed: true, revision: state.sync!.conflictRevision! }
      : kind === 'synchronize' ? (typed !== null && needsRecoveryCode(error) ? { kind, recoveryCode: typed } : { kind })
      : kind === 'removeForeign' ? (removeVersions ? { kind, versions: true } : { kind })
      : { kind };
    if (kind === 'importVault' || (kind === 'synchronize' && typed !== null)) { setCodeInput(''); }
    if (kind === 'importVault') { setNewPassword(''); setRepeatPassword(''); }
    await exec(draft, reply => { if (reply.vaultChanged) onVaultChanged(reply.vaultChanged); });
    if (kind === 'removeForeign' && mounted.current) setRemoveVersions(false); // The destructive opt-in holds for one run only (m4).
  }
  const errorText = error && ({
    invite: t('syncLab:errors.invite'), enrollmentLocked: t('syncLab:errors.enrollmentLocked'), syncRotated: t('syncLab:errors.syncRotated'), syncRotateBlocked: t('syncLab:errors.syncRotateBlocked'),
    syncRotateRaced: t('syncLab:errors.syncRotateRaced'), syncRoster: t('syncLab:errors.syncRoster'), syncInviteKey: t('syncLab:errors.syncInviteKey'),
    unavailable: t('syncLab:errors.unavailable'), invalid: t('syncLab:errors.invalid'), stale: t('syncLab:errors.stale'),
    enrolledElsewhere: t('syncLab:errors.enrolledElsewhere'), syncForeignKey: t('syncLab:errors.syncForeignKey'), syncOtherServer: t('syncLab:errors.syncOtherServer'), syncPlatform: t('syncLab:errors.syncPlatform'),
    connection: t('syncLab:errors.connection'), authentication: t('syncLab:errors.authentication'),
    identity: t('syncLab:errors.identity'), limit: t('syncLab:errors.limit'),
    syncLocked: t('syncLab:errors.syncLocked'), syncChanged: t('syncLab:errors.syncChanged'), syncHistory: t('syncLab:errors.syncHistory'),
    syncWrongVault: t('syncLab:errors.syncWrongVault'), syncRecovery: t('syncLab:errors.syncRecovery'), syncLimit: t('syncLab:errors.syncLimit'),
    syncKey: t('syncLab:errors.syncKey'), syncRecoveryCode: t('syncLab:errors.syncRecoveryCode'), syncMigrate: t('syncLab:errors.syncMigrate'),
    samePasswordImport: t('syncLab:errors.samePasswordImport'), syncConflict: t('syncLab:errors.syncConflict'), syncBindings: t('syncLab:errors.syncBindings'), samePassword: t('syncLab:errors.samePassword'),
  } satisfies Record<SyncLabErrorCode, string>)[error];
  const signedIn = Boolean(state.account?.signedIn);
  const mode = enrollMode ?? (state.server?.enrollment === 'invite-only' ? 'invite' : 'password');
  const codeField = <>
    <label htmlFor={`${id}-code`}>{t('syncLab:recoveryCodeLabel')}</label>
    <input id={`${id}-code`} value={codeInput} maxLength={RECOVERY_CODE_INPUT_MAX} autoComplete="off" spellCheck={false} disabled={busy}
      aria-invalid={codeInput !== '' && !recoveryCodeValid(codeInput) || undefined} aria-describedby={`${id}-code-hint`}
      onChange={event => { setCodeInput(event.target.value); setError(current => needsRecoveryCode(current) ? current : null); }} />
    <p className="settings-hint" id={`${id}-code-hint`}>{t('syncLab:recoveryCodeHint')}</p>
  </>;
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
    {recoveryCode && <RecoveryCodeNotice code={recoveryCode} onNoted={() => setRecoveryCode(null)} />}
    {inviteCode && <InviteCodeNotice code={inviteCode} onDone={() => setInviteCode(null)} />}
    {!state.server && <form className="sync-server-form" onSubmit={event => { event.preventDefault(); void connect(); }}>
      <label htmlFor={`${id}-server-url`}>{t('syncLab:serverUrl')}</label>
      <input id={`${id}-server-url`} type="url" value={serverUrl} placeholder={t('syncLab:serverPlaceholder')} maxLength={2048}
        autoComplete="off" spellCheck={false} disabled={busy} aria-invalid={serverUrl.trim() !== '' && !normalized || undefined}
        aria-describedby={`${id}-server-hint`} onChange={event => { setServerUrl(event.target.value); setPrivateChecked(false); setError(null); }} />
      <p className="settings-hint" id={`${id}-server-hint`}>{t('syncLab:serverHint')}</p>
      {privateCandidate && <>
        <label className="sync-lab-check"><input type="checkbox" checked={privateChecked} disabled={busy} onChange={event => setPrivateChecked(event.target.checked)} />{t('syncLab:privateNetwork.label')}</label>
        <p className="sync-lab-notice">{t('syncLab:privateNetwork.hint')}</p>
      </>}
      <button className="primary-button" type="submit" disabled={busy || !normalized}>{busy ? t('syncLab:connecting') : t('syncLab:connect')}</button>
    </form>}
    {state.server && !signedIn && <section className="sync-server-form">
      <p className="sync-lab-caption">{state.server.serverUrl}</p>
      {state.identity?.persistent === false && <p className="sync-lab-notice">{t('syncLab:identityTemporary')}</p>}
      {state.enrolled ? <>
        <p>{t('syncLab:enrolledHint')}</p>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void exec({ kind: 'openSession' })}>{t('syncLab:openSession')}</button>
      </> : <>
      <div className="sync-lab-toggle" role="group" aria-label={t('syncLab:stepAuthorize')}>
        <button type="button" className="secondary-button" aria-pressed={mode === 'password'} disabled={busy} onClick={() => setEnrollMode('password')}>{t('syncLab:enrollWithPassword')}</button>
        <button type="button" className="secondary-button" aria-pressed={mode === 'invite'} disabled={busy} onClick={() => setEnrollMode('invite')}>{t('syncLab:enrollWithInvite')}</button>
      </div>
      {mode === 'invite' ? <form className="sync-server-form" onSubmit={event => { event.preventDefault(); void enrollInvite(); }}>
        {state.enrolledElsewhere && <EnrolledElsewhere url={state.enrolledElsewhere} confirmed={elsewhereConfirmed} busy={busy} onChange={setElsewhereConfirmed} />}
        <label htmlFor={`${id}-enroll-code`}>{t('syncLab:inviteCodeLabel')}</label>
        <input id={`${id}-enroll-code`} value={enrollCode} maxLength={RECOVERY_CODE_INPUT_MAX} autoComplete="off" spellCheck={false} disabled={busy}
          aria-invalid={enrollCode !== '' && !recoveryCodeValid(enrollCode) || undefined} aria-describedby={`${id}-enroll-code-hint`}
          onChange={event => { setEnrollCode(event.target.value); setError(null); }} />
        <p className="settings-hint" id={`${id}-enroll-code-hint`}>{t('syncLab:inviteCodeHint')}</p>
        <label htmlFor={`${id}-invite-device-name`}>{t('syncLab:deviceName')}</label>
        <input id={`${id}-invite-device-name`} value={deviceName} maxLength={DEVICE_NAME_MAX} autoComplete="off" spellCheck={false} disabled={busy}
          aria-describedby={`${id}-invite-device-name-hint`} onChange={event => { setDeviceName(event.target.value); setError(null); }} />
        <p className="settings-hint" id={`${id}-invite-device-name-hint`}>{t('syncLab:deviceNameHint')}</p>
        <button className="primary-button" type="submit" disabled={busy || !inviteReady(enrollCode, deviceName, !state.enrolledElsewhere || elsewhereConfirmed)}>{busy ? t('syncLab:enrolling') : t('syncLab:enrollInvite')}</button>
      </form> : <form className="sync-server-form" onSubmit={event => { event.preventDefault(); void enroll(); }}>
        {state.enrolledElsewhere && <EnrolledElsewhere url={state.enrolledElsewhere} confirmed={elsewhereConfirmed} busy={busy} onChange={setElsewhereConfirmed} />}
        <label htmlFor={`${id}-username`}>{t('syncLab:username')}</label>
        <input id={`${id}-username`} value={username} maxLength={64} autoComplete="username" spellCheck={false} disabled={busy}
          onChange={event => { setUsername(event.target.value); setError(null); }} />
        <label htmlFor={`${id}-password`}>{t('syncLab:serverPassword')}</label>
        <input id={`${id}-password`} type="password" value={password} maxLength={1024} autoComplete="off" disabled={busy}
          aria-describedby={`${id}-password-hint`} onChange={event => { setPassword(event.target.value); setError(null); }} />
        <p className="settings-hint" id={`${id}-password-hint`}>{t('syncLab:passwordHint')}</p>
        <label htmlFor={`${id}-device-name`}>{t('syncLab:deviceName')}</label>
        <input id={`${id}-device-name`} value={deviceName} maxLength={DEVICE_NAME_MAX} autoComplete="off" spellCheck={false} disabled={busy}
          aria-describedby={`${id}-device-name-hint`} onChange={event => { setDeviceName(event.target.value); setError(null); }} />
        <p className="settings-hint" id={`${id}-device-name-hint`}>{t('syncLab:deviceNameHint')}</p>
        <button className="primary-button" type="submit" disabled={busy || !enrollReady(username, password, deviceName, !state.enrolledElsewhere || elsewhereConfirmed)}>{busy ? t('syncLab:enrolling') : t('syncLab:enroll')}</button>
      </form>}
      </>}
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void disconnect()}>{t('syncLab:changeServer')}</button>
    </section>}
    {signedIn && state.server && state.account && <section className="sync-server-ready" role="status">
      <h3>{t('syncLab:readyTitle')}</h3>
      <dl><dt>{t('syncLab:serverUrl')}</dt><dd>{state.server.serverUrl}</dd></dl>
      <p>{t('syncLab:signedInDevice', { name: state.account.device.name, username: state.account.username })}</p>
      {!state.account.device.persistent && <p className="sync-lab-notice">{t('syncLab:identityTemporary')}</p>}
      <p>{t('syncLab:readyHint')}</p><p className="sync-lab-notice">{t('syncLab:manualNotice')}</p>
      {vaultName ? <section aria-label={t('syncLab:vaultSync')}>
        <p>{t('syncLab:activeVault', { name: vaultName })}</p>
        {error === 'syncKey' && <p className="sync-lab-notice">{t('syncLab:syncKeyNeeded')}</p>}
        {needsRecoveryCode(error) && <form className="sync-server-form" onSubmit={event => { event.preventDefault(); void sync('synchronize'); }}>
          {codeField}
          <button type="submit" className="primary-button" disabled={busy || !recoveryCodeValid(codeInput)}>{busy ? t('syncLab:syncing') : t('syncLab:syncNow')}</button>
        </form>}
        {!needsRecoveryCode(error) && <button type="button" className="primary-button" disabled={busy} onClick={() => void sync('synchronize')}>{busy ? t('syncLab:syncing') : t('syncLab:syncNow')}</button>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void exec({ kind: 'invite' })}>{t('syncLab:inviteDevice')}</button>
        <p className="settings-hint">{t('syncLab:inviteDeviceHint')}</p>
        {state.rotationAdvised && <p className="sync-lab-notice">{t('syncLab:rotationAdvised')}</p>}
        {confirmRotate
          ? <RotateConfirm busy={busy} onCancel={() => setConfirmRotate(false)} onYes={() => { setConfirmRotate(false); void exec({ kind: 'rotateKey', confirmed: true }); }} />
          : <button type="button" className={state.rotationAdvised ? 'primary-button' : 'secondary-button'} disabled={busy} onClick={() => setConfirmRotate(true)}>{t('syncLab:rotateKey')}</button>}
        <p className="settings-hint">{t('syncLab:rotateKeyHint')}</p>
      </section> : <form className="sync-server-form" onSubmit={event => { event.preventDefault(); void sync('importVault'); }}>
        {state.inviteKey ? <p className="sync-lab-notice">{t('syncLab:importWithInviteHint')}</p> : codeField}
        <label htmlFor={`${id}-new-password`}>{t('syncLab:newVaultPassword')}</label>
        <input id={`${id}-new-password`} type="password" value={newPassword} maxLength={1024} autoComplete="off" disabled={busy}
          onChange={event => { setNewPassword(event.target.value); setError(null); }} />
        <label htmlFor={`${id}-repeat-password`}>{t('syncLab:repeatPassword')}</label>
        <input id={`${id}-repeat-password`} type="password" value={repeatPassword} maxLength={1024} autoComplete="off" disabled={busy}
          aria-describedby={`${id}-vault-password-hint`} onChange={event => { setRepeatPassword(event.target.value); setError(null); }} />
        {passwordTooShort(newPassword) && <p className="field-error" role="alert">{t('app:errors.passwordTooShort')}</p>}
        <p className="settings-hint" id={`${id}-vault-password-hint`}>{t('syncLab:localVaultHint')}</p>
        <button type="submit" className="primary-button" disabled={busy || !importReady(codeInput, newPassword, repeatPassword, state.inviteKey === true)}>{busy ? t('syncLab:syncing') : t('syncLab:downloadVault')}</button>
      </form>}
      <DeviceNotices newDevices={state.newDevices ?? []} revived={state.revived ?? []} busy={busy} onAcknowledge={deviceId => void exec({ kind: 'acknowledgeDevice', id: deviceId })} />
      {state.sync && <section className="sync-result" role="status">
        <p>{state.sync.status === 'synced' ? t('syncLab:synced') : state.sync.status === 'bindings' ? t('syncLab:bindingsNeeded', { count: state.sync.conflicts }) : t('syncLab:conflictsKept', { count: state.sync.conflicts })}</p>
        {(state.sync.compacted ?? 0) > 0 && <p>{t('syncLab:compacted', { count: state.sync.compacted })}</p>}
        {(state.sync.skipped ?? 0) > 0 && <p>{t('syncLab:skipped', { count: state.sync.skipped })}</p>}
        {(state.sync.unknownAuthors ?? 0) > 0 && <p>{t('syncLab:unknownAuthors', { count: state.sync.unknownAuthors })}</p>}
        {(state.sync.quarantined ?? 0) > 0 && <p>{t('syncLab:quarantined', { count: state.sync.quarantined })}</p>}
        {(state.sync.skipped ?? 0) > 0 && <RemoveForeign versions={removeVersions} busy={busy} onVersions={setRemoveVersions} onRemove={() => void sync('removeForeign')} />}
        {state.sync.removedForeign !== undefined && state.sync.removedForeign >= 0 && <p>{t('syncLab:removedForeign', { count: state.sync.removedForeign })}</p>}
        {state.sync.approvals > 0 && <p>{t('syncLab:approvalsNeeded', { count: state.sync.approvals })}</p>}
        {state.sync.canKeepLocal && <><p>{t('syncLab:keepLocalHint')}</p><button type="button" className="secondary-button" disabled={busy} onClick={() => void sync('keepLocal')}>{t('syncLab:keepLocal')}</button></>}
      </section>}
      {(state.devices ?? []).length > 0 && <SyncDeviceList devices={state.devices ?? []} busy={busy} onRevoke={deviceId => void exec({ kind: 'revokeDevice', id: deviceId })} />}
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void disconnect()}>{t('syncLab:changeServer')}</button>
    </section>}
  </dialog>;
}
