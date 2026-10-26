import { useEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import type { TerminalTab } from '../terminal-tabs';
import { isWelcomeTab, tabLabel } from '../terminal-tabs';
import { statusWord } from '../status-words';
import { ConnectionIcon } from './ConnectionIcon';
import type { ConnectionNode } from '../../../shared/vault/types';
import { useT } from '../i18n';
import { useTabActivity } from '../terminal-activity';

interface TerminalTabsProps {
  appearance: ReadonlyMap<string, Pick<ConnectionNode, 'icon' | 'color'>>;
  tabs: TerminalTab[];
  allTabs?: TerminalTab[];
  showEditor?: boolean;
  label?: string;
  activeTabId: string | null;
  disabled: boolean;
  onSelect: (id: string | null) => void;
  onClose: (id: string) => void;
  onTabPointerDown: (id: string, event: PointerEvent<HTMLElement>) => void;
  /** Right-click, Shift+F10 or the menu key on a tab; the caller decides whether a menu opens. */
  onTabMenu?: (id: string, x: number, y: number) => void;
  /** Tab that shows a name field instead of its button; `onRename` gets the typed name, or null when cancelled. */
  renamingId?: string | null;
  onRename?: (id: string, title: string | null) => void;
}

export function TerminalTabs({ appearance, tabs, activeTabId, disabled, onSelect, onClose, onTabPointerDown, onTabMenu, renamingId = null, onRename, showEditor = true, allTabs = tabs, label: barLabel }: TerminalTabsProps) {
  const { t } = useT();
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    barRef.current?.querySelector('[aria-selected="true"]')?.closest('.terminal-tab-item')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);
  const activity = useTabActivity();
  if (!tabs.length) return null;
  return (
    <div ref={barRef} className="terminal-tab-bar" role="tablist" aria-label={barLabel ?? t('terminal:tabs.label')} onKeyDown={event => {
      if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return;
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (disabled || !keys.includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      const current = buttons.indexOf(event.target as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      const id = buttons[next].dataset.tabId ?? null;
      onSelect(id);
      buttons[next].focus();
    }}>
      {showEditor && <button className="terminal-tab" id="tab-editor" type="button" role="tab" aria-controls="terminal-editor"
        aria-selected={activeTabId === null} tabIndex={activeTabId === null ? 0 : -1} disabled={disabled} onClick={() => onSelect(null)}>
        {t('terminal:tabs.editor')}
      </button>}
      {tabs.map(tab => {
        const welcome = isWelcomeTab(tab);
        const fresh = !welcome && activity.has(tab.id);
        const label = welcome ? t('terminal:tabs.welcome') : tabLabel(tab, allTabs);
        if (renamingId === tab.id && onRename) return <div className="terminal-tab-item" data-active={activeTabId === tab.id} key={tab.id}>
          <input className="view-rename" aria-label={t('terminal:tabs.renameLabel')} autoFocus defaultValue={label} onFocus={event => event.target.select()}
            onBlur={event => onRename(tab.id, event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') onRename(tab.id, event.currentTarget.value);
              if (event.key === 'Escape') onRename(tab.id, null);
            }} />
        </div>;
        return <div className="terminal-tab-item" data-active={activeTabId === tab.id} key={tab.id}>
          <button className="terminal-tab" id={`tab-${tab.id}`} type="button" role="tab" data-tab-id={tab.id}
            draggable={false} onPointerDown={event => onTabPointerDown(tab.id, event)}
            onContextMenu={event => {
              if (!onTabMenu || disabled) return;
              event.preventDefault();
              // Keyboard triggers may report no coordinates: anchor at the tab instead.
              const rect = event.currentTarget.getBoundingClientRect();
              const atOrigin = event.clientX === 0 && event.clientY === 0;
              onTabMenu(tab.id, atOrigin ? rect.left : event.clientX, atOrigin ? rect.bottom : event.clientY);
            }}
            aria-controls={`terminal-${tab.id}`} aria-selected={activeTabId === tab.id}
            tabIndex={activeTabId === tab.id ? 0 : -1} disabled={disabled} onClick={() => onSelect(tab.id)} data-fixed={welcome || undefined} data-activity={fresh || undefined}
            title={welcome ? label : `${label} · ${connectionAddress(tab)} · ${statusWord(tab.status, 'short')}${fresh ? ` · ${t('terminal:tabs.activity')}` : ''}`}>
            {!welcome && <span className={`tab-status tab-status-${tab.status}`} aria-label={statusWord(tab.status, 'short')} />}
            {!welcome && <ConnectionIcon {...appearance.get(tab.connection.id)} />}
            <span className="tab-name">{label}</span>
            {fresh && <span className="tab-activity" role="img" aria-label={t('terminal:tabs.activity')} />}
          </button>
          <button className="terminal-tab-close" type="button" disabled={disabled} aria-label={t('terminal:tabs.closeAria', { label })} title={t('terminal:tabs.closeTitle', { label })}
            onClick={() => onClose(tab.id)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </div>;
      })}
    </div>
  );
}

function connectionAddress(tab: TerminalTab): string { return tab.connection.address; }
