import { useContext, useEffect, useRef, useState } from 'react';
import { toolbarItems, toolbarStyle, type ToolbarItem, type ToolbarResult } from '../../../shared/toolbar';
import { ToolbarContext } from '../toolbar-context';
import { ToolbarIcon } from './ToolbarIcon';
import { ToolbarEditor } from './ToolbarEditor';
import { ContextMenu } from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { useT } from '../i18n';
import '../toolbar-ui.css';

const errors = { exit: 'toolbar:errors.exit', 'invalid-json': 'toolbar:errors.invalidJson', timeout: 'toolbar:errors.timeout', 'output-limit': 'toolbar:errors.outputLimit', disconnected: 'toolbar:errors.disconnected', failed: 'toolbar:errors.failed' } as const;
interface Props { connectionId: string; connectionName: string; sessionId?: string; connected: boolean; input: (command: string) => Promise<void> }
export function TerminalToolbar({ connectionId, connectionName, sessionId, connected, input }: Props) {
  const { t } = useT();
  const { config, active, saving = false, save } = useContext(ToolbarContext);
  const [results, setResults] = useState<Record<string, ToolbarResult>>({});
  const [editor, setEditor] = useState<{ initial?: ToolbarItem } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: ToolbarItem } | null>(null);
  const [confirm, setConfirm] = useState<ToolbarItem | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const drag = useRef<string | null>(null);
  const previousSession = useRef(sessionId);
  const items = toolbarItems(config, connectionId);
  const checksKey = JSON.stringify(items.filter(item => item.kind === 'status'));
  useEffect(() => {
    if (previousSession.current !== sessionId) { setResults({}); previousSession.current = sessionId; }
    if (!active || saving || !connected || !sessionId || !items.some(item => item.kind === 'status' && item.enabled)) return;
    let live = true;
    const unsubscribe = window.desktopApi.onSshEvent(event => {
      if (live && event.type === 'toolbar' && event.sessionId === sessionId) setResults(current => ({ ...current, [event.result.itemId]: { ...event.result, lastSuccess: event.result.lastSuccess ?? current[event.result.itemId]?.lastSuccess } }));
    });
    void window.desktopApi.sshToolbar({ sessionId, action: 'start' }).catch(() => { if (live) setError(t('toolbar:errors.failed')); });
    return () => { live = false; unsubscribe(); void window.desktopApi.sshToolbar({ sessionId, action: 'stop' }).catch(() => {}); };
  }, [active, saving, connected, sessionId, checksKey]);
  useEffect(() => { if (!active) { setEditor(null); setMenu(null); setConfirm(null); setError(''); } }, [active]);
  const update = async (next: typeof config): Promise<void> => {
    if (!save || busy) return;
    setBusy(true);
    try { if (!await save(next)) setError(t('toolbar:saveFailed')); } catch { setError(t('toolbar:saveFailed')); } finally { setBusy(false); }
  };
  const run = async (item: ToolbarItem): Promise<void> => {
    if (!active || saving || !connected || !item.enabled || !sessionId) return;
    setError('');
    try {
      if (item.kind === 'status') await window.desktopApi.sshToolbar({ sessionId, action: 'check', itemId: item.id });
      else await input(item.command + (config.mode === 'execute' ? '\r' : ''));
    } catch { setError(t('toolbar:errors.failed')); }
  };
  const move = (from: string, to: string): void => {
    if (from === to) return;
    const source = config.items.find(item => item.id === from);
    if (!source) return;
    const reordered = config.items.filter(item => item.id !== from);
    reordered.splice(reordered.findIndex(item => item.id === to), 0, source);
    void update({ ...config, items: reordered });
  };
  return <>
    <div className="terminal-toolbar" role="toolbar" aria-label={t('toolbar:title')}>
      <div className="toolbar-items">
        {items.map(item => {
          const previous = results[item.id];
          const result: ToolbarResult | undefined = active && connected ? previous : previous ? { ...previous, state: 'error', error: 'disconnected' } : undefined;
          const appearance = toolbarStyle(item, result);
          const tooltip = [item.name, item.description, item.command,
            !item.enabled ? t('toolbar:disabled') : item.kind === 'command' ? (config.mode === 'execute' ? t('toolbar:modeExecute') : t('toolbar:modeType')) :
              !active || !connected ? t('toolbar:errors.disconnected') : result?.state === 'checking' ? t('toolbar:checking') : result?.error ? t(errors[result.error]) : result?.value ?? t('toolbar:notChecked'),
            result?.message, result?.detail,
            result?.checkedAt ? t('toolbar:checkedAt', { time: new Date(result.checkedAt).toLocaleTimeString() }) : '',
            result?.lastSuccess ? t('toolbar:lastSuccess', { time: new Date(result.lastSuccess).toLocaleTimeString() }) : ''].filter(Boolean).join('\n');
          return <button type="button" key={item.id} className={`toolbar-item${!item.enabled ? ' is-disabled' : ''}`} title={tooltip} aria-label={item.name}
            aria-disabled={!active || saving || !connected || !item.enabled || result?.state === 'checking' || item.kind === 'status' && item.trigger === 'interval'}
            style={{ color: item.enabled ? appearance.color : undefined }} draggable={!!save && !busy}
            onDragStart={e => { e.stopPropagation(); drag.current = item.id; e.dataTransfer.setData('text/shellherd-toolbar', item.id); }}
            onDragEnd={() => { drag.current = null; }} onDragOver={e => { if (save && drag.current) { e.preventDefault(); e.stopPropagation(); } }}
            onDrop={e => { if (save && drag.current) { e.preventDefault(); e.stopPropagation(); move(drag.current, item.id); drag.current = null; } }}
            onClick={() => { if (item.kind === 'status' && (item.trigger === 'interval' || result?.state === 'checking')) return; if (!active || saving || !connected || !item.enabled) return; if (item.kind === 'command' && item.confirm) setConfirm(item); else void run(item); }}
            onContextMenu={e => { if (!save) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, item }); }}>
            <ToolbarIcon icon={appearance.icon} />{item.showText && <span>{appearance.text || item.name}</span>}
          </button>;
        })}
        {!items.length && <span className="toolbar-empty">{t('toolbar:empty')}</span>}
      </div>
      <div className="toolbar-controls">
      <button type="button" className="toolbar-add" disabled={!save || !active || saving || busy || config.items.length >= 64} title={save ? t('toolbar:add') : t('toolbar:mainWindow')} aria-label={t('toolbar:add')} onClick={() => setEditor({})}>＋</button>
      {save && <button type="button" role="switch" aria-checked={config.mode === 'execute'} className="toolbar-settings" disabled={!active || saving || busy}
        title={`${t('toolbar:mode')}: ${config.mode === 'execute' ? t('toolbar:modeExecute') : t('toolbar:modeType')}`} aria-label={t('toolbar:mode')}
        onClick={() => void update({ ...config, mode: config.mode === 'type' ? 'execute' : 'type' })}>
        <svg className="toolbar-enter-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 5v9H5m5-5-5 5 5 5" /></svg>
        <span className="toolbar-switch-track" aria-hidden="true"><span className="toolbar-switch-thumb" /></span>
      </button>}
      </div>
    </div>
    {error && <div className="toolbar-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label={t('common:actions.close')}>×</button></div>}
    {editor && save && <ToolbarEditor sessionId={connected && active ? sessionId : undefined} config={config} connectionId={connectionId} connectionName={connectionName} initial={editor.initial} save={save} close={() => setEditor(null)} />}
    {confirm && <ConfirmDialog title={t('toolbar:confirmTitle', { name: connectionName })} description={`${config.mode === 'execute' ? t('toolbar:modeExecute') : t('toolbar:modeType')}\n${confirm.command}`} busy={false} onCancel={() => setConfirm(null)} onConfirm={() => { const item = confirm; setConfirm(null); void run(item); }} />}
    {menu && save && <ContextMenu x={menu.x} y={menu.y} label={menu.item.name} onClose={() => setMenu(null)} entries={[
      { kind: 'item', label: t('toolbar:edit'), onSelect: () => setEditor({ initial: menu.item }) },
      { kind: 'item', label: t('toolbar:duplicate'), disabled: config.items.length >= 64, onSelect: () => setEditor({ initial: { ...structuredClone(menu.item), id: crypto.randomUUID() } }) },
      { kind: 'item', label: menu.item.enabled ? t('toolbar:disable') : t('toolbar:enable'), onSelect: () => void update({ ...config, items: config.items.map(item => item.id === menu.item.id ? { ...item, enabled: !item.enabled } : item) }) },
      { kind: 'item', label: t('toolbar:moveLeft'), disabled: items[0]?.id === menu.item.id, onSelect: () => move(menu.item.id, items[items.findIndex(item => item.id === menu.item.id) - 1].id) },
      { kind: 'item', label: t('toolbar:moveRight'), disabled: items.at(-1)?.id === menu.item.id, onSelect: () => move(items[items.findIndex(item => item.id === menu.item.id) + 1].id, menu.item.id) },
      { kind: 'item', label: t('common:actions.delete'), onSelect: () => void update({ ...config, items: config.items.filter(item => item.id !== menu.item.id) }) },
    ]} />}
  </>;
}
