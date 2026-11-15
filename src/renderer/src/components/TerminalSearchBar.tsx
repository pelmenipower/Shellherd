import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import '../terminal-comfort-ui.css';
import { useT } from '../i18n';
import { formatNumber } from '../../../shared/format';
import { DEFAULT_SEARCH_OPTIONS } from '../log-search';
import type { SearchOptions, SearchStatus } from '../log-search';

export interface TerminalSearchBarProps {
  /** One search step; '' clears. The host reports the outcome through `status`. */
  onFind: (query: string, options: SearchOptions, direction: 'next' | 'previous', incremental: boolean) => void;
  onClose: () => void;
  /** A change focuses and selects the input. */
  focusRequest: number;
  status: SearchStatus;
  /** aria-label of the bar; default t('terminal:search.label'). */
  label?: string;
}

export function TerminalSearchBar({ onFind, onClose, focusRequest, status, label }: TerminalSearchBarProps) {
  const { t } = useT();
  const [value, setValue] = useState('');
  const [options, setOptions] = useState<SearchOptions>({ ...DEFAULT_SEARCH_OPTIONS });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusRequest]);

  const toggle = (key: keyof SearchOptions): void => {
    const next = { ...options, [key]: !options[key] };
    setOptions(next);
    onFind(value, next, 'next', true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Enter' || (event.key === 'F3' && !event.ctrlKey && !event.altKey)) {
      event.preventDefault();
      onFind(value, options, event.shiftKey ? 'previous' : 'next', false);
    } else if (event.ctrlKey && !event.altKey && event.code === 'KeyF') {
      event.preventDefault();
      event.stopPropagation();
      input.current?.select();
    }
  };

  const statusText = ((): string => {
    switch (status.kind) {
      case 'count': return t('terminal:search.count', { index: formatNumber(status.index + 1), total: status.count });
      case 'many': return t('terminal:search.many', { total: status.count });
      case 'total': return t('terminal:search.total', { count: status.count });
      case 'none': return t('terminal:search.none');
      case 'invalid': return t('terminal:search.invalidRegex');
      default: return '';
    }
  })();

  const optionButton = (key: keyof SearchOptions, text: string, name: string) => (
    <button type="button" className="terminal-search-option" aria-pressed={options[key]} aria-label={name} title={name} onClick={() => toggle(key)}>{text}</button>
  );

  return (
    <div className="terminal-search" role="search" aria-label={label ?? t('terminal:search.label')}>
      <input ref={input} type="text" aria-label={t('terminal:search.input')} placeholder={t('terminal:search.placeholder')}
        value={value} spellCheck={false} autoComplete="off" aria-invalid={status.kind === 'invalid' || undefined}
        onChange={event => { setValue(event.target.value); onFind(event.target.value, options, 'next', true); }} onKeyDown={onKeyDown} />
      {optionButton('caseSensitive', 'Aa', t('terminal:search.caseSensitive'))}
      {optionButton('regex', '.*', t('terminal:search.regex'))}
      {optionButton('wholeWord', 'ab', t('terminal:search.wholeWord'))}
      <span className="terminal-search-status" role="status">{statusText}</span>
      <button type="button" aria-label={t('terminal:search.previous')} title={t('terminal:search.previous')} onClick={() => onFind(value, options, 'previous', false)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
      </button>
      <button type="button" aria-label={t('terminal:search.next')} title={t('terminal:search.next')} onClick={() => onFind(value, options, 'next', false)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <button type="button" aria-label={t('terminal:search.close')} title={t('terminal:search.close')} onClick={onClose}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
    </div>
  );
}
