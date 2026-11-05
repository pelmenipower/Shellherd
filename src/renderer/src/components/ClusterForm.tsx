import { useEffect, useRef, useState } from 'react';
import type { VaultNode } from '../../../shared/vault/types';
import { flattenConnections } from '../cluster-form';
import type { ConnectionFields } from '../connection-form';
import { errorText } from '../error-text';
import { useT } from '../i18n';

interface ClusterFormProps {
  /** Prefix for element ids, shared with the surrounding ConnectionForm. */
  idPrefix: string;
  fields: ConnectionFields;
  nodes: VaultNode[];
  busy: boolean;
  error: { field?: keyof ConnectionFields; message: string } | null;
  onChange: (patch: Partial<ConnectionFields>) => void;
}

const LINK_FIELDS = {
  argoUrl: { label: 'connection:cluster.links.argo', placeholder: 'https://argocd.example.com' },
  harborUrl: { label: 'connection:cluster.links.harbor', placeholder: 'https://harbor.example.com' },
} as const;

/** Cluster-specific fields; name, symbol, color, tags and comment come from ConnectionForm. */
export function ClusterForm({ idPrefix, fields, nodes, busy, error, onChange }: ClusterFormProps) {
  const { t } = useT();
  const [contexts, setContexts] = useState<string[]>([]);
  const [currentContext, setCurrentContext] = useState<string | undefined>();
  const [execCommands, setExecCommands] = useState<Record<string, string>>({});
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [pickError, setPickError] = useState(false);
  const [replacing, setReplacing] = useState(false);
  // Bumped whenever the source changes so a late probe answer is dropped.
  const probeSeq = useRef(0);
  const firstHost = fields.accessHosts[0];
  const source = fields.kubeconfigSource;
  const direct = source === 'inline' || source === 'file';
  // Contexts belong to the source they were read from.
  useEffect(() => { probeSeq.current += 1; setContexts([]); setCurrentContext(undefined); setExecCommands({}); setProbeError(null); },
    [firstHost, source, fields.kubeconfigText, fields.kubeconfigPath]);

  const connections = flattenConnections(nodes);
  const choices = connections.filter(node => node.protocol === 'ssh' && !node.disabled && !fields.accessHosts.includes(node.id));

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= fields.accessHosts.length) return;
    const hosts = [...fields.accessHosts];
    [hosts[index], hosts[target]] = [hosts[target], hosts[index]];
    onChange({ accessHosts: hosts });
  }

  const probeRequest = source === 'inline' ? (fields.kubeconfigText ? { text: fields.kubeconfigText } : null)
    : source === 'file' ? (fields.kubeconfigPath.trim() ? { path: fields.kubeconfigPath.trim() } : null)
      : firstHost ? { connectionId: firstHost } : null;

  async function readContexts(): Promise<void> {
    if (!probeRequest || probing) return;
    const seq = probeSeq.current;
    setProbing(true);
    setProbeError(null);
    try {
      const result = await window.desktopApi.kubeProbe(probeRequest);
      if (seq !== probeSeq.current) return;
      setContexts(result.contexts);
      setCurrentContext(result.currentContext);
      setExecCommands(result.execCommands ?? {});
      if (direct && !fields.context.trim() && result.currentContext) onChange({ context: result.currentContext, execConsent: '' });
    } catch (caught) {
      if (seq !== probeSeq.current) return;
      setContexts([]);
      setCurrentContext(undefined);
      setExecCommands({});
      setProbeError(errorText(caught, t('connection:cluster.context.readFailed')));
    } finally { setProbing(false); }
  }

  async function pickFile(): Promise<void> {
    setPickError(false);
    try {
      const result = await window.desktopApi.kubeSelectConfigFile();
      if (!result.canceled) onChange({ kubeconfigPath: result.filePath, execConsent: '' });
    } catch { setPickError(true); }
  }

  // Login-program approval applies to pasted kubeconfigs only; a file runs without it.
  const execCommand = source === 'inline'
    ? execCommands[fields.context.trim() || currentContext || ''] ?? (fields.execConsent || undefined) : undefined;

  const fieldError = (field: keyof ConnectionFields) => error?.field === field
    ? <p className="field-error" id={`${idPrefix}-${field}-error`} role="alert">{error.message}</p> : null;

  return (
    <>
      <fieldset>
        <legend>{t('connection:cluster.access.mode.legend')}</legend>
        <label className="editor-checkbox"><input type="radio" name={`${idPrefix}-access`} value="ssh" checked={!direct} disabled={busy}
          onChange={() => { setReplacing(false); onChange({ kubeconfigSource: 'auto', kubeconfigPath: '', execConsent: '' }); }} />{t('connection:cluster.access.mode.ssh')}</label>
        <label className="editor-checkbox"><input type="radio" name={`${idPrefix}-access`} value="direct" checked={direct} disabled={busy}
          onChange={() => { setReplacing(false); onChange({ kubeconfigSource: 'inline', kubeconfigPath: '', execConsent: '' }); }} />{t('connection:cluster.access.mode.direct')}</label>
        {direct && <p className="editor-hint">{t('connection:cluster.access.mode.directHint')}</p>}
      </fieldset>

      {!direct && <>
        <fieldset>
          <legend>{t('connection:cluster.access.legend')}</legend>
          <p className="editor-hint">{t('connection:cluster.access.hint')}</p>
          {fields.accessHosts.length > 0 && <ol className="cluster-access-list">
            {fields.accessHosts.map((id, index) => {
              const node = connections.find(candidate => candidate.id === id);
              const label = node ? `${node.name} (${node.protocol === 'ssh' ? node.host : id})` : t('connection:cluster.access.missing', { id });
              return <li key={id}>
                <span>{label}</span>
                <button className="secondary-button" type="button" disabled={busy || index === 0} aria-label={t('connection:cluster.access.up', { label })} onClick={() => move(index, -1)}>↑</button>
                <button className="secondary-button" type="button" disabled={busy || index === fields.accessHosts.length - 1} aria-label={t('connection:cluster.access.down', { label })} onClick={() => move(index, 1)}>↓</button>
                <button className="secondary-button" type="button" disabled={busy} aria-label={t('connection:cluster.access.remove', { label })}
                  onClick={() => onChange({ accessHosts: fields.accessHosts.filter(host => host !== id) })}>{t('common:actions.remove')}</button>
              </li>;
            })}
          </ol>}
          {fieldError('accessHosts')}
          <div className="editor-field">
            <label htmlFor={`${idPrefix}-add-host`}>{t('connection:cluster.access.add')}</label>
            <select id={`${idPrefix}-add-host`} value="" disabled={busy || choices.length === 0}
              onChange={event => { if (event.target.value) onChange({ accessHosts: [...fields.accessHosts, event.target.value] }); }}>
              <option value="">{choices.length > 0 ? t('connection:cluster.access.choose') : t('connection:cluster.access.noneLeft')}</option>
              {choices.map(node => <option key={node.id} value={node.id}>{node.name}</option>)}
            </select>
          </div>
        </fieldset>

        <fieldset>
          <legend>{t('connection:cluster.kubeconfig.legend')}</legend>
          <label className="editor-checkbox"><input type="radio" name={`${idPrefix}-kubeconfig`} value="auto" checked={source === 'auto'} disabled={busy}
            onChange={() => onChange({ kubeconfigSource: 'auto' })} />{t('connection:cluster.kubeconfig.auto')}</label>
          <label className="editor-checkbox"><input type="radio" name={`${idPrefix}-kubeconfig`} value="path" checked={source === 'path'} disabled={busy}
            onChange={() => onChange({ kubeconfigSource: 'path' })} />{t('connection:cluster.kubeconfig.path')}</label>
          {source === 'path' && <div className="editor-field">
            <label htmlFor={`${idPrefix}-kubeconfigPath`}>{t('connection:cluster.kubeconfig.pathLabel')}</label>
            <input id={`${idPrefix}-kubeconfigPath`} type="text" value={fields.kubeconfigPath} disabled={busy} autoComplete="off" spellCheck={false}
              placeholder="/home/admin/.kube/config" aria-invalid={error?.field === 'kubeconfigPath' || undefined}
              aria-describedby={error?.field === 'kubeconfigPath' ? `${idPrefix}-kubeconfigPath-error` : undefined}
              onChange={event => onChange({ kubeconfigPath: event.target.value })} />
            {fieldError('kubeconfigPath')}
          </div>}
        </fieldset>
      </>}

      {direct && <fieldset>
        <legend>{t('connection:cluster.kubeconfig.legend')}</legend>
        <label className="editor-checkbox"><input type="radio" name={`${idPrefix}-kubeconfig`} value="inline" checked={source === 'inline'} disabled={busy}
          onChange={() => onChange({ kubeconfigSource: 'inline', execConsent: '' })} />{t('connection:cluster.kubeconfig.inline')}</label>
        <label className="editor-checkbox"><input type="radio" name={`${idPrefix}-kubeconfig`} value="file" checked={source === 'file'} disabled={busy}
          onChange={() => { setReplacing(false); onChange({ kubeconfigSource: 'file', execConsent: '' }); }} />{t('connection:cluster.kubeconfig.file')}</label>
        {source === 'inline' && (!fields.kubeconfigText || replacing ? <div className="editor-field">
          <label htmlFor={`${idPrefix}-kubeconfigText`}>{t('connection:cluster.kubeconfig.textLabel')}</label>
          <textarea id={`${idPrefix}-kubeconfigText`} rows={8} spellCheck={false} autoComplete="off" value={fields.kubeconfigText} disabled={busy}
            placeholder={'apiVersion: v1\nkind: Config\n…'} aria-invalid={error?.field === 'kubeconfigText' || undefined}
            aria-describedby={error?.field === 'kubeconfigText' ? `${idPrefix}-kubeconfigText-error` : undefined}
            onChange={event => onChange({ kubeconfigText: event.target.value, execConsent: '' })} />
          <p className="editor-hint">{t('connection:cluster.kubeconfig.textHint')}</p>
          {fieldError('kubeconfigText')}
        </div> : <div className="editor-field">
          <p className="editor-hint">{t('connection:cluster.kubeconfig.stored', { count: fields.kubeconfigText.length })}</p>
          <button className="secondary-button" type="button" disabled={busy}
            onClick={() => { setReplacing(true); onChange({ kubeconfigText: '', execConsent: '' }); }}>{t('connection:cluster.kubeconfig.replace')}</button>
        </div>)}
        {source === 'file' && <div className="editor-field">
          <label htmlFor={`${idPrefix}-kubeconfigPath`}>{t('connection:cluster.kubeconfig.fileLabel')}</label>
          <div className="editor-input-group">
            <input id={`${idPrefix}-kubeconfigPath`} type="text" value={fields.kubeconfigPath} disabled={busy} autoComplete="off" spellCheck={false}
              placeholder="~/.kube/config" aria-invalid={error?.field === 'kubeconfigPath' || undefined}
              aria-describedby={error?.field === 'kubeconfigPath' ? `${idPrefix}-kubeconfigPath-error` : undefined}
              onChange={event => onChange({ kubeconfigPath: event.target.value })} />
            <button className="secondary-button" type="button" disabled={busy} onClick={() => { void pickFile(); }}>{t('connection:cluster.kubeconfig.pickFile')}</button>
          </div>
          <p className="editor-hint">{t('connection:cluster.kubeconfig.fileHint')}</p>
          {pickError && <p className="field-error" role="alert">{t('connection:cluster.kubeconfig.pickFailed')}</p>}
          {fieldError('kubeconfigPath')}
        </div>}
      </fieldset>}

      <div className="editor-field">
        <label htmlFor={`${idPrefix}-context`}>{t('connection:cluster.context.label')}</label>
        <div className="editor-input-group">
          <input id={`${idPrefix}-context`} type="text" list={`${idPrefix}-contexts`} placeholder="current-context" value={fields.context}
            disabled={busy} autoComplete="off" spellCheck={false} onChange={event => onChange({ context: event.target.value, execConsent: '' })} />
          <button className="secondary-button" type="button" disabled={busy || probing || !probeRequest} onClick={() => { void readContexts(); }}>
            {probing ? t('connection:cluster.context.reading') : t('connection:cluster.context.read')}</button>
        </div>
        <datalist id={`${idPrefix}-contexts`}>{contexts.map(name => <option key={name} value={name} />)}</datalist>
        {probeError && <p className="field-error" role="alert">{probeError}</p>}
        {execCommand && <>
          <label className="editor-checkbox"><input id={`${idPrefix}-execConsent`} type="checkbox" checked={fields.execConsent === execCommand} disabled={busy}
            onChange={event => onChange({ execConsent: event.target.checked ? execCommand : '' })} />{t('connection:cluster.context.execConsent', { command: execCommand })}</label>
          <p className="editor-hint">{t('connection:cluster.context.execHint')}</p>
        </>}
      </div>

      <div className="editor-field">
        <label htmlFor={`${idPrefix}-namespace`}>{t('connection:cluster.namespace.label')}</label>
        <input id={`${idPrefix}-namespace`} type="text" placeholder={t('connection:cluster.namespace.placeholder')} value={fields.namespace} disabled={busy} autoComplete="off" spellCheck={false}
          aria-invalid={error?.field === 'namespace' || undefined}
          aria-describedby={error?.field === 'namespace' ? `${idPrefix}-namespace-error` : undefined}
          onChange={event => onChange({ namespace: event.target.value })} />
        {fieldError('namespace')}
      </div>

      <fieldset>
        <legend>{t('connection:cluster.links.legend')}</legend>
        <p className="editor-hint">{t('connection:cluster.links.hint')}</p>
        {(Object.keys(LINK_FIELDS) as (keyof typeof LINK_FIELDS)[]).map(field => <div className="editor-field" key={field}>
          <label htmlFor={`${idPrefix}-${field}`}>{t(LINK_FIELDS[field].label)}</label>
          <input id={`${idPrefix}-${field}`} type="url" inputMode="url" value={fields[field]} disabled={busy} autoComplete="off" spellCheck={false}
            placeholder={LINK_FIELDS[field].placeholder} aria-invalid={error?.field === field || undefined}
            aria-describedby={error?.field === field ? `${idPrefix}-${field}-error` : undefined}
            onChange={event => onChange(field === 'argoUrl' ? { argoUrl: event.target.value } : { harborUrl: event.target.value })} />
          {fieldError(field)}
        </div>)}
      </fieldset>

      <label className="editor-checkbox"><input type="checkbox" checked={fields.production === 'on'} disabled={busy}
        onChange={event => onChange({ production: event.target.checked ? 'on' : 'off' })} />{t('connection:cluster.production')}</label>
      <p className="editor-hint">{t('connection:cluster.productionHint')}</p>
      <label className="editor-checkbox"><input type="checkbox" checked={fields.readOnly === 'on'} disabled={busy}
        onChange={event => onChange({ readOnly: event.target.checked ? 'on' : 'off' })} />{t('connection:cluster.readOnly')}</label>
      <p className="editor-hint">{t('connection:cluster.readOnlyHint')}</p>
    </>
  );
}
