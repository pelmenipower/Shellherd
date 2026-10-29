import { useEffect, useRef, useState } from 'react';
import { commonRemotePrefix, remoteScriptToken, replaceRemoteScript, type RemotePathEntry, type RemotePathReply } from '../../../shared/remote-path';
import { useT } from '../i18n';

export function RemoteCommandInput({ sessionId, label, value, onChange }: { sessionId?: string; label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useT();
  const [browser, setBrowser] = useState(false);
  const [directory, setDirectory] = useState('~');
  const [entries, setEntries] = useState<RemotePathEntry[]>([]);
  const [suggestions, setSuggestions] = useState<RemotePathEntry[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  useEffect(() => { setEntries([]); setSuggestions([]); setBrowser(false); }, [sessionId]);
  useEffect(() => { revision.current++; setMessage(''); setBusy(false); }, [sessionId, value]);
  useEffect(() => () => { revision.current++; }, []);
  const request = async (action: 'list' | 'complete' | 'validate', path: string): Promise<RemotePathReply | undefined> => {
    if (!sessionId) return;
    const current = ++revision.current;
    setBusy(true); setMessage('');
    try {
      const result = await window.desktopApi.sshRemotePath({ sessionId, action, path });
      if (current !== revision.current) return;
      if (result.error) {
        const errors = { 'not-found': t('toolbar:pathMissing'), denied: t('toolbar:pathDenied'), unavailable: t('toolbar:pathUnavailable'), timeout: t('toolbar:pathTimeout'), failed: t('toolbar:pathFailed'), busy: t('toolbar:pathBusy') };
        setMessage(errors[result.error]); return;
      }
      if (result.truncated) setMessage(t('toolbar:pathTruncated'));
      return result;
    } catch { if (current === revision.current) setMessage(t('toolbar:pathUnavailable')); }
    finally { if (current === revision.current) setBusy(false); }
  };
  const browse = async (path: string): Promise<void> => {
    setBrowser(true);
    const result = await request('list', path);
    if (result) { setDirectory(result.path); setEntries(result.entries ?? []); }
  };
  const complete = async (): Promise<void> => {
    const token = remoteScriptToken(value);
    if (!token) { setMessage(t('toolbar:pathHint')); return; }
    const result = await request('complete', token.path);
    if (!result) return;
    const matches = result.entries ?? [];
    if (!matches.length) { setMessage(t('toolbar:pathMissing')); return; }
    const paths = matches.map(entry => entry.path + (entry.directory ? '/' : ''));
    const prefix = commonRemotePrefix(paths);
    if (matches.length === 1 || (!result.truncated && prefix.length > result.path.length)) onChange(replaceRemoteScript(value, prefix));
    setSuggestions(matches.length > 1 ? matches : []);
  };
  const validate = async (): Promise<void> => {
    const token = remoteScriptToken(value);
    if (!token?.closed) { setMessage(t('toolbar:pathHint')); return; }
    const result = await request('validate', token.path);
    if (result) setMessage(result.directory ? t('toolbar:pathDirectory') : result.executable ? t('toolbar:pathExistsExecutable') : t('toolbar:pathExists'));
  };
  return <div className="remote-command-input">
    <label>{label}<input required maxLength={4000} spellCheck={false} value={value} onChange={event => { setSuggestions([]); onChange(event.target.value); }} onKeyDown={event => {
      if (event.key === 'Tab' && !event.shiftKey && sessionId && remoteScriptToken(value) && event.currentTarget.selectionStart === remoteScriptToken(value)?.end && event.currentTarget.selectionEnd === remoteScriptToken(value)?.end) { event.preventDefault(); if (!busy) void complete(); }
      if (event.key === 'Escape') { setSuggestions([]); setBrowser(false); event.stopPropagation(); }
    }} /></label>
    <div className="remote-path-actions"><button type="button" className="secondary-button" disabled={!sessionId || busy} onClick={() => { if (browser) setBrowser(false); else void browse('~'); }}>{t('toolbar:chooseRemoteFile')}</button><button type="button" className="secondary-button" disabled={!sessionId || busy} onClick={() => void validate()}>{t('toolbar:checkPath')}</button></div>
    <small>{sessionId ? t('toolbar:pathHint') : t('toolbar:pathUnavailable')}</small>
    {message && <p role="status">{message}</p>}
    {!!suggestions.length && <div className="remote-path-list">{suggestions.map(entry => <button type="button" className="secondary-button" key={entry.path} onClick={() => { onChange(replaceRemoteScript(value, entry.path + (entry.directory ? '/' : ''))); setSuggestions([]); }}>{entry.directory ? '▸ ' : ''}{entry.name}</button>)}</div>}
    {browser && <section className="remote-path-browser" aria-label={t('toolbar:chooseRemoteFile')}>
      <label>{t('toolbar:remoteDirectory')}<input value={directory} onChange={event => setDirectory(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void browse(directory); } }} /></label>
      <div className="remote-path-actions"><button type="button" className="secondary-button" disabled={busy || !sessionId} onClick={() => void browse(directory)}>{t('toolbar:openDirectory')}</button><button type="button" className="secondary-button" disabled={busy || !sessionId} onClick={() => void browse(directory + '/..')}>{t('toolbar:parentDirectory')}</button><button type="button" className="secondary-button" disabled={busy || !sessionId} onClick={() => void browse('~')}>{t('toolbar:homeDirectory')}</button></div>
      <div className="remote-path-list">{entries.map(entry => <button type="button" className="secondary-button" key={entry.path} disabled={busy || !sessionId} title={entry.path} onClick={() => { if (entry.directory) void browse(entry.path); else { onChange(replaceRemoteScript(value, entry.path)); setBrowser(false); } }}>{entry.directory ? '▸ ' : ''}{entry.name}</button>)}</div>
    </section>}
  </div>;
}
