import { useEffect, useId, useRef, useState } from 'react';
import type { Workflow } from '../../../shared/vault/types';
import { WorkflowSchema } from '../../../shared/vault/schema';
import { workflowParams } from '../workflows';
import { useNativeSurfaceBlock } from '../native-surface';
import '../workflows-ui.css';
import '../assistant-ui.css';

interface WorkflowsDialogProps {
  workflows: Workflow[];
  busy: boolean;
  /** Opens directly in the form, e.g. with a command suggested by the assistant. */
  initial?: Partial<Workflow>;
  onSave: (workflows: Workflow[]) => Promise<boolean>;
  onClose: () => void;
}

interface Draft { id: string; name: string; command: string; description: string; tags: string; shell: '' | 'ssh' | 'powershell' | 'cmd' }

const toDraft = (workflow: Partial<Workflow>): Draft => ({ id: workflow.id ?? crypto.randomUUID(), name: workflow.name ?? '', command: workflow.command ?? '',
  description: workflow.description ?? '', tags: workflow.tags?.join(', ') ?? '', shell: workflow.shell ?? '' });

/** Create, edit and delete saved commands. */
export function WorkflowsDialog({ workflows, busy, initial, onSave, onClose }: WorkflowsDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft | null>(initial ? toDraft(initial) : null);
  const [error, setError] = useState<string | null>(null);
  useNativeSurfaceBlock(true);
  useEffect(() => { dialogRef.current?.showModal(); }, []);

  const submit = async (): Promise<void> => {
    if (!draft) return;
    const candidate = { id: draft.id, name: draft.name.trim(), command: draft.command.trim(),
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      tags: [...new Set(draft.tags.split(',').map(tag => tag.trim()).filter(Boolean))], ...(draft.shell ? { shell: draft.shell } : {}) };
    const result = WorkflowSchema.safeParse(candidate);
    if (!result.success) { setError(/[\r\n]/.test(candidate.command) ? 'Ein Workflow ist eine Zeile. Verbinde mehrere Befehle mit && oder ;.' : 'Bitte gib Name und Befehl an.'); return; }
    const next = workflows.some(item => item.id === result.data.id) ? workflows.map(item => item.id === result.data.id ? result.data : item) : [...workflows, result.data];
    if (await onSave(next)) { setDraft(null); setError(null); } else setError('Speichern fehlgeschlagen.');
  };
  const set = (key: keyof Draft, value: string): void => { setDraft(current => current && { ...current, [key]: value }); setError(null); };

  return (
    <dialog ref={dialogRef} className="confirm-dialog workflows-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <h2 id={`${id}-title`}>Workflows</h2>
      {!draft ? <>
        <p className="ai-intro">Gespeicherte Befehle für die Palette (Strg+Umschalt+Leertaste). Platzhalter wie <code>{'{{host}}'}</code> werden beim Einfügen abgefragt.</p>
        <ul className="ai-provider-list">
          {workflows.map(workflow => <li key={workflow.id}>
            <div><strong>{workflow.name}</strong><small className="workflow-mono">{workflow.command}</small></div>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setDraft(toDraft(workflow))}>Bearbeiten</button>
            <button type="button" className="danger-button" disabled={busy} onClick={() => void onSave(workflows.filter(item => item.id !== workflow.id))}>Löschen</button>
          </li>)}
          {!workflows.length && <li className="workflow-empty">Noch keine Workflows.</li>}
        </ul>
        <div className="form-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setDraft(toDraft({}))}>Neuer Workflow</button>
          <button type="button" className="primary-button" disabled={busy} onClick={onClose}>Fertig</button>
        </div>
      </> : <form className="ai-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label className="ai-field"><span>Name</span><input autoFocus value={draft.name} onChange={event => set('name', event.target.value)} /></label>
        <label className="ai-field"><span>Befehl (eine Zeile)</span><input className="workflow-mono" spellCheck={false} value={draft.command} onChange={event => set('command', event.target.value)} />
          <small>{workflowParams(draft.command).length ? `Platzhalter: ${workflowParams(draft.command).join(', ')}` : 'Platzhalter mit {{name}} markieren, z. B. ssh {{user}}@{{host}}'}</small></label>
        <label className="ai-field"><span>Beschreibung (optional)</span><input value={draft.description} onChange={event => set('description', event.target.value)} /></label>
        <div className="workflow-form-row">
          <label className="ai-field"><span>Tags (durch Komma getrennt)</span><input value={draft.tags} onChange={event => set('tags', event.target.value)} /></label>
          <label className="ai-field"><span>Für Shell</span><select value={draft.shell} onChange={event => set('shell', event.target.value)}>
            <option value="">Alle</option><option value="ssh">SSH</option><option value="powershell">PowerShell</option><option value="cmd">CMD</option></select></label>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => { if (initial) onClose(); else setDraft(null); }}>{initial ? 'Abbrechen' : 'Zurück'}</button>
          <button type="submit" className="primary-button" disabled={busy}>Speichern</button>
        </div>
      </form>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </dialog>
  );
}
