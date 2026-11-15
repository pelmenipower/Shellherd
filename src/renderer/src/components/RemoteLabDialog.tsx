import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatDateTime } from '../../../shared/format';
import type { RemoteLabReply } from '../../../shared/remote-lab';
import { needsPrivateNetwork, normalizeSyncServerUrl } from '../../../shared/sync-server-url.mjs';
import { normalizeVerification } from '../../../shared/remote-signal';
import { endKey, errorKey, groupFingerprint } from '../remote-lab';
import type { RemoteSessionController, RemoteView } from '../remote-peer';
import { useNativeSurfaceBlock } from '../native-surface';
import { useT } from '../i18n';
import '../remote-lab.css';

const WAITING_DELAY_MS = 400;

function grouped(fingerprint: string): string {
  try { return groupFingerprint(fingerprint); } catch { return fingerprint; }
}

/** Development dialog: server sign-in, going online, and requesting a view of another device. */
export function RemoteLabDialog({ controller, onClose }: { controller: RemoteSessionController; onClose: () => void }) {
  const { t } = useT(); const id = useId();
  const dialog = useRef<HTMLDialogElement>(null); const closeButton = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const mounted = useRef(false); const pending = useRef(false);
  const [view, setView] = useState<RemoteView>(controller.view);
  const [busy, setBusy] = useState(false);
  const [serverUrl, setServerUrl] = useState(''); const [username, setUsername] = useState('');
  const [password, setPassword] = useState(''); const [deviceName, setDeviceName] = useState(controller.deviceName ?? '');
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState(false);
  const [privateChecked, setPrivateChecked] = useState(false);
  const privateCandidate = needsPrivateNetwork(serverUrl);
  const privateNetwork = privateCandidate && privateChecked;
  const normalized = normalizeSyncServerUrl(serverUrl, { loopback: true, private: privateNetwork });
  const { state } = view;
  const session = state.session;
  const viewerSession = session?.role === 'viewer' ? session : undefined;
  const requesting = viewerSession?.state === 'requesting';
  const deviceKey = useMemo(() => (state.devices ?? []).map(device => device.id).join(','), [state.devices]);
  useNativeSurfaceBlock(true);
  useEffect(() => {
    mounted.current = true; dialog.current?.showModal(); closeButton.current?.focus();
    const unsubscribe = controller.subscribe(next => { if (mounted.current) setView(next); });
    return () => {
      mounted.current = false; unsubscribe();
      // A viewer session ends with the dialog; the agent side stays online (no close).
      if (controller.view.state.session?.role === 'viewer') controller.stop();
    };
  }, [controller]);
  useEffect(() => { setTyped({}); }, [deviceKey]);
  useEffect(() => {
    if (!requesting) { setWaiting(false); return; }
    const handle = setTimeout(() => setWaiting(true), WAITING_DELAY_MS);
    return () => clearTimeout(handle);
  }, [requesting]);
  useEffect(() => { if (video.current) video.current.srcObject = view.stream ?? null; }, [view.stream]);

  async function run(action: () => Promise<RemoteLabReply>): Promise<void> {
    if (pending.current) return;
    pending.current = true; setBusy(true); controller.clearError();
    try { await action(); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const connect = (): Promise<void> => run(() => controller.act(privateNetwork ? { kind: 'connect', serverUrl: normalized ?? '', privateNetwork: true } : { kind: 'connect', serverUrl: normalized ?? '' }));
  const signIn = (): Promise<void> => {
    const serverPassword = password; setPassword('');
    return run(() => controller.act({ kind: 'signIn', username, password: serverPassword, deviceName: deviceName.trim() }));
  };
  const openSession = (): Promise<void> => run(() => controller.act({ kind: 'openSession' }));
  // An empty name makes the host fall back to the enrollment name.
  const goOnline = (): Promise<void> => run(() => controller.act({ kind: 'goOnline', deviceName: (state.account?.deviceName ?? deviceName).trim() }));
  const goOffline = (): Promise<void> => run(() => controller.act({ kind: 'goOffline' }));
  const requestView = (target: string, verification: string | null): Promise<void> => run(async () => {
    const reply = await controller.act({ kind: 'request', target, verification });
    if (!reply.ok && reply.code === 'mismatch') setTyped(current => ({ ...current, [target]: '' }));
    return reply;
  });

  const nameValid = /^[^\x00-\x1f\x7f]{1,80}$/.test(deviceName.trim());
  const ownFingerprint = state.identity ? grouped(state.identity.fingerprint) : '';
  return <dialog ref={dialog} className="confirm-dialog remote-lab-dialog" aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-notice`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="remote-lab-heading"><div><span className="remote-lab-badge">{t('remoteLab:badge')}</span><h2 id={`${id}-title`}>{t('remoteLab:title')}</h2></div>
      <button ref={closeButton} type="button" className="secondary-button" onClick={onClose}>{t('common:actions.close')}</button></header>
    <p id={`${id}-notice`} className="remote-lab-notice">{t('remoteLab:notice')}</p>
    {view.error && <p className="field-error" role="alert">{t(errorKey(view.error))}</p>}
    {view.ended && !session && <p className="remote-lab-ended" role="status">{t(endKey(view.ended))}</p>}
    {state.phase === 'idle' && <form className="remote-lab-form" onSubmit={event => { event.preventDefault(); void connect(); }}>
      <label htmlFor={`${id}-server-url`}>{t('remoteLab:serverUrl')}</label>
      <input id={`${id}-server-url`} type="url" value={serverUrl} maxLength={2048} autoComplete="off" spellCheck={false} disabled={busy}
        aria-invalid={serverUrl.trim() !== '' && !normalized || undefined} onChange={event => { setServerUrl(event.target.value); setPrivateChecked(false); controller.clearError(); }} />
      {privateCandidate && <>
        <label className="remote-lab-check"><input type="checkbox" checked={privateChecked} disabled={busy} onChange={event => setPrivateChecked(event.target.checked)} />{t('remoteLab:privateNetwork.label')}</label>
        <p className="remote-lab-warning">{t('remoteLab:privateNetwork.hint')}</p>
      </>}
      <button className="primary-button" type="submit" disabled={busy || !normalized}>{t('remoteLab:connect')}</button>
    </form>}
    {state.phase === 'serverReady' && <section className="remote-lab-form">
      {state.server && <p className="remote-lab-caption">{state.server.serverUrl}</p>}
      {state.identity && !state.identity.persistent && <p className="remote-lab-warning">{t('remoteLab:identityTemporary')}</p>}
      {state.enrolled ? <>
        <p>{t('remoteLab:enrolledHint')}</p>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void openSession()}>{t('remoteLab:openSession')}</button>
      </> : <form className="remote-lab-form" onSubmit={event => { event.preventDefault(); void signIn(); }}>
        {state.enrolledElsewhere && <p className="remote-lab-warning">{t('remoteLab:enrolledElsewhere', { url: state.enrolledElsewhere })}</p>}
        <label htmlFor={`${id}-username`}>{t('remoteLab:username')}</label>
        <input id={`${id}-username`} value={username} maxLength={64} autoComplete="username" spellCheck={false} disabled={busy}
          onChange={event => { setUsername(event.target.value); controller.clearError(); }} />
        <label htmlFor={`${id}-password`}>{t('remoteLab:password')}</label>
        <input id={`${id}-password`} type="password" value={password} maxLength={1024} autoComplete="off" disabled={busy}
          onChange={event => { setPassword(event.target.value); controller.clearError(); }} />
        <label htmlFor={`${id}-device-name`}>{t('remoteLab:deviceName')}</label>
        <input id={`${id}-device-name`} value={deviceName} maxLength={80} autoComplete="off" spellCheck={false} disabled={busy}
          onChange={event => { setDeviceName(event.target.value); controller.clearError(); }} />
        <button className="primary-button" type="submit" disabled={busy || !/^[a-zA-Z0-9_.-]{1,64}$/.test(username) || !password || !nameValid}>{t('remoteLab:signIn')}</button>
      </form>}
    </section>}
    {(state.phase === 'signedIn' || state.phase === 'online') && <section className="remote-lab-account">
      {state.account && <p role="status">{t('remoteLab:signedInAs', { username: state.account.username })}</p>}
      {state.phase === 'signedIn' && <button type="button" className="primary-button" disabled={busy} onClick={() => void goOnline()}>{t('remoteLab:goOnline')}</button>}
      {state.phase === 'online' && <>
        {state.account && <p role="status">{t('remoteLab:online', { name: (state.account.deviceName || deviceName).trim(), time: formatDateTime(state.account.validUntil, 'time') })}</p>}
        <h3>{t('remoteLab:fingerprintOwn')}</h3>
        <code className="remote-lab-fingerprint">{ownFingerprint}</code>
        {state.identity && !state.identity.persistent && <p className="remote-lab-warning">{t('remoteLab:identityTemporary')}</p>}
        {state.muted ? <p className="remote-lab-caption">{t('remoteLab:muted', { count: state.muted })}</p> : null}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void goOffline()}>{t('remoteLab:goOffline')}</button>
        {!viewerSession && <section className="remote-lab-devices" aria-labelledby={`${id}-devices`}>
          <h3 id={`${id}-devices`}>{t('remoteLab:devices')}</h3>
          {(state.devices ?? []).length === 0 ? <p className="remote-lab-caption">{t('remoteLab:noDevices')}</p> : <ul className="remote-lab-device-list">
            {(state.devices ?? []).map((device, index) => {
              const verified = device.known?.verified === true;
              const verification = verified ? null : normalizeVerification(typed[device.id] ?? '');
              return <li key={device.id} className="remote-lab-device">
                <strong>{device.name}</strong>
                {device.changed && <p className="remote-lab-warning">{t('remoteLab:verify.changed', { name: device.name })}</p>}
                {verified ? <>
                  <p className="remote-lab-caption">{t('remoteLab:verify.verified', { date: formatDateTime(device.known?.verifiedAt ?? device.known?.firstSeen ?? 0, 'short') })}</p>
                  <code className="remote-lab-fingerprint">{grouped(device.id)}</code>
                </> : <>
                  <label htmlFor={`${id}-verify-${index}`}>{t('remoteLab:verify.label')}</label>
                  <input id={`${id}-verify-${index}`} className="remote-lab-verify" maxLength={23} autoComplete="off" spellCheck={false} inputMode="text"
                    value={typed[device.id] ?? ''} disabled={busy} onChange={event => setTyped(current => ({ ...current, [device.id]: event.target.value }))} />
                  <p className="remote-lab-caption">{t('remoteLab:verify.hint')}</p>
                </>}
                <button type="button" className="primary-button" disabled={busy || (!verified && verification === null)} onClick={() => void requestView(device.id, verification)}>{t('remoteLab:requestView')}</button>
              </li>;
            })}
          </ul>}
        </section>}
      </>}
    </section>}
    {viewerSession?.state === 'connecting' && !view.stream && <p className="remote-lab-caption" role="status">{t('remoteLab:connecting')}</p>}
    {requesting && waiting && <p className="remote-lab-caption" role="status">{t('remoteLab:waiting')}</p>}
    {viewerSession && view.stream && <section className="remote-lab-viewer">
      <video ref={video} className="remote-lab-video" autoPlay muted playsInline />
      <p className="remote-lab-caption" role="status">{t('remoteLab:viewing', { name: viewerSession.peer.name, time: formatDateTime(viewerSession.expiresAt, 'time') })}</p>
      <button type="button" className="secondary-button" onClick={() => controller.stop()}>{t('remoteLab:stop')}</button>
    </section>}
    {viewerSession && !view.stream && <button type="button" className="secondary-button" onClick={() => controller.stop()}>{t('remoteLab:stop')}</button>}
  </dialog>;
}
