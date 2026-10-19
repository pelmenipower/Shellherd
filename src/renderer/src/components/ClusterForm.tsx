import { useEffect, useState } from 'react';
import type { VaultNode } from '../../../shared/vault/types';
import { flattenConnections } from '../cluster-form';
import type { ConnectionFields } from '../connection-form';
import { errorText } from '../error-text';

interface ClusterFormProps {
  /** Prefix for element ids, shared with the surrounding ConnectionForm. */
  idPrefix: string;
  fields: ConnectionFields;
  nodes: VaultNode[];
  busy: boolean;
  error: { field?: keyof ConnectionFields; message: string } | null;
  onChange: (patch: Partial<ConnectionFields>) => void;
}

/** Cluster-specific fields; name, symbol, color, tags and comment come from ConnectionForm. */
export function ClusterForm({ idPrefix, fields, nodes, busy, error, onChange }: ClusterFormProps) {
  const [contexts, setContexts] = useState<string[]>([]);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const firstHost = fields.accessHosts[0];
  // Contexts belong to the access host they were read from.
  useEffect(() => { setContexts([]); setProbeError(null); }, [firstHost]);

  const connections = flattenConnections(nodes);
  const choices = connections.filter(node => node.protocol === 'ssh' && !node.disabled && !fields.accessHosts.includes(node.id));

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= fields.accessHosts.length) return;
    const hosts = [...fields.accessHosts];
    [hosts[index], hosts[target]] = [hosts[target], hosts[index]];
    onChange({ accessHosts: hosts });
  }

  async function readContexts(): Promise<void> {
    if (!firstHost || probing) return;
    setProbing(true);
    setProbeError(null);
    try {
      const result = await window.desktopApi.kubeProbe({ connectionId: firstHost });
      setContexts(result.contexts);
    } catch (caught) {
      setContexts([]);
      setProbeError(errorText(caught, 'Die Contexts konnten nicht gelesen werden.'));
    } finally { setProbing(false); }
  }

  const fieldError = (field: keyof ConnectionFields) => error?.field === field
    ? <p className="field-error" id={`${idPrefix}-${field}-error`} role="alert">{error.message}</p> : null;

  return (
    <>
      <fieldset>
        <legend>Zugang über SSH</legend>
        <p className="editor-hint">Die erste erreichbare Verbindung baut den Tunnel auf.</p>
        {fields.accessHosts.length > 0 && <ol className="cluster-access-list">
          {fields.accessHosts.map((id, index) => {
            const node = connections.find(candidate => candidate.id === id);
            const label = node ? `${node.name} (${node.protocol === 'ssh' ? node.host : id})` : `${id} (nicht mehr vorhanden)`;
            return <li key={id}>
              <span>{label}</span>
              <button className="secondary-button" type="button" disabled={busy || index === 0} aria-label={`${label} nach oben`} onClick={() => move(index, -1)}>↑</button>
              <button className="secondary-button" type="button" disabled={busy || index === fields.accessHosts.length - 1} aria-label={`${label} nach unten`} onClick={() => move(index, 1)}>↓</button>
              <button className="secondary-button" type="button" disabled={busy} aria-label={`${label} entfernen`}
                onClick={() => onChange({ accessHosts: fields.accessHosts.filter(host => host !== id) })}>Entfernen</button>
            </li>;
          })}
        </ol>}
        {fieldError('accessHosts')}
        <div className="editor-field">
          <label htmlFor={`${idPrefix}-add-host`}>SSH-Verbindung hinzufügen</label>
          <select id={`${idPrefix}-add-host`} value="" disabled={busy || choices.length === 0}
            onChange={event => { if (event.target.value) onChange({ accessHosts: [...fields.accessHosts, event.target.value] }); }}>
            <option value="">{choices.length > 0 ? 'Auswählen …' : 'Keine weiteren SSH-Verbindungen'}</option>
            {choices.map(node => <option key={node.id} value={node.id}>{node.name}</option>)}
          </select>
        </div>
      </fieldset>

      <fieldset>
        <legend>Kubeconfig</legend>
        <label className="editor-checkbox"><input type="radio" name={`${idPrefix}-kubeconfig`} value="auto" checked={fields.kubeconfigSource === 'auto'} disabled={busy}
          onChange={() => onChange({ kubeconfigSource: 'auto' })} />Automatisch (KUBECONFIG, ~/.kube/config, /etc/kubernetes/admin.conf)</label>
        <label className="editor-checkbox"><input type="radio" name={`${idPrefix}-kubeconfig`} value="path" checked={fields.kubeconfigSource === 'path'} disabled={busy}
          onChange={() => onChange({ kubeconfigSource: 'path' })} />Pfad auf dem Host</label>
        {fields.kubeconfigSource === 'path' && <div className="editor-field">
          <label htmlFor={`${idPrefix}-kubeconfigPath`}>Kubeconfig-Pfad auf dem Host</label>
          <input id={`${idPrefix}-kubeconfigPath`} type="text" value={fields.kubeconfigPath} disabled={busy} autoComplete="off" spellCheck={false}
            placeholder="/home/admin/.kube/config" aria-invalid={error?.field === 'kubeconfigPath' || undefined}
            aria-describedby={error?.field === 'kubeconfigPath' ? `${idPrefix}-kubeconfigPath-error` : undefined}
            onChange={event => onChange({ kubeconfigPath: event.target.value })} />
          {fieldError('kubeconfigPath')}
        </div>}
      </fieldset>

      <div className="editor-field">
        <label htmlFor={`${idPrefix}-context`}>Context</label>
        <div className="editor-input-group">
          <input id={`${idPrefix}-context`} type="text" list={`${idPrefix}-contexts`} placeholder="current-context" value={fields.context}
            disabled={busy} autoComplete="off" spellCheck={false} onChange={event => onChange({ context: event.target.value })} />
          <button className="secondary-button" type="button" disabled={busy || probing || !firstHost} onClick={() => { void readContexts(); }}>
            {probing ? 'Liest …' : 'Contexts lesen'}</button>
        </div>
        <datalist id={`${idPrefix}-contexts`}>{contexts.map(name => <option key={name} value={name} />)}</datalist>
        {probeError && <p className="field-error" role="alert">{probeError}</p>}
      </div>

      <div className="editor-field">
        <label htmlFor={`${idPrefix}-namespace`}>Namespace</label>
        <input id={`${idPrefix}-namespace`} type="text" placeholder="alle Namespaces" value={fields.namespace} disabled={busy} autoComplete="off" spellCheck={false}
          aria-invalid={error?.field === 'namespace' || undefined}
          aria-describedby={error?.field === 'namespace' ? `${idPrefix}-namespace-error` : undefined}
          onChange={event => onChange({ namespace: event.target.value })} />
        {fieldError('namespace')}
      </div>

      <label className="editor-checkbox"><input type="checkbox" checked={fields.production === 'on'} disabled={busy}
        onChange={event => onChange({ production: event.target.checked ? 'on' : 'off' })} />Produktion</label>
      <p className="editor-hint">Aktionen verlangen das Eintippen des Namens.</p>
      <label className="editor-checkbox"><input type="checkbox" checked={fields.readOnly === 'on'} disabled={busy}
        onChange={event => onChange({ readOnly: event.target.checked ? 'on' : 'off' })} />Nur lesen</label>
      <p className="editor-hint">Keine Aktionen und keine Shell, Logs bleiben erlaubt.</p>
    </>
  );
}
