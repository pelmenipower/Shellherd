import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AdoptedSession, TerminalConnection } from '../terminal-tabs';
import type { SshStatus } from '../../../shared/ssh';
import type { ConflictChoice, EditedFile, FileEntry, SftpStatus, TransferConflict, TransferJob } from '../../../shared/sftp';
import type { FileSide } from '../file-browser';
import { formatDate, formatSize, ipcErrorText, isFinished, jobPercent, joinPath } from '../file-browser';
import { liveSessions } from '../session-registry';
import { useNativeSurfaceBlock } from '../native-surface';
import { ConfirmDialog } from './ConfirmDialog';
import { PermissionsDialog } from './PermissionsDialog';
import { FilePane } from './FilePane';
import type { FileListing } from './FilePane';
import '../files-ui.css';

interface FilesPanelProps {
  connection: TerminalConnection;
  tabId: string;
  visible: boolean;
  focused?: boolean;
  style?: CSSProperties;
  onFocus?: () => void;
  onStatusChange: (id: string, status: SshStatus) => void;
  /** Session moved here from another window; no new connection is opened. */
  adopt?: AdoptedSession;
  initialStatus?: SshStatus;
}

/** Folders of both sides; travels with the tab to another window. */
interface FilesSnapshot { local?: string; remote?: string }

const emptyListing: FileListing = { path: null, entries: [], loading: false, error: null };
const stateLabels: Record<TransferJob['state'], string> = { queued: 'Wartet', running: 'Läuft', done: 'Fertig', error: 'Fehler', canceled: 'Abgebrochen' };

function readSnapshot(adopt?: AdoptedSession): FilesSnapshot {
  try { return adopt?.snapshot ? JSON.parse(adopt.snapshot) as FilesSnapshot : {}; } catch { return {}; }
}

/** WinSCP-style commander: this computer on the left, the server on the right, transfers below. */
export function FilesPanel({ connection, tabId, visible, focused = true, style, onFocus, onStatusChange, adopt, initialStatus }: FilesPanelProps) {
  const [status, setStatus] = useState<SftpStatus>(initialStatus ?? 'connecting');
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [listings, setListings] = useState<Record<FileSide, FileListing>>({ local: emptyListing, remote: emptyListing });
  const [homes, setHomes] = useState<Record<FileSide, string | null>>({ local: null, remote: null });
  const [drives, setDrives] = useState<string[]>([]);
  const [activeSide, setActiveSide] = useState<FileSide>('remote');
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const [edits, setEdits] = useState<EditedFile[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<{ paths: string[]; entries: FileEntry[] } | null>(null);
  const [conflict, setConflict] = useState<TransferConflict | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ side: FileSide; paths: string[]; names: string[] } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const adoptRef = useRef(adopt);
  const paths = useRef<FilesSnapshot>(readSnapshot(adopt));
  const requests = useRef<Record<FileSide, number>>({ local: 0, remote: 0 });
  const sessionRef = useRef<string | null>(null);

  const load = useCallback(async (side: FileSide, path: string): Promise<void> => {
    const id = sessionRef.current;
    if (side === 'remote' && !id) return;
    const request = ++requests.current[side];
    setListings(current => ({ ...current, [side]: { ...current[side], loading: true } }));
    try {
      const listing = side === 'local' ? await window.desktopApi.localList({ path }) : await window.desktopApi.sftpList({ sessionId: id!, path });
      if (request !== requests.current[side]) return;
      paths.current[side] = listing.path;
      setListings(current => ({ ...current, [side]: { path: listing.path, entries: listing.entries, loading: false, error: null } }));
    } catch (error) {
      if (request !== requests.current[side]) return;
      // The previous folder stays visible; only the message is new.
      setListings(current => ({ ...current, [side]: { ...current[side], loading: false, error: ipcErrorText(error, 'Der Ordner konnte nicht geöffnet werden.') } }));
    }
  }, []);
  const refresh = useCallback((side: FileSide): void => { const path = paths.current[side]; if (path) void load(side, path); }, [load]);

  // This computer: home folder and drives, independent of the server connection.
  useEffect(() => {
    let disposed = false;
    void window.desktopApi.localPlaces().then(places => {
      if (disposed) return;
      setDrives(places.drives);
      setHomes(current => ({ ...current, local: places.home }));
      void load('local', paths.current.local ?? places.home);
    }).catch(error => setListings(current => ({ ...current, local: { ...current.local, error: ipcErrorText(error) } })));
    return () => { disposed = true; };
  }, [load]);

  useEffect(() => {
    let disposed = false;
    let id: string | null = null;
    const report = (next: SftpStatus, text?: string): void => {
      if (disposed) return;
      setStatus(next); setMessage(text ?? null); onStatusChange(tabId, next);
    };
    const connected = (): void => {
      report('connected');
      void window.desktopApi.sftpHome({ sessionId: id! }).then(home => {
        if (disposed) return;
        setHomes(current => ({ ...current, remote: home }));
        void load('remote', paths.current.remote ?? home);
      }).catch(error => { if (!disposed) setListings(current => ({ ...current, remote: { ...current.remote, error: ipcErrorText(error) } })); });
    };
    const unsubscribe = window.desktopApi.onSftpEvent(event => {
      if (event.sessionId !== id || disposed) return;
      if (event.type === 'status') { if (event.status === 'connected') connected(); else report(event.status, event.message); }
      else if (event.type === 'conflict') setConflict(event.conflict);
      else if (event.type === 'edit') {
        const { edit, closed } = event;
        setEdits(current => closed ? current.filter(item => item.id !== edit.id)
          : current.some(item => item.id === edit.id) ? current.map(item => item.id === edit.id ? edit : item) : [...current, edit]);
        if (edit.state === 'saved') refresh('remote');
      }
      else {
        setJobs(current => current.some(job => job.id === event.job.id)
          ? current.map(job => job.id === event.job.id ? event.job : job) : [...current, event.job]);
        if (isFinished(event.job)) {
          setConflict(current => current?.jobId === event.job.id ? null : current);
          refresh('local'); refresh('remote');
        }
      }
    });
    const attach = (sessionId: string): void => {
      id = sessionId;
      sessionRef.current = id;
      setSessionId(id);
      liveSessions.set(tabId, { kind: 'sftp', sessionId: id, snapshot: () => JSON.stringify(paths.current) });
    };
    // StrictMode mounts twice in development; only the surviving mount opens or adopts a session.
    const timer = setTimeout(() => {
      const adopted = adoptRef.current;
      adoptRef.current = undefined;
      if (adopted?.session) {
        const { sessionId: adoptedId } = adopted.session;
        attach(adoptedId);
        void window.desktopApi.sftpState({ sessionId: adoptedId }).then(state => {
          if (disposed) return;
          setJobs(state.jobs);
          setEdits(state.edits);
          setConflict(state.conflict ?? null);
          if (state.status === 'connected') connected(); else report(state.status);
        }).catch((error: Error) => report('error', ipcErrorText(error)));
        return;
      }
      // A closed tab moved from another window stays closed until "Neu verbinden".
      if (adopted) return;
      report('connecting');
      window.desktopApi.sftpOpen({ connectionId: connection.id }).then(result => {
        if (disposed) { void window.desktopApi.sftpClose(result).catch(() => {}); return; }
        attach(result.sessionId);
      }).catch((error: Error) => report('error', ipcErrorText(error)));
    }, 0);
    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      sessionRef.current = null;
      liveSessions.delete(tabId);
      if (id && !liveSessions.takeTransferred(id)) void window.desktopApi.sftpClose({ sessionId: id }).catch(() => {});
    };
  }, [connection.id, tabId, onStatusChange, load, refresh, attempt]);

  const run = async (action: () => Promise<unknown>, side?: FileSide): Promise<boolean> => {
    setBusy(true); setActionError(null);
    try { await action(); return true; }
    catch (error) { setActionError(ipcErrorText(error)); return false; }
    finally { setBusy(false); if (side) refresh(side); }
  };
  const transfer = (from: FileSide, sources: string[], move: boolean, targetDir?: string): void => {
    const target = targetDir ?? paths.current[from === 'local' ? 'remote' : 'local'];
    if (!sessionId || !target || !sources.length) return;
    void run(() => window.desktopApi.sftpTransfer({ sessionId, direction: from === 'local' ? 'upload' : 'download', sources, targetDir: target, move }));
  };
  const answer = (choice: ConflictChoice, applyToAll: boolean): void => {
    if (!conflict || !sessionId) return;
    setConflict(null);
    void window.desktopApi.sftpResolve({ sessionId, conflictId: conflict.conflictId, choice, applyToAll }).catch(error => setActionError(ipcErrorText(error)));
  };
  const remoteReady = status === 'connected' && !!sessionId;
  const remoteNotice = status === 'connected' ? undefined
    : status === 'connecting' ? { text: 'Verbindung zum Server wird aufgebaut …' }
    : { text: message ?? 'Die Verbindung wurde beendet.', action: { label: 'Neu verbinden', run: () => { setJobs([]); setConflict(null); setAttempt(value => value + 1); } } };
  const active = jobs.filter(job => !isFinished(job));

  const pane = (side: FileSide) => <FilePane tabId={tabId} side={side} title={side === 'local' ? 'Dieser Computer' : `${connection.name} (${connection.address})`}
    listing={listings[side]} active={activeSide === side} disabled={busy || (side === 'remote' && !remoteReady)}
    notice={side === 'remote' ? remoteNotice : undefined} home={homes[side]} drives={side === 'local' ? drives : undefined}
    onActivate={() => setActiveSide(side)} onNavigate={path => void load(side, path)} onRefresh={() => refresh(side)}
    onMkdir={path => run(() => side === 'local' ? window.desktopApi.localMkdir({ path }) : window.desktopApi.sftpMkdir({ sessionId: sessionId!, path }), side)}
    onRename={(from, to) => run(() => side === 'local' ? window.desktopApi.localRename({ from, to }) : window.desktopApi.sftpRename({ sessionId: sessionId!, from, to }), side)}
    onDelete={(paths, names) => setPendingDelete({ side, paths, names })}
    onEdit={(path, editor) => void run(() => side === 'local' ? window.desktopApi.localOpen({ path, editor })
      : window.desktopApi.sftpEdit({ sessionId: sessionId!, path, editor }))}
    onCreateFile={path => run(async () => {
      if (side === 'local') { await window.desktopApi.localCreateFile({ path }); await window.desktopApi.localOpen({ path, editor: 'default' }); return; }
      await window.desktopApi.sftpCreateFile({ sessionId: sessionId!, path });
      await window.desktopApi.sftpEdit({ sessionId: sessionId!, path, editor: 'default' });
    }, side)}
    onPermissions={side === 'remote' ? (paths, entries) => setPendingPermissions({ paths, entries }) : undefined}
    onCopy={(sources, move) => { if (remoteReady) transfer(side, sources, move); }}
    onDrop={(drag, targetDir, move) => {
      if (!remoteReady) return;
      if ('external' in drag) transfer('local', drag.external, false, targetDir);
      else transfer(drag.side, drag.names.map(name => joinPath(drag.side, drag.dir, name)), move, targetDir);
    }} />;

  return (
    <section className={`terminal-panel files-panel${focused ? ' focused-pane' : ''}`} style={style} onPointerDown={onFocus}
      id={`terminal-${tabId}`} role="tabpanel" aria-labelledby={`tab-${tabId}`} hidden={!visible}>
      <span className="terminal-live-status" role="status">{status === 'connected' ? 'SFTP verbunden' : status === 'connecting' ? 'SFTP verbindet ...' : message ?? 'SFTP getrennt'}</span>
      {actionError && <p className="file-error file-action-error" role="alert">{actionError}<button type="button" aria-label="Meldung schließen" onClick={() => setActionError(null)}>×</button></p>}
      <div className="files-commander">{pane('local')}{pane('remote')}</div>
      {edits.length > 0 && sessionId && <EditList edits={edits}
        onOpen={editId => void window.desktopApi.sftpEditOpen({ sessionId, editId }).catch(error => setActionError(ipcErrorText(error)))}
        onUpload={editId => void window.desktopApi.sftpEditUpload({ sessionId, editId }).catch(error => setActionError(ipcErrorText(error)))}
        onClose={editId => void window.desktopApi.sftpEditClose({ sessionId, editId }).catch(error => setActionError(ipcErrorText(error)))} />}
      {pendingPermissions && <PermissionsDialog entries={pendingPermissions.entries} busy={busy} onCancel={() => setPendingPermissions(null)}
        onApply={(mode, recursive) => void run(() => window.desktopApi.sftpChmod({ sessionId: sessionId!, paths: pendingPermissions.paths, mode, recursive }), 'remote')
          .then(done => { if (done) setPendingPermissions(null); })} />}
      {jobs.length > 0 && <TransferQueue jobs={jobs} activeCount={active.length}
        onCancel={jobId => sessionId && void window.desktopApi.sftpCancel({ sessionId, jobId }).catch(() => {})}
        onClear={() => { setJobs(current => current.filter(job => !isFinished(job))); if (sessionId) void window.desktopApi.sftpClearFinished({ sessionId }).catch(() => {}); }} />}
      {conflict && visible && <ConflictDialog conflict={conflict} onAnswer={answer} />}
      {pendingDelete && <ConfirmDialog busy={busy}
        title={pendingDelete.names.length === 1 ? `„${pendingDelete.names[0]}“ löschen?` : `${pendingDelete.names.length} Einträge löschen?`}
        description={pendingDelete.side === 'local' ? 'Die Einträge werden in den Papierkorb verschoben.'
          : 'Die Einträge werden auf dem Server endgültig gelöscht, Ordner mit ihrem gesamten Inhalt. Das kann nicht rückgängig gemacht werden.'}
        confirmLabel={pendingDelete.side === 'local' ? 'In den Papierkorb' : 'Endgültig löschen'}
        onCancel={() => setPendingDelete(null)} onConfirm={() => {
          const { side, paths: targets } = pendingDelete;
          void run(() => side === 'local' ? window.desktopApi.localDelete({ paths: targets }) : window.desktopApi.sftpDelete({ sessionId: sessionId!, paths: targets }), side)
            .then(() => setPendingDelete(null));
        }} />}
    </section>
  );
}

function TransferQueue({ jobs, activeCount, onCancel, onClear }: { jobs: TransferJob[]; activeCount: number; onCancel: (jobId: string) => void; onClear: () => void }) {
  return (
    <section className="transfer-queue" aria-label="Übertragungen">
      <header><strong>Übertragungen</strong><span>{activeCount ? `${activeCount} aktiv` : 'alle erledigt'}</span>
        <button type="button" className="secondary-button" disabled={activeCount === jobs.length} onClick={onClear}>Erledigte entfernen</button></header>
      <ul>
        {[...jobs].reverse().map(job => <li key={job.id} className={`transfer-job is-${job.state}`}>
          <span className="transfer-direction" title={job.direction === 'upload' ? 'Hochladen' : 'Herunterladen'}>{job.direction === 'upload' ? '↑' : '↓'}</span>
          <div className="transfer-main">
            <div className="transfer-title"><strong>{job.label}</strong>{job.move && <small>verschieben</small>}<span className="transfer-target" title={job.targetDir}>→ {job.targetDir}</span></div>
            <progress max={100} value={jobPercent(job)} aria-label={`Fortschritt ${job.label}`} />
            <small>{stateLabels[job.state]}
              {job.totalFiles > 0 && ` · ${job.doneFiles} von ${job.totalFiles} Dateien`}
              {job.totalBytes > 0 && ` · ${formatSize(job.doneBytes)} von ${formatSize(job.totalBytes)}`}
              {job.skippedFiles > 0 && ` · ${job.skippedFiles} übersprungen`}
              {job.current && ` · ${job.current}`}
              {job.message && ` · ${job.message}`}</small>
          </div>
          {!isFinished(job) && <button type="button" className="secondary-button" onClick={() => onCancel(job.id)}>Abbrechen</button>}
        </li>)}
      </ul>
    </section>
  );
}

const editLabels: Record<EditedFile['state'], string> = {
  open: 'Im Editor geöffnet – Speichern lädt hoch', uploading: 'Wird hochgeladen …', saved: 'Hochgeladen', conflict: 'Auf dem Server geändert', error: 'Hochladen fehlgeschlagen',
};
const timeFormat = new Intl.DateTimeFormat('de-DE', { timeStyle: 'medium' });

function EditList({ edits, onOpen, onUpload, onClose }: { edits: EditedFile[]; onOpen: (id: string) => void; onUpload: (id: string) => void; onClose: (id: string) => void }) {
  return (
    <section className="transfer-queue edit-list" aria-label="Bearbeitete Dateien">
      <header><strong>Bearbeitete Dateien</strong><span>Speichern im Editor lädt die Datei automatisch hoch.</span></header>
      <ul>
        {edits.map(edit => <li key={edit.id} className={`transfer-job is-edit-${edit.state}`}>
          <span className="transfer-direction" aria-hidden="true">✎</span>
          <div className="transfer-main">
            <div className="transfer-title"><strong>{edit.name}</strong><span className="transfer-target" title={edit.remotePath}>{edit.remotePath}</span></div>
            <small role="status">{editLabels[edit.state]}{edit.state === 'saved' && edit.savedAt ? ` um ${timeFormat.format(edit.savedAt)}` : ''}
              {edit.message && ` · ${edit.message}`}</small>
          </div>
          {edit.state === 'conflict' && <button type="button" className="secondary-button" title="Die Serverversion wird durch deine Fassung ersetzt" onClick={() => onUpload(edit.id)}>Trotzdem hochladen</button>}
          {edit.state === 'error' && <button type="button" className="secondary-button" onClick={() => onUpload(edit.id)}>Erneut hochladen</button>}
          <button type="button" className="secondary-button" onClick={() => onOpen(edit.id)}>Im Editor öffnen</button>
          <button type="button" className="secondary-button" title="Nicht mehr überwachen; die lokale Kopie wird gelöscht" onClick={() => onClose(edit.id)}>Schließen</button>
        </li>)}
      </ul>
    </section>
  );
}

function ConflictDialog({ conflict, onAnswer }: { conflict: TransferConflict; onAnswer: (choice: ConflictChoice, applyToAll: boolean) => void }) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [applyToAll, setApplyToAll] = useState(false);
  useNativeSurfaceBlock(true);
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  const newer = conflict.source.modified > conflict.target.modified + 1000;
  return (
    <dialog ref={dialogRef} className="confirm-dialog conflict-dialog" aria-labelledby={`${id}-title`}
      onCancel={event => { event.preventDefault(); onAnswer('cancel', false); }}>
      <h2 id={`${id}-title`}>„{conflict.name}“ existiert bereits</h2>
      <dl>
        <dt>Neue Datei</dt><dd>{formatSize(conflict.source.size)} · {formatDate(conflict.source.modified)}{newer && <strong> (neuer)</strong>}</dd>
        <dt>Vorhandene Datei</dt><dd>{formatSize(conflict.target.size)} · {formatDate(conflict.target.modified)}{!newer && <strong> (gleich alt oder neuer)</strong>}</dd>
      </dl>
      <label className="editor-checkbox"><input type="checkbox" checked={applyToAll} onChange={event => setApplyToAll(event.target.checked)} />Für alle weiteren Konflikte dieser Übertragung</label>
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={() => onAnswer('cancel', false)}>Übertragung abbrechen</button>
        <button type="button" className="secondary-button" onClick={() => onAnswer('skip', applyToAll)}>Überspringen</button>
        <button type="button" className="secondary-button" onClick={() => onAnswer('newer', applyToAll)}>Nur wenn neuer</button>
        <button type="button" className="primary-button" autoFocus onClick={() => onAnswer('overwrite', applyToAll)}>Überschreiben</button>
      </div>
    </dialog>
  );
}
