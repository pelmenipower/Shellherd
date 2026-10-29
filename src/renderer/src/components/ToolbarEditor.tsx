import { useEffect, useRef, useState } from 'react';
import { ToolbarConfigSchema, type ToolbarConfig, type ToolbarItem, type ToolbarStyle } from '../../../shared/toolbar';
import { RemoteCommandInput } from './RemoteCommandInput';
import { ToolbarIcon } from './ToolbarIcon';
import { ToolbarIconPicker } from './ToolbarIconPicker';
import { useT } from '../i18n';
import { useNativeSurfaceBlock } from '../native-surface';

export function newToolbarItem(connectionId: string): ToolbarItem {
  return { id: crypto.randomUUID(), kind: 'command', name: '', description: '', command: '', connectionId, enabled: true, showText: true,
    confirm: false, icon: 'terminal', color: '#8b949e', text: '', trigger: 'click', intervalMs: 30_000, timeoutMs: 10_000, mappings: [],
    unknown: { icon: 'warning', color: '#8b949e', text: '?' } };
}
interface Props { sessionId?: string; config: ToolbarConfig; connectionId: string; connectionName: string; initial?: ToolbarItem; save: (config: ToolbarConfig) => Promise<boolean>; close: () => void }
export function ToolbarEditor({ sessionId, config, connectionId, connectionName, initial, save, close }: Props) {
  const { t } = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<ToolbarItem>(() => structuredClone(initial ?? newToolbarItem(connectionId)));
  const [mode, setMode] = useState(config.mode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useNativeSurfaceBlock(true);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const set = <K extends keyof ToolbarItem>(key: K, value: ToolbarItem[K]): void => { setDraft(current => ({ ...current, [key]: value })); setError(''); };
  const styleFields = (value: ToolbarStyle, update: (value: ToolbarStyle) => void) => <div className="toolbar-style-fields">
    <ToolbarIconPicker value={value.icon} onChange={icon => update({ ...value, icon })} />
    <label>{t('toolbar:color')}<input type="color" value={value.color} onChange={e => update({ ...value, color: e.target.value })} /></label>
    <label>{t('toolbar:text')}<input maxLength={80} value={value.text} onChange={e => update({ ...value, text: e.target.value })} /></label>
    <span className="toolbar-preview" style={{ color: value.color }}><ToolbarIcon icon={value.icon} />{value.text}</span>
  </div>;
  const submit = async (): Promise<void> => {
    const item = { ...draft, name: draft.name.trim(), confirm: draft.kind === 'command' && draft.confirm };
    const next = { mode, items: config.items.some(candidate => candidate.id === item.id) ? config.items.map(candidate => candidate.id === item.id ? item : candidate) : [...config.items, item] };
    const parsed = ToolbarConfigSchema.safeParse(next);
    if (!parsed.success) { setError(t('toolbar:invalid')); return; }
    setBusy(true);
    try { if (await save(parsed.data)) close(); else setError(t('toolbar:saveFailed')); }
    catch { setError(t('toolbar:saveFailed')); } finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="confirm-dialog toolbar-editor" onCancel={e => { e.preventDefault(); if (!busy) close(); }} aria-labelledby="toolbar-editor-title">
    <h2 id="toolbar-editor-title">{initial ? t('toolbar:edit') : t('toolbar:add')}</h2>
    <form onSubmit={e => { e.preventDefault(); void submit(); }}>
      <fieldset disabled={busy}>
        <label>{t('toolbar:mode')}<select aria-label={t('toolbar:mode')} value={mode} onChange={e => setMode(e.target.value as ToolbarConfig['mode'])}><option value="type">{t('toolbar:modeType')}</option><option value="execute">{t('toolbar:modeExecute')}</option></select><small>{t('toolbar:modeHint')}</small></label>
        <div className="toolbar-form-row">
          <label>{t('toolbar:name')}<input autoFocus required maxLength={120} value={draft.name} onChange={e => set('name', e.target.value)} /></label>
          <label>{t('toolbar:kind')}<select aria-label={t('toolbar:kind')} value={draft.kind} onChange={e => set('kind', e.target.value as ToolbarItem['kind'])}><option value="command">{t('toolbar:commandButton')}</option><option value="status">{t('toolbar:dynamicDisplay')}</option></select></label>
        </div>
        <label>{t('toolbar:scope')}<select aria-label={t('toolbar:scope')} value={draft.connectionId ?? ''} onChange={e => set('connectionId', e.target.value || undefined)}><option value="">{t('toolbar:allConnections')}</option><option value={connectionId}>{connectionName}</option></select></label>
        <RemoteCommandInput sessionId={sessionId} label={draft.kind === 'status' ? t('toolbar:checkCommand') : t('toolbar:command')} value={draft.command} onChange={value => set('command', value)} />
        <label>{t('toolbar:description')}<input maxLength={1000} value={draft.description} onChange={e => set('description', e.target.value)} /></label>
        <div className="toolbar-form-row"><label className="toolbar-checkbox"><input type="checkbox" checked={draft.enabled} onChange={e => set('enabled', e.target.checked)} />{t('toolbar:enabled')}</label><label className="toolbar-checkbox"><input type="checkbox" checked={draft.showText} onChange={e => set('showText', e.target.checked)} />{t('toolbar:showText')}</label></div>
        {draft.kind === 'command' ? <>
          <label className="toolbar-checkbox"><input type="checkbox" checked={draft.confirm} onChange={e => set('confirm', e.target.checked)} />{t('toolbar:confirmBefore')}</label>
          {styleFields(draft, value => setDraft(current => ({ ...current, ...value })))}
        </> : <>
          <p>{t('toolbar:dynamicHint')}</p>
          <p>{t('toolbar:contract')}</p><code>{'{"value":"banana","message":"Optional"}'}</code>
          <div className="toolbar-form-row">
            <label>{t('toolbar:trigger')}<select aria-label={t('toolbar:trigger')} value={draft.trigger} onChange={e => set('trigger', e.target.value as ToolbarItem['trigger'])}><option value="click">{t('toolbar:click')}</option><option value="interval">{t('toolbar:interval')}</option><option value="both">{t('toolbar:both')}</option></select></label>
            <label>{t('toolbar:intervalMs')}<input type="number" required min={100} max={86400000} step={1} value={draft.intervalMs} onChange={e => set('intervalMs', e.target.valueAsNumber)} /></label>
            <label>{t('toolbar:timeoutMs')}<input type="number" required min={100} max={300000} step={1} value={draft.timeoutMs} onChange={e => set('timeoutMs', e.target.valueAsNumber)} /></label>
          </div>
          <h3>{t('toolbar:mappings')}</h3>
          {draft.mappings.map((row, index) => <div className="toolbar-mapping" key={index}>
            <label>{t('toolbar:value')}<input maxLength={1000} value={row.value} onChange={e => set('mappings', draft.mappings.map((candidate, i) => i === index ? { ...candidate, value: e.target.value } : candidate))} /></label>
            {styleFields(row, value => set('mappings', draft.mappings.map((candidate, i) => i === index ? { ...candidate, ...value } : candidate)))}
            <button type="button" className="secondary-button" onClick={() => set('mappings', draft.mappings.filter((_, i) => i !== index))}>{t('common:actions.delete')}</button>
          </div>)}
          <button type="button" className="secondary-button" disabled={draft.mappings.length >= 100} onClick={() => set('mappings', [...draft.mappings, { value: '', icon: 'check', color: '#3fb950', text: '' }])}>{t('toolbar:addMapping')}</button>
          <h3>{t('toolbar:unknown')}</h3>{styleFields(draft.unknown, value => set('unknown', value))}
        </>}
      </fieldset>
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={close}>{t('common:actions.cancel')}</button><button type="submit" className="primary-button" disabled={busy}>{t('common:actions.save')}</button></div>
    </form>
  </dialog>;
}
