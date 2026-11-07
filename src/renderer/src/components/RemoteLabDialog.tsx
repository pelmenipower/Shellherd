import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatDateTime } from '../../../shared/format';
import type { RemoteLabReply } from '../../../shared/remote-lab';
import { normalizeSyncServerUrl } from '../../../shared/sync-server-url.mjs';
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
  const [selected, setSelected] = useState<{ target: string; compared: boolean } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const normalized = normalizeSyncServerUrl(serverUrl, true);
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
  useEffect(() => { setSelected(null); }, [deviceKey]);
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
  const connect = (): Promise<void> => run(() => controller.act({ kind: 'connect', serverUrl: normalized ?? '' }));
  const signIn = (): Promise<void> => {
    const serverPassword = password; setPassword('');
    return run(() => controller.act({ kind: 'signIn', username, password: serverPassword }));
  };
  const goOnline = (): Promise<void> => run(() => controller.act({ kind: 'goOnline', deviceName: deviceName.trim() }));
  const goOffline = (): Promise<void> => run(() => controller.act({ kind: 'goOffline' }));
  const requestView = (target: string): Promise<void> => run(() => controller.act({ kind: 'request', target, compared: true }));

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
        aria-invalid={serverUrl.trim() !== '' && !normalized || undefined} onChange={event => { setServerUrl(event.target.value); controller.clearError(); }} />
      <button className="primary-button" type="submit" disabled={busy || !normalized}>{t('remoteLab:connect')}</button>
    </form>}
    {state.phase === 'serverReady' && <form className="remote-lab-form" onSubmit={event => { event.preventDefault(); void signIn(); }}>
      {state.server && <p className="remote-lab-caption">{state.server.serverUrl}</p>}
      <label htmlFor={`${id}-username`}>{t('remoteLab:username')}</label>
      <input id={`${id}-username`} value={username} maxLength={64} autoComplete="username" spellCheck={false} disabled={busy}
        onChange={event => { setUsername(event.target.value); controller.clearError(); }} />
      <label htmlFor={`${id}-password`}>{t('remoteLab:password')}</label>
      <input id={`${id}-password`} type="password" value={password} maxLength={1024} autoComplete="off" disabled={busy}
        onChange={event => { setPassword(event.target.value); controller.clearError(); }} />
      <button className="primary-button" type="submit" disabled={busy || !/^[a-zA-Z0-9_.-]{1,64}$/.test(username) || !password}>{t('remoteLab:signIn')}</button>
    </form>}
    {(state.phase === 'signedIn' || state.phase === 'online') && <section className="remote-lab-account">
      {state.account && <p role="status">{t('remoteLab:signedInAs', { username: state.account.username })}</p>}
      {state.phase === 'signedIn' && <form className="remote-lab-form" onSubmit={event => { event.preventDefault(); void goOnline(); }}>
        <label htmlFor={`${id}-device-name`}>{t('remoteLab:deviceName')}</label>
        <input id={`${id}-device-name`} value={deviceName} maxLength={80} autoComplete="off" spellCheck={false} disabled={busy}
          onChange={event => { setDeviceName(event.target.value); controller.clearError(); }} />
        <button className="primary-button" type="submit" disabled={busy || !nameValid}>{t('remoteLab:goOnline')}</button>
      </form>}
      {state.phase === 'online' && <>
        {state.account && <p role="status">{t('remoteLab:online', { name: deviceName.trim(), time: formatDateTime(state.account.validUntil, 'time') })}</p>}
        <h3>{t('remoteLab:fingerprintOwn')}</h3>
        <code className="remote-lab-fingerprint">{ownFingerprint}</code>
        {state.identity && !state.identity.persistent && <p className="remote-lab-warning">{t('remoteLab:identityTemporary')}</p>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void goOffline()}>{t('remoteLab:goOffline')}</button>
        {!viewerSession && <section className="remote-lab-devices" aria-labelledby={`${id}-devices`}>
          <h3 id={`${id}-devices`}>{t('remoteLab:devices')}</h3>
          {(state.devices ?? []).length === 0 ? <p className="remote-lab-caption">{t('remoteLab:noDevices')}</p> : <ul className="remote-lab-device-list">
            {(state.devices ?? []).map(device => {
              const compared = selected?.target === device.id && selected.compared;
              return <li key={device.id} className="remote-lab-device">
                <strong>{device.name}</strong>
                <code className="remote-lab-fingerprint">{grouped(device.id)}</code>
                <label className="remote-lab-check"><input type="checkbox" checked={compared} disabled={busy}
                  onChange={event => setSelected({ target: device.id, compared: event.target.checked })} /><span>{t('remoteLab:compared')}</span></label>
                <button type="button" className="primary-button" disabled={busy || !compared} onClick={() => void requestView(device.id)}>{t('remoteLab:requestView')}</button>
              </li>;
            })}
          </ul>}
        </section>}
      </>}
    </section>}
    {requesting && waiting && <p className="remote-lab-caption" role="status">{t('remoteLab:waiting')}</p>}
    {viewerSession && view.stream && <section className="remote-lab-viewer">
      <video ref={video} className="remote-lab-video" autoPlay muted playsInline />
      <p className="remote-lab-caption" role="status">{t('remoteLab:viewing', { name: viewerSession.peer.name, time: formatDateTime(viewerSession.expiresAt, 'time') })}</p>
      <button type="button" className="secondary-button" onClick={() => controller.stop()}>{t('remoteLab:stop')}</button>
    </section>}
    {viewerSession && !view.stream && <button type="button" className="secondary-button" onClick={() => controller.stop()}>{t('remoteLab:stop')}</button>}
  </dialog>;
}
