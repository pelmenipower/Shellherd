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
import { AI_CLI_TOOLS } from '../../../shared/ai-cli';
import type { ConnectionTestResult, ConnectionTestStepId } from '../../../shared/connection-test';
import { errorText } from '../error-text';
import { Trans, useT } from '../i18n';
import { protocolShort } from '../connection-labels';

const STEP_LABEL_KEYS = {
  clusterTest: 'connection:test.steps.clusterTest', startFolder: 'connection:test.steps.startFolder', command: 'connection:test.steps.command',
  toolFound: 'connection:test.steps.toolFound', programFound: 'connection:test.steps.programFound', hostGiven: 'connection:test.steps.hostGiven',
  nameResolved: 'connection:test.steps.nameResolved', portReachable: 'connection:test.steps.portReachable', login: 'connection:test.steps.login',
  userGiven: 'connection:test.steps.userGiven', hostKey: 'connection:test.steps.hostKey', credentials: 'connection:test.steps.credentials',
  sftp: 'connection:test.steps.sftp',
} as const satisfies Record<ConnectionTestStepId, string>;

const NEW_TITLE_KEYS = {
  ssh: 'connection:form.newTitle.ssh', sftp: 'connection:form.newTitle.sftp', rdp: 'connection:form.newTitle.rdp', powershell: 'connection:form.newTitle.powershell',
  cmd: 'connection:form.newTitle.cmd', aicli: 'connection:form.newTitle.aicli', kubernetes: 'connection:form.newTitle.kubernetes',
} as const satisfies Record<ConnectionProtocol, string>;
const CONNECT_LABEL_KEYS = {
  ssh: 'connection:form.connect.ssh', sftp: 'connection:form.connect.sftp', rdp: 'connection:form.connect.rdp', powershell: 'connection:form.connect.powershell',
  cmd: 'connection:form.connect.cmd', aicli: 'connection:form.connect.aicli', kubernetes: 'connection:form.connect.kubernetes',
} as const satisfies Record<ConnectionProtocol, string>;

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
      setError({ field, message: caught instanceof Error ? caught.message : t('connection:validation.checkData') });
      return;
    }
    setTest({ running: true });
    try { setTest({ running: false, result: await onTest(node) }); }
    catch (caught) { setTest({ running: false, error: errorText(caught, t('connection:form.run.error')) }); }
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
      setError({ field, message: caught instanceof ConnectionFieldError ? caught.message : t('connection:form.saveFailed') });
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
          aria-label={t(visibleSecret ? 'connection:form.secret.hideLabel' : 'connection:form.secret.showLabel', { label })} aria-pressed={visibleSecret}
          onClick={() => setVisibleSecret(value => !value)}>{t(visibleSecret ? 'connection:form.secret.hide' : 'connection:form.secret.show')}</button>}
        {field === 'keyPath' && onPickKey && <button className="secondary-button" type="button" disabled={busy}
          onClick={() => { void onPickKey().then(path => { if (path) setField('keyPath', path); }).catch(() => setError({ message: t('connection:form.pickKeyFailed') })); }}>{t('connection:form.pickKey')}</button>}
      </div>
      {error?.field === field && <p className="field-error" id={`${prefix}-${field}-error`} role="alert">{error.message}</p>}
    </div>
  );

  return (
    <section className="node-editor compact-editor" aria-label={t('connection:form.ariaLabel')}>
      <h2>{connection && !isNew ? t('connection:form.editTitle', { protocol: protocolShort(protocol) }) : t(NEW_TITLE_KEYS[protocol])}</h2>
      <form noValidate data-editor-form onSubmit={event => { event.preventDefault(); void submit(false); }}>
        {textField(t('connection:form.fields.name'), 'name')}
        <fieldset className="connection-appearance">
          <legend>{t('connection:form.appearance.legend')}</legend>
          <div className="connection-appearance-controls">
            <div className="connection-icon-options" aria-label={t('connection:form.appearance.iconsLabel')}>
              {CONNECTION_ICONS.map(icon => <button key={icon} type="button" disabled={busy} aria-label={t('connection:form.appearance.iconButton', { name: connectionIconLabels[icon] })}
                title={connectionIconLabels[icon]} aria-pressed={fields.icon === icon} onClick={() => setField('icon', icon)}>
                <ConnectionIcon icon={icon} color={fields.color || undefined} />
              </button>)}
            </div>
            <input type="color" aria-label={t('connection:form.appearance.colorLabel')} title={t('connection:form.appearance.colorTitle')} value={/^#[\da-f]{6}$/i.test(fields.color) ? fields.color : '#a7b7cb'}
              disabled={busy} onChange={event => setField('color', event.target.value)} />
            <button className="secondary-button" type="button" disabled={busy || !fields.color} onClick={() => setField('color', '')}>{t('connection:form.appearance.defaultColor')}</button>
          </div>
        </fieldset>
        {protocol === 'kubernetes' && <ClusterForm idPrefix={prefix} fields={fields} nodes={nodes} busy={busy} error={error} onChange={updateCluster} />}
        {remote && <div className="editor-host-row">{textField(t('connection:form.fields.host'), 'host')}{textField(t('connection:form.fields.port'), 'port')}</div>}
        {protocol === 'rdp' && <>
          <div className="editor-auth-row">{textField(t('connection:form.fields.username'), 'username')}{textField(t('connection:form.fields.domain'), 'domain')}</div>
          <p className="editor-hint">{t('connection:form.rdp.hint')}</p>
          {textField(t('connection:form.fields.rdpPassword'), 'password', true)}
          <label className="editor-checkbox"><input type="checkbox" checked={fields.clipboard === 'on'} disabled={busy}
            onChange={event => setField('clipboard', event.target.checked ? 'on' : 'off')} />{t('connection:form.rdp.clipboard')}</label>
        </>}
        {protocol === 'aicli' && <>
          <label>{t('connection:form.fields.tool')}<select value={fields.tool} disabled={busy} onChange={event => setField('tool', event.target.value)}>
            {(Object.keys(AI_CLI_TOOLS) as (keyof typeof AI_CLI_TOOLS)[]).map(tool => <option key={tool} value={tool}>{AI_CLI_TOOLS[tool].label}</option>)}
            <option value="custom">{t('connection:form.aicli.custom')}</option>
          </select></label>
          {fields.tool === 'custom' ? textField(t('connection:form.fields.command'), 'command')
            : <p className="editor-hint"><Trans t={t} i18nKey="connection:form.aicli.presetHint" values={{ command: AI_CLI_TOOLS[fields.tool].command, install: AI_CLI_TOOLS[fields.tool].install }}
              components={{ code: <code /> }} /></p>}
          {textField(t('connection:form.fields.projectFolder'), 'workingDirectory')}
          <p className="editor-hint">{t('connection:form.aicli.folderHint')}</p>
        </>}
        {(protocol === 'powershell' || protocol === 'cmd') && <>
          {textField(t('connection:form.fields.startFolder'), 'workingDirectory')}
          <p className="editor-hint">{t('connection:form.shell.hint', { shell: protocolShort(protocol) })}</p>
        </>}
        {protocol === 'sftp' && <p className="editor-hint">{t('connection:form.sftp.hint')}</p>}
        {sshAuth && <><div className="editor-auth-row">
          {textField(t('connection:form.fields.username'), 'username')}
          <label>{t('connection:form.fields.method')}
            <select value={fields.method} disabled={busy} onChange={event => {
              setFields(current => ({ ...current, method: event.target.value as ConnectionFields['method'], password: '', keyPath: '', passphrase: '' }));
              setVisibleSecret(false); setError(null);
            }}>
              <option value="agent">{t('connection:form.methods.agent')}</option><option value="password">{t('connection:form.methods.password')}</option><option value="privateKey">{t('connection:form.methods.privateKey')}</option>
            </select>
          </label>
        </div>
        {fields.method === 'password' && textField(t(protocol === 'sftp' ? 'connection:form.fields.sftpPassword' : 'connection:form.fields.sshPassword'), 'password', true)}
        {fields.method === 'privateKey' && <>
          {textField(t('connection:form.fields.keyPath'), 'keyPath')}
          {textField(t('connection:form.fields.passphrase'), 'passphrase', true)}
        </>}
        {protocol === 'ssh' && <label className="editor-checkbox"><input type="checkbox" checked={fields.containerSudo === 'on'} disabled={busy}
          onChange={event => setField('containerSudo', event.target.checked ? 'on' : 'off')} />{t('connection:form.containerSudo')}</label>}</>}
        <details className="editor-details" ref={detailsRef}>
          <summary>{t('connection:form.details.summary')}</summary>
          <div className="editor-details-content">
            <label>{t('connection:form.fields.targetFolder')}<select value={parentId} disabled={busy} onChange={event => setParentId(event.target.value)}>
              <option value="">{t('connection:form.details.vaultRoot')}</option>
              {folderOptions(nodes).map(folder => <option key={folder.id} value={folder.id}>{folder.label}</option>)}
            </select></label>
            <label>{t('connection:form.fields.comment')}<textarea value={fields.comment} disabled={busy} rows={2} onChange={event => setField('comment', event.target.value)} /></label>
            {textField(t('connection:form.fields.tags'), 'tags')}
            {textField(t('connection:form.fields.color'), 'color')}
          </div>
        </details>
        {error && !error.field && <p className="field-error" role="alert">{error.message}</p>}
        {test && !test.running && <div className={`connection-test ${test.result?.ok ? 'is-ok' : 'is-failed'}`} role="status">
          <strong>{test.error ?? (test.result?.ok ? t('connection:form.run.succeeded') : t('connection:form.run.failed'))}</strong>
          {test.result && <ol>{test.result.steps.map(step => <li key={step.step} className={step.ok ? 'is-ok' : 'is-failed'}>
            <span aria-hidden="true">{step.ok ? '✓' : '✕'}</span><span>{t(STEP_LABEL_KEYS[step.step], step.params)}{step.note && <small>{errorText(step.note)}</small>}{step.detail && <small>{step.detail}</small>}</span>
          </li>)}</ol>}
        </div>}
        <div className="form-actions editor-action-bar">
          <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>{t('common:actions.cancel')}</button>
          {onTest && protocol !== 'kubernetes' && <button className="secondary-button" type="button" disabled={busy || test?.running} title={t('connection:form.run.title')}
            onClick={() => { void runTest(); }}>{test?.running ? t('connection:form.run.running') : t('connection:form.run.button')}</button>}
          <button className={onSaveAndConnect || (connection && onConnect) ? 'secondary-button' : 'primary-button'} type="submit" disabled={busy || (!!connection && !isNew && !dirty)}>{busy ? t('common:status.saving') : t('connection:form.save')}</button>
          {connection && !dirty && onConnect ? <button className="primary-button" type="button" disabled={busy} onClick={onConnect}>{t(CONNECT_LABEL_KEYS[protocol])}</button>
            : onSaveAndConnect && <button className="primary-button" type="button" disabled={busy} onClick={() => { void submit(true); }}>{t('connection:form.saveAndConnect')}</button>}
        </div>
      </form>
      {connection && onDelete && <details className="editor-details editor-management">
        <summary>{t('connection:form.manage')}</summary>
        <button className="danger-button" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>{t('connection:form.delete')}</button>
      </details>}
      {confirmDelete && onDelete && <ConfirmDialog title={t('connection:form.deleteTitle', { name: connection?.name })}
        description={t('connection:form.deleteDescription')}
        busy={busy} onCancel={() => setConfirmDelete(false)} onConfirm={() => { void onDelete().then(saved => { if (saved) setConfirmDelete(false); }); }} />}
    </section>
  );
}
