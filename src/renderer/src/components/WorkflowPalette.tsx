import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Workflow } from '../../../shared/vault/types';
import type { TerminalTab } from '../terminal-tabs';
import { shellOf, tabLabel } from '../terminal-tabs';
import { fillWorkflow, searchWorkflows, workflowParams } from '../workflows';
import { useT } from '../i18n';
import { typeIntoTerminal } from '../terminal-input';
import { useNativeSurfaceBlock } from '../native-surface';
import '../workflows-ui.css';

interface WorkflowPaletteProps {
  workflows: Workflow[];
  tabs: TerminalTab[];
  activeTabId: string | null;
  onClose: () => void;
  /** Main window only. */
  onManage?: () => void;
}

const shellLabels = { ssh: 'SSH', powershell: 'PowerShell', cmd: 'CMD' } as const;

/** Search saved commands, fill their placeholders and type them into the active terminal (without Enter). */
export function WorkflowPalette({ workflows, tabs, activeTabId, onClose, onManage }: WorkflowPaletteProps) {
  const { t } = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<{ workflow: Workflow; values: Record<string, string> } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useNativeSurfaceBlock(true);
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  const tab = tabs.find(item => item.id === activeTabId);
  const shell = shellOf(tab);
  const results = useMemo(() => searchWorkflows(workflows, query, shell), [workflows, query, shell]);
  useEffect(() => setIndex(0), [query]);

  const type = (command: string): void => {
    void typeIntoTerminal(tab, command).then(result => {
      if ('typed' in result) onClose();
      else setMessage(result.reason);
    });
  };
  const choose = (workflow: Workflow | undefined): void => {
    if (!workflow) return;
    setMessage(null);
    const params = workflowParams(workflow.command);
    if (params.length) setChosen({ workflow, values: Object.fromEntries(params.map(name => [name, ''])) });
    else type(workflow.command);
  };
  const preview = chosen ? fillWorkflow(chosen.workflow.command, chosen.values) : '';

  return (
    <dialog ref={dialogRef} className="workflow-palette" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); if (chosen) setChosen(null); else onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <h2 id={`${id}-title`} className="workflow-title">{t('workflows:title')}{tab && shell ? <small> → {tabLabel(tab, tabs)}</small> : <small> · {t('workflows:palette.noTerminal')}</small>}</h2>
      {!chosen ? <>
        <input autoFocus className="workflow-search" type="search" placeholder={t('workflows:palette.searchPlaceholder')} value={query} aria-label={t('workflows:palette.searchLabel')}
          aria-controls={`${id}-list`} aria-activedescendant={results[index] ? `${id}-${results[index].id}` : undefined}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(value => Math.min(results.length - 1, value + 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(value => Math.max(0, value - 1)); }
            if (event.key === 'Enter') { event.preventDefault(); choose(results[index]); }
          }} />
        <ul id={`${id}-list`} className="workflow-list" role="listbox" aria-label={t('workflows:title')}>
          {results.map((workflow, position) => <li key={workflow.id} id={`${id}-${workflow.id}`} role="option" aria-selected={position === index}
            className={workflow.shell && shell && workflow.shell !== shell ? 'is-other-shell' : undefined}
            onMouseEnter={() => setIndex(position)} onClick={() => choose(workflow)}>
            <div className="workflow-row-head"><strong>{workflow.name}</strong>
              {workflow.shell && <span className="workflow-badge">{shellLabels[workflow.shell]}</span>}
              {workflow.tags.map(tag => <span key={tag} className="workflow-tag">{tag}</span>)}</div>
            <code>{workflow.command}</code>
            {workflow.description && <small>{workflow.description}</small>}
          </li>)}
          {!results.length && <li className="workflow-empty">{workflows.length ? t('workflows:palette.noMatch') : t('workflows:palette.noneSaved')}</li>}
        </ul>
      </> : <form className="workflow-params" onSubmit={event => { event.preventDefault(); type(preview); }}>
        <p><strong>{chosen.workflow.name}</strong>{chosen.workflow.description && <> · {chosen.workflow.description}</>}</p>
        {Object.keys(chosen.values).map((name, position) => <label key={name}>{name}
          <input autoFocus={position === 0} value={chosen.values[name]} spellCheck={false}
            onChange={event => setChosen({ ...chosen, values: { ...chosen.values, [name]: event.target.value } })} /></label>)}
        <code className="workflow-preview">{preview}</code>
        <div className="workflow-actions">
          <button type="button" className="secondary-button" onClick={() => setChosen(null)}>{t('workflows:dialog.back')}</button>
          <button type="button" className="secondary-button" onClick={() => void window.desktopApi.writeClipboardText(preview).then(onClose).catch(() => setMessage(t('workflows:palette.copyFailed')))}>{t('common:actions.copy')}</button>
          <button type="submit" className="primary-button" disabled={!shell}>{t('workflows:palette.type')}</button>
        </div>
      </form>}
      {message && <p className="field-error" role="alert">{message}</p>}
      <footer className="workflow-footer">
        <span>{t('workflows:palette.hints')}</span>
        {onManage && <button type="button" className="secondary-button" onClick={onManage}>{t('workflows:palette.manage')}</button>}
      </footer>
    </dialog>
  );
}
