import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useT } from '../i18n';

export interface TerminalSearchBarProps {
  /** Runs one search step; true when a match is selected. '' clears and returns true. */
  onFind: (query: string, direction: 'next' | 'previous', incremental: boolean) => boolean;
  /** Panel closes the bar, clears the selection and focuses the terminal. */
  onClose: () => void;
  /** Changes when Ctrl+Shift+F is pressed again: focus and select the input. */
  focusRequest: number;
}

export function TerminalSearchBar({ onFind, onClose, focusRequest }: TerminalSearchBarProps) {
  const { t } = useT();
  const [value, setValue] = useState('');
  const [notFound, setNotFound] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusRequest]);

  const find = (query: string, direction: 'next' | 'previous', incremental: boolean): void => {
    const found = onFind(query, direction, incremental);
    setNotFound(!!query && !found);
  };

  const onChange = (query: string): void => {
    setValue(query);
    find(query, 'next', true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      find(value, event.shiftKey ? 'previous' : 'next', false);
    }
  };

  return (
    <div className="terminal-search" role="search" aria-label={t('terminal:search.label')}>
      <input ref={input} type="text" aria-label={t('terminal:search.input')} placeholder={t('terminal:search.placeholder')}
        value={value} spellCheck={false} autoComplete="off" onChange={event => onChange(event.target.value)} onKeyDown={onKeyDown} />
      <span className="terminal-search-status" role="status">{notFound ? t('terminal:search.none') : ''}</span>
      <button type="button" aria-label={t('terminal:search.previous')} title={t('terminal:search.previous')} onClick={() => find(value, 'previous', false)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
      </button>
      <button type="button" aria-label={t('terminal:search.next')} title={t('terminal:search.next')} onClick={() => find(value, 'next', false)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <button type="button" aria-label={t('terminal:search.close')} title={t('terminal:search.close')} onClick={onClose}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
    </div>
  );
}
