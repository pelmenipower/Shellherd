import { useEffect, useLayoutEffect, useRef } from 'react';
import { useNativeSurfaceBlock } from '../native-surface';
import './navigation-ui.css';

export type ContextMenuEntry =
  | { kind: 'item'; label: string; onSelect: () => void; disabled?: boolean; hint?: string }
  | { kind: 'heading'; label: string }
  | { kind: 'separator' };

interface ContextMenuProps {
  x: number;
  y: number;
  label: string;
  entries: ContextMenuEntry[];
  onClose: () => void;
}

/** Fixed-position menu with keyboard support; closes on Escape, outside click, blur and resize. */
export function ContextMenu({ x, y, label, entries, onClose }: ContextMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  useNativeSurfaceBlock(true);

  useLayoutEffect(() => {
    const element = menu.current!;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    element.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
    element.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [x, y]);

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return <div ref={menu} className="context-menu" role="menu" aria-label={label} style={{ left: x, top: y }}
    onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
    {entries.map((entry, index) => entry.kind === 'separator' ? <div key={index} className="context-menu-separator" role="separator" />
      : entry.kind === 'heading' ? <div key={index} className="context-menu-heading" role="presentation">{entry.label}</div>
      : <button key={index} type="button" role="menuitem" disabled={entry.disabled} onClick={() => { onClose(); entry.onSelect(); }}>
        <span>{entry.label}</span>{entry.hint && <small>{entry.hint}</small>}
      </button>)}
  </div>;
}
