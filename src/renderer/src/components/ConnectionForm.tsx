import { useEffect, useId, useRef, useState } from 'react';
import type { ConnectionNode, ConnectionProtocol, VaultNode } from '../../../shared/vault/types';
import { ConnectionFieldError, connectionFromFields, fieldsFromConnection, folderOptions } from '../connection-form';
import type { ConnectionFields, ConnectionTextField } from '../connection-form';
import { validateCluster } from '../cluster-form';
import { ClusterForm } from './ClusterForm';
import { ConfirmDialog } from './ConfirmDialog';
import './editor-ui.css';
import { CONNECTION_ICONS } from '../../../shared/vault/appearance';
import { ConnectionIcon, connectionIconLabels } from './ConnectionIcon';
import { PROTOCOLS } from '../../../shared/vault/connections';
import { AI_CLI_TOOLS } from '../../../shared/ai-cli';
import type { ConnectionTestResult, ConnectionTestStepId } from '../../../shared/connection-test';
import { errorText } from '../error-text';
import { useT } from '../i18n';

const STEP_LABEL_KEYS = {
  clusterTest: 'connection:test.steps.clusterTest', startFolder: 'connection:test.steps.startFolder', command: 'connection:test.steps.command',
  toolFound: 'connection:test.steps.toolFound', programFound: 'connection:test.steps.programFound', hostGiven: 'connection:test.steps.hostGiven',
  nameResolved: 'connection:test.steps.nameResolved', portReachable: 'connection:test.steps.portReachable', login: 'connection:test.steps.login',
  userGiven: 'connection:test.steps.userGiven', hostKey: 'connection:test.steps.hostKey', credentials: 'connection:test.steps.credentials',
  sftp: 'connection:test.steps.sftp',
} as const satisfies Record<ConnectionTestStepId, string>;

const newTitles: Record<ConnectionProtocol, string> = {
  ssh: 'Neue SSH-Verbindung', sftp: 'Neue SFTP-Verbindung (Dateien)', rdp: 'Neue Remotedesktop-Verbindung (RDP)',
  powershell: 'Neue lokale PowerShell', cmd: 'Neue lokale Eingabeaufforderung (CMD)', aicli: 'Neue KI-CLI (Claude Code, Codex, Gemini)',
  kubernetes: 'Neuer Kubernetes-Cluster',
};
const connectLabels: Record<ConnectionProtocol, string> = { ssh: 'SSH verbinden', sftp: 'Dateien öffnen', rdp: 'RDP verbinden', powershell: 'Shell starten', cmd: 'Shell starten', aicli: 'CLI starten', kubernetes: 'Cluster öffnen' };

interface ConnectionFormProps {
  connection?: ConnectionNode;
  /** `connection` is a prefilled draft that is not in the vault yet (cluster setup from an SSH host): saved like a new connection. */
  isNew?: boolean;
  /** Kind of a new connection; existing connections keep their protocol. */
  protocol?: ConnectionProtocol;
  nodes: VaultNode[];
  initialParentId: string;
  busy: boolean;
  onSave: (connection: ConnectionNode, parentId: string) => Promise<boolean>;
  onCancel: () => void;
  onConnect?: () => void;
  onDelete?: () => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
  onSaveAndConnect?: (connection: ConnectionNode, parentId: string) => Promise<boolean>;
  onPickKey?: () => Promise<string | null>;
  /** Dry run with the current, possibly unsaved values. */
  onTest?: (connection: ConnectionNode) => Promise<ConnectionTestResult>;
}

export function ConnectionForm({ connection, isNew = false, protocol: requestedProtocol, nodes, initialParentId, busy, onSave, onCancel, onDelete, onConnect,
  onDirtyChange, onSaveAndConnect, onPickKey, onTest }: ConnectionFormProps) {
  const { t } = useT();
  const prefix = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const submittingRef = useRef(false);
  const protocol = connection?.protocol ?? requestedProtocol ?? 'ssh';
  const remote = protocol !== 'powershell' && protocol !== 'cmd' && protocol !== 'aicli' && protocol !== 'kubernetes';
  const sshAuth = protocol === 'ssh' || protocol === 'sftp';
  const [fields, setFields] = useState<ConnectionFields>(() => fieldsFromConnection(protocol, connection));
  const [parentId, setParentId] = useState(initialParentId);
  const [savedSignature, setSavedSignature] = useState(() => JSON.stringify({ fields, parentId }));
  const dirty = savedSignature !== JSON.stringify({ fields, parentId });
  const [error, setError] = useState<{ field?: keyof ConnectionFields; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [visibleSecret, setVisibleSecret] = useState(false);
  const [test, setTest] = useState<{ running: boolean; result?: ConnectionTestResult; error?: string } | null>(null);
  // A result belongs to the values it was run with.
  useEffect(() => { setTest(current => current?.running ? current : null); }, [fields]);
  async function runTest(): Promise<void> {
    if (!onTest || test?.running) return;
    let node: ConnectionNode;
    try { node = connectionFromFields(connection?.id ?? 'test', fields, protocol); }
    catch (caught) {
      const field = caught instanceof ConnectionFieldError ? caught.field : undefined;
      setError({ field, message: caught instanceof Error ? caught.message : 'Bitte prüfe die Verbindungsdaten.' });
      return;
    }
    setTest({ running: true });
    try { setTest({ running: false, result: await onTest(node) }); }
    catch (caught) { setTest({ running: false, error: errorText(caught, 'Der Test ist fehlgeschlagen.') }); }
  }
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  function setField(field: keyof ConnectionFields, value: string): void {
    setFields(current => ({ ...current, [field]: value }));
    setError(current => current?.field === field ? null : current);
  }
  function updateCluster(patch: Partial<ConnectionFields>): void {
    setFields(current => ({ ...current, ...patch }));
    setError(current => current?.field && current.field in patch ? null : current);
  }
  async function submit(connect: boolean): Promise<void> {
    if (busy || submittingRef.current) return;
    submittingRef.current = true;
    try {
      const updated = connectionFromFields(connection?.id ?? crypto.randomUUID(), fields, protocol);
      const clusterProblem = updated.protocol === 'kubernetes' ? validateCluster(updated, nodes) : null;
      if (clusterProblem) { setError({ message: clusterProblem }); return; }
      setError(null);
      const saved = await (connect && onSaveAndConnect ? onSaveAndConnect : onSave)(updated, parentId);
      if (saved) { setSavedSignature(JSON.stringify({ fields, parentId })); onDirtyChange?.(false); }
    } catch (caught) {
      const field = caught instanceof ConnectionFieldError ? caught.field : undefined;
      setError({ field, message: caught instanceof ConnectionFieldError ? caught.message : 'Speichern fehlgeschlagen. Deine Eingaben bleiben erhalten. Bitte versuche es erneut.' });
      if (field) {
        if ((field === 'color' || field === 'workingDirectory') && detailsRef.current) detailsRef.current.open = true;
        requestAnimationFrame(() => document.getElementById(`${prefix}-${field}`)?.focus());
      }
    } finally { submittingRef.current = false; }
  }
  const textField = (label: string, field: ConnectionTextField, secret = false) => (
    <div className="editor-field">
      <label htmlFor={`${prefix}-${field}`}>{label}</label>
      <div className="editor-input-group">
        <input id={`${prefix}-${field}`} type={secret && !visibleSecret ? 'password' : 'text'} value={fields[field]} disabled={busy}
          inputMode={field === 'port' ? 'numeric' : undefined}
          autoComplete={secret ? 'new-password' : 'off'} spellCheck={false}
          aria-invalid={error?.field === field || undefined}
          aria-describedby={error?.field === field ? `${prefix}-${field}-error` : undefined}
          onChange={event => setField(field, event.target.value)} />
        {secret && <button className="secondary-button secret-toggle" type="button" disabled={busy}
          aria-label={`${label} ${visibleSecret ? 'verbergen' : 'anzeigen'}`} aria-pressed={visibleSecret}
          onClick={() => setVisibleSecret(value => !value)}>{visibleSecret ? 'Verbergen' : 'Anzeigen'}</button>}
        {field === 'keyPath' && onPickKey && <button className="secondary-button" type="button" disabled={busy}
          onClick={() => { void onPickKey().then(path => { if (path) setField('keyPath', path); }).catch(() => setError({ message: 'Die Dateiauswahl konnte nicht geöffnet werden. Gib den Schlüsselpfad direkt ein.' })); }}>Auswählen</button>}
      </div>
      {error?.field === field && <p className="field-error" id={`${prefix}-${field}-error`} role="alert">{error.message}</p>}
    </div>
  );

  return (
    <section className="node-editor compact-editor" aria-label="Verbindung bearbeiten">
      <h2>{connection && !isNew ? `${PROTOCOLS[protocol].short}-Verbindung bearbeiten` : newTitles[protocol]}</h2>
      <form noValidate data-editor-form onSubmit={event => { event.preventDefault(); void submit(false); }}>
        {textField('Verbindungsname', 'name')}
        <fieldset className="connection-appearance">
          <legend>Symbol und Farbe</legend>
          <div className="connection-appearance-controls">
            <div className="connection-icon-options" aria-label="Verbindungssymbol">
              {CONNECTION_ICONS.map(icon => <button key={icon} type="button" disabled={busy} aria-label={`Symbol: ${connectionIconLabels[icon]}`}
                title={connectionIconLabels[icon]} aria-pressed={fields.icon === icon} onClick={() => setField('icon', icon)}>
                <ConnectionIcon icon={icon} color={fields.color || undefined} />
              </button>)}
            </div>
            <input type="color" aria-label="Verbindungsfarbe" title="Verbindungsfarbe wählen" value={/^#[\da-f]{6}$/i.test(fields.color) ? fields.color : '#a7b7cb'}
              disabled={busy} onChange={event => setField('color', event.target.value)} />
            <button className="secondary-button" type="button" disabled={busy || !fields.color} onClick={() => setField('color', '')}>Standardfarbe</button>
          </div>
        </fieldset>
        {protocol === 'kubernetes' && <ClusterForm idPrefix={prefix} fields={fields} nodes={nodes} busy={busy} error={error} onChange={updateCluster} />}
        {remote && <div className="editor-host-row">{textField('Host', 'host')}{textField('Port', 'port')}</div>}
        {protocol === 'rdp' && <>
          <div className="editor-auth-row">{textField('Benutzername', 'username')}{textField('Domäne (optional)', 'domain')}</div>
          <p className="editor-hint">Alternativ DOMÄNE\Benutzer oder benutzer@domäne als Benutzername.</p>
          {textField('Passwort (leer: beim Verbinden fragen)', 'password', true)}
          <label className="editor-checkbox"><input type="checkbox" checked={fields.clipboard === 'on'} disabled={busy}
            onChange={event => setField('clipboard', event.target.checked ? 'on' : 'off')} />Zwischenablage mit dem Remotedesktop teilen</label>
        </>}
        {protocol === 'aicli' && <>
          <label>Werkzeug<select value={fields.tool} disabled={busy} onChange={event => setField('tool', event.target.value)}>
            {(Object.keys(AI_CLI_TOOLS) as (keyof typeof AI_CLI_TOOLS)[]).map(tool => <option key={tool} value={tool}>{AI_CLI_TOOLS[tool].label}</option>)}
            <option value="custom">Eigener Befehl</option>
          </select></label>
          {fields.tool === 'custom' ? textField('Befehl (z. B. aider oder ollama run llama3)', 'command')
            : <p className="editor-hint">Startet <code>{AI_CLI_TOOLS[fields.tool].command}</code> mit der eigenen Anmeldung des Werkzeugs. Nicht installiert? <code>{AI_CLI_TOOLS[fields.tool].install}</code></p>}
          {textField('Projektordner (leer: Benutzerprofil)', 'workingDirectory')}
          <p className="editor-hint">Nach dem Beenden bleibt der Tab eine Eingabeaufforderung in diesem Ordner.</p>
        </>}
        {(protocol === 'powershell' || protocol === 'cmd') && <>
          {textField('Startordner (leer: Benutzerprofil)', 'workingDirectory')}
          <p className="editor-hint">Startet {PROTOCOLS[protocol].short} auf diesem Computer.</p>
        </>}
        {protocol === 'sftp' && <p className="editor-hint">Öffnet einen Dateibrowser: links dieser Computer, rechts der Server. Anmeldung wie bei SSH.</p>}
        {sshAuth && <><div className="editor-auth-row">
          {textField('Benutzername', 'username')}
          <label>Authentifizierung
            <select value={fields.method} disabled={busy} onChange={event => {
              setFields(current => ({ ...current, method: event.target.value as ConnectionFields['method'], password: '', keyPath: '', passphrase: '' }));
              setVisibleSecret(false); setError(null);
            }}>
              <option value="agent">SSH-Agent</option><option value="password">Passwort</option><option value="privateKey">Privater Schlüssel</option>
            </select>
          </label>
        </div>
        {fields.method === 'password' && textField(protocol === 'sftp' ? 'Passwort' : 'SSH-Passwort', 'password', true)}
        {fields.method === 'privateKey' && <>
          {textField('Pfad zum privaten Schlüssel', 'keyPath')}
          {textField('Schlüssel-Passphrase', 'passphrase', true)}
        </>}
        {protocol === 'ssh' && <label className="editor-checkbox"><input type="checkbox" checked={fields.containerSudo === 'on'} disabled={busy}
          onChange={event => setField('containerSudo', event.target.checked ? 'on' : 'off')} />Container-Befehle mit sudo ausführen</label>}</>}
        <details className="editor-details" ref={detailsRef}>
          <summary>Weitere Angaben</summary>
          <div className="editor-details-content">
            <label>Zielordner<select value={parentId} disabled={busy} onChange={event => setParentId(event.target.value)}>
              <option value="">Vault-Ebene</option>
              {folderOptions(nodes).map(folder => <option key={folder.id} value={folder.id}>{folder.label}</option>)}
            </select></label>
            <label>Kommentar<textarea value={fields.comment} disabled={busy} rows={2} onChange={event => setField('comment', event.target.value)} /></label>
            {textField('Tags (durch Komma getrennt)', 'tags')}
            {textField('Farbe (optional, #RRGGBB)', 'color')}
          </div>
        </details>
        {error && !error.field && <p className="field-error" role="alert">{error.message}</p>}
        {test && !test.running && <div className={`connection-test ${test.result?.ok ? 'is-ok' : 'is-failed'}`} role="status">
          <strong>{test.error ?? (test.result?.ok ? 'Verbindungstest erfolgreich' : 'Verbindungstest fehlgeschlagen')}</strong>
          {test.result && <ol>{test.result.steps.map(step => <li key={step.step} className={step.ok ? 'is-ok' : 'is-failed'}>
            <span aria-hidden="true">{step.ok ? '✓' : '✕'}</span><span>{t(STEP_LABEL_KEYS[step.step], step.params)}{step.note && <small>{errorText(step.note)}</small>}{step.detail && <small>{step.detail}</small>}</span>
          </li>)}</ol>}
        </div>}
        <div className="form-actions editor-action-bar">
          <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>Abbrechen</button>
          {onTest && protocol !== 'kubernetes' && <button className="secondary-button" type="button" disabled={busy || test?.running} title="Prüft die eingegebenen Daten, ohne zu speichern"
            onClick={() => { void runTest(); }}>{test?.running ? 'Teste …' : 'Verbindung testen'}</button>}
          <button className={onSaveAndConnect || (connection && onConnect) ? 'secondary-button' : 'primary-button'} type="submit" disabled={busy || (!!connection && !isNew && !dirty)}>{busy ? 'Speichert ...' : 'Verbindung speichern'}</button>
          {connection && !dirty && onConnect ? <button className="primary-button" type="button" disabled={busy} onClick={onConnect}>{connectLabels[protocol]}</button>
            : onSaveAndConnect && <button className="primary-button" type="button" disabled={busy} onClick={() => { void submit(true); }}>Speichern und verbinden</button>}
        </div>
      </form>
      {connection && onDelete && <details className="editor-details editor-management">
        <summary>Verbindung verwalten</summary>
        <button className="danger-button" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>Verbindung löschen</button>
      </details>}
      {confirmDelete && onDelete && <ConfirmDialog title={`Verbindung „${connection?.name}“ löschen?`}
        description="Die Verbindung wird unwiderruflich entfernt, auch aus gespeicherten Workspaces. Ihre aktiven Sitzungen werden beendet."
        busy={busy} onCancel={() => setConfirmDelete(false)} onConfirm={() => { void onDelete().then(saved => { if (saved) setConfirmDelete(false); }); }} />}
    </section>
  );
}
