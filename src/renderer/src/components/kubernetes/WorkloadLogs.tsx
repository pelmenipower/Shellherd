import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react';
import { MAX_LOG_SOURCES, MAX_LOG_STREAMS, type KubeLogSource, type KubeLogsStartRequest, type KubeRow } from '../../../../shared/kubernetes';
import { errorText } from '../../error-text';
import { useT } from '../../i18n';
import { matchesShortcut } from '../../shortcut-match';
import { DEFAULT_SEARCH_OPTIONS, compileSearch, findMatches, listSearchStatus, markParts, matchesBySeq, refindMatch, stepMatch, type SearchOptions } from '../../log-search';
import { TerminalSearchBar } from '../TerminalSearchBar';
import { MAX_BUFFER_LINES, SOURCE_COLORS, highlightParts, logTime, logsText, mergeLines, shownLines, sourceLabel, toggleSource, type LogEntry } from '../../kube-logs';

/** Below this many pixels from the end, the list counts as following. */
const SCROLL_SLACK = 8;

interface WorkloadLogsProps {
  viewId: string | null;
  row: KubeRow;
  format: 'compact' | 'raw';
  start: (request: Omit<KubeLogsStartRequest, 'viewId'>) => Promise<void>;
  stop: (id: string) => Promise<void>;
  /** Set to a function that returns all matching lines as text, for the dock's copy button. */
  textRef: MutableRefObject<(() => string) | null>;
  /** Auto-scroll checkbox of the dock. */
  follow: boolean;
  onFollow: (on: boolean) => void;
  /** A value different from the one at mount opens and focuses the search bar (dock button). */
  searchRequest: number;
}

/** "Logs aller Pods": one run per mount; the dock remounts it (key) for another row, another format or after a reconnect. */
export function WorkloadLogs({ viewId, row, format, start, stop, textRef, follow, onFollow, searchRequest }: WorkloadLogsProps) {
  const { t } = useT();
  const [log, setLog] = useState<{ entries: LogEntry[]; received: number }>({ entries: [], received: 0 });
  const [sources, setSources] = useState<KubeLogSource[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [full, setFull] = useState(0);
  const [dropped, setDropped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('');
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());
  // Auto-scroll off: the lines as they were when it went off, and how many had arrived by then.
  const [frozen, setFrozen] = useState<{ entries: LogEntry[]; received: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocus, setSearchFocus] = useState(0);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS);
  const [cursor, setCursor] = useState<{ seq: number; start: number; index: number } | null>(null);
  const [scrollTick, setScrollTick] = useState(0);
  const firstSearchRequest = useRef(searchRequest);
  const namespace = row.ref.namespace ?? '';
  const selectorKey = JSON.stringify(row.selector ?? {});

  useEffect(() => {
    if (!viewId) return;
    const id = crypto.randomUUID();
    const off = window.desktopApi.onKubeEvent(event => {
      if (event.type !== 'logs' || event.viewId !== viewId || event.id !== id) return;
      setLog(current => ({ entries: mergeLines(current.entries, event.lines, current.received, MAX_BUFFER_LINES), received: current.received + event.lines.length }));
      setSources(event.sources);
      setWaiting(event.waiting);
      setFull(event.full);
      setDropped(event.dropped);
      setError(event.error ? errorText(event.error) : null);
      setLoaded(true);
    });
    start({ id, namespace, selector: JSON.parse(selectorKey) as Record<string, string>, format }).catch((caught: unknown) => setError(errorText(caught)));
    return () => {
      off();
      void stop(id).catch(() => {});
    };
  }, [viewId, namespace, selectorKey, format, start, stop]);

  const current = frozen ?? log;
  const { lines, hiddenOlder } = useMemo(() => shownLines(current.entries, sources, hidden, filter), [current.entries, sources, hidden, filter]);
  const newer = frozen ? log.received - frozen.received : 0;

  const openSearch = () => { setSearchOpen(true); setSearchFocus(value => value + 1); };
  useEffect(() => {
    if (searchRequest !== firstSearchRequest.current) openSearch();
  }, [searchRequest]);

  const pattern = useMemo(() => compileSearch(query, options), [query, options]);
  const { matches, truncated } = useMemo(() => (pattern ? findMatches(lines, pattern) : { matches: [], truncated: false }), [lines, pattern]);
  const byLine = useMemo(() => matchesBySeq(matches), [matches]);
  const currentIndex = refindMatch(matches, cursor, cursor?.index ?? -1);
  const currentMatch = currentIndex >= 0 ? matches[currentIndex] ?? null : null;
  const status = listSearchStatus(query, pattern, matches.length, truncated, currentIndex);

  const onFind = (q: string, o: SearchOptions, direction: 'next' | 'previous', incremental: boolean): void => {
    setQuery(q);
    setOptions(o);
    const p = compileSearch(q, o);
    const found = p ? findMatches(lines, p).matches : [];
    if (found.length === 0) { setCursor(null); return; }
    const base = refindMatch(found, cursor, cursor?.index ?? -1);
    const index = incremental ? (base >= 0 ? base : direction === 'next' ? 0 : found.length - 1) : stepMatch(base, found.length, direction);
    const match = found[index];
    if (!match) return;
    setCursor({ seq: match.seq, start: match.start, index });
    onFollow(false);
    setScrollTick(value => value + 1);
  };
  const closeSearch = (): void => {
    setSearchOpen(false);
    setQuery('');
    setOptions(DEFAULT_SEARCH_OPTIONS);
    setCursor(null);
    listRef.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (matchesShortcut(event, { ctrl: true, shift: false, code: 'KeyF' }) || matchesShortcut(event, { ctrl: true, shift: true, code: 'KeyF' })) {
      event.preventDefault();
      openSearch();
    } else if (event.key === 'F3' && !event.ctrlKey && !event.altKey && searchOpen) {
      event.preventDefault();
      onFind(query, options, event.shiftKey ? 'previous' : 'next', false);
    }
  };

  useEffect(() => {
    textRef.current = () => logsText(shownLines(current.entries, sources, hidden, filter, Number.POSITIVE_INFINITY).lines, sources);
    return () => { textRef.current = null; };
  }, [textRef, current.entries, sources, hidden, filter]);

  // Auto-scroll keeps the newest line in view; no smooth scrolling (motion gate).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (follow && list) list.scrollTop = list.scrollHeight;
  }, [lines, follow]);

  useEffect(() => {
    if (follow) setFrozen(null);
    else setFrozen(previous => previous ?? { entries: log.entries, received: log.received });
    // snapshot at the moment auto-scroll went off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow]);

  // Jump to the current match; no behavior option (motion gate).
  useLayoutEffect(() => {
    listRef.current?.querySelector('mark.is-current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [scrollTick]);

  const onScroll = () => {
    const list = listRef.current;
    if (follow && list && list.scrollHeight - list.scrollTop - list.clientHeight > SCROLL_SLACK) onFollow(false);
  };

  const live = sources.filter(source => source.live).length;
  const stateText = error ?? (!loaded ? t('kubernetes:logsAll.loading')
    : sources.length === 0 ? t('kubernetes:logsAll.noPods')
    : [
      t('kubernetes:logsAll.summary', { shown: live, total: sources.length }),
      ...(waiting > 0 ? [t('kubernetes:logsAll.waiting', { count: waiting, max: MAX_LOG_STREAMS })] : []),
      ...(full > 0 ? [t('kubernetes:logsAll.full', { count: full, max: MAX_LOG_SOURCES })] : []),
      ...(dropped > 0 ? [t('kubernetes:logsAll.dropped', { count: dropped })] : []),
      ...(!follow && newer > 0 ? [t('kubernetes:logsAll.newer', { count: newer })] : []),
    ].join(' · '));

  return (
    <div className="kube-logs" onKeyDown={onKeyDown}>
      <div className="kube-logs-bar">
        <input type="search" className="kube-logs-filter" value={filter} placeholder={t('kubernetes:logsAll.filter')} aria-label={t('kubernetes:logsAll.filterLabel')}
          onChange={event => { setFilter(event.target.value); if (frozen) setFrozen({ entries: log.entries, received: log.received }); }} />
        <span className={error ? 'kube-logs-state error-message' : 'kube-muted kube-logs-state'} role="status">{stateText}</span>
      </div>
      {searchOpen && (
        <TerminalSearchBar onFind={onFind} onClose={closeSearch} focusRequest={searchFocus} status={status} label={t('kubernetes:logsAll.search')} />
      )}
      {sources.length > 0 && (
        <div className="kube-logs-sources" role="group" aria-label={t('kubernetes:logsAll.sources')}>
          {sources.map((source, index) => (
            <button key={sourceLabel(source)} type="button" aria-pressed={!hidden.has(index)} title={source.error ? errorText(source.error) : undefined}
              className={`kube-logs-chip kube-logs-src-${index % SOURCE_COLORS}${source.live ? '' : ' kube-logs-chip-ended'}`}
              onClick={() => setHidden(value => toggleSource(value, index))}>
              {source.live ? sourceLabel(source) : `${sourceLabel(source)} · ${source.error ? t('kubernetes:logsAll.failed') : t('kubernetes:logsAll.ended')}`}
            </button>
          ))}
        </div>
      )}
      <div ref={listRef} className="kube-logs-lines" role="log" aria-live="off" aria-label={t('kubernetes:logsAll.linesLabel')} tabIndex={0} onScroll={onScroll}>
        {hiddenOlder > 0 && <p className="kube-muted kube-logs-more">{t('kubernetes:logsAll.olderHidden', { count: hiddenOlder })}</p>}
        {lines.map(line => (
          <div key={line.seq} className="kube-logs-line">
            <span className={`kube-logs-src kube-logs-src-${line.source % SOURCE_COLORS}`}>{sourceLabel(sources[line.source])}</span>
            <span className="kube-logs-time">{logTime(line.time)}</span>
            <span>{searchOpen && pattern && byLine.has(line.seq)
              ? markParts(line.text, byLine.get(line.seq) ?? [], currentMatch).map((part, index) => (part.mark ? <mark key={index} className={part.mark === 'current' ? 'is-match is-current' : 'is-match'}>{part.text}</mark> : part.text))
              : highlightParts(line.text, filter).map((part, index) => (part.mark ? <mark key={index}>{part.text}</mark> : part.text))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
