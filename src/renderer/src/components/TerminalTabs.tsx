import { useEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import type { TerminalTab } from '../terminal-tabs';
import { tabLabel } from '../terminal-tabs';
import { statusWord } from '../status-words';
import { ConnectionIcon } from './ConnectionIcon';
import type { ConnectionNode } from '../../../shared/vault/types';

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
}

export function TerminalTabs({ appearance, tabs, activeTabId, disabled, onSelect, onClose, onTabPointerDown, showEditor = true, allTabs = tabs, label = 'SSH-Sessions' }: TerminalTabsProps) {
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    barRef.current?.querySelector('[aria-selected="true"]')?.closest('.terminal-tab-item')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);
  if (!tabs.length) return null;
  return (
    <div ref={barRef} className="terminal-tab-bar" role="tablist" aria-label={label} onKeyDown={event => {
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
        Editor
      </button>}
      {tabs.map(tab => {
        const label = tabLabel(tab, allTabs);
        return <div className="terminal-tab-item" data-active={activeTabId === tab.id} key={tab.id}>
          <button className="terminal-tab" id={`tab-${tab.id}`} type="button" role="tab" data-tab-id={tab.id}
            draggable={false} onPointerDown={event => onTabPointerDown(tab.id, event)}
            aria-controls={`terminal-${tab.id}`} aria-selected={activeTabId === tab.id}
            tabIndex={activeTabId === tab.id ? 0 : -1} disabled={disabled} onClick={() => onSelect(tab.id)} title={`${label} · ${connectionAddress(tab)} · ${statusWord(tab.status, 'short')}`}>
            <span className={`tab-status tab-status-${tab.status}`} aria-label={statusWord(tab.status, 'short')} />
            <ConnectionIcon {...appearance.get(tab.connection.id)} />
            <span className="tab-name">{label}</span>
          </button>
          <button className="terminal-tab-close" type="button" disabled={disabled} aria-label={`Tab ${label} schließen`} title={`${label} schließen`}
            onClick={() => onClose(tab.id)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </div>;
      })}
    </div>
  );
}

function connectionAddress(tab: TerminalTab): string { return tab.connection.address; }
