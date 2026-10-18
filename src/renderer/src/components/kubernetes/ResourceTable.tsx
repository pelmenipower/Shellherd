import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { KIND_INFO, KUBE_KINDS, refKey, type ColumnInfo, type KubeRow } from '../../../../shared/kubernetes';
import { columnsOf, filterOf, formatAge, formatUsage, isFiltered, searchedRows, sparkline, type KubeViewAction, type KubeViewState } from '../../kube-view';
import { CHIPS, attentionChip, chipCounts } from '../../../../shared/kube-status';
import { rowMenuTarget } from '../../kube-menu-run';
import type { MenuTarget } from '../../kube-menus';

const ROW_HEIGHT = 24;
/** Above this many rows only the visible window is rendered. */
const WINDOW_THRESHOLD = 200;
const OVERSCAN = 10;

interface ResourceTableProps {
  state: KubeViewState;
  /** `visibleRows(state)`: filtered and sorted. */
  rows: KubeRow[];
  dispatch: (action: KubeViewAction) => void;
  tableRef: RefObject<HTMLDivElement | null>;
  onMenu?: (target: MenuTarget, x: number, y: number) => void;
}

/** Kind tabs and the k9s-style table. Keys are handled by the view; this component only renders and scrolls. */
export function ResourceTable({ state, rows, dispatch, tableRef, onMenu }: ResourceTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 480 });
  const kind = state.query.kind;
  const inContainers = state.containersOf !== null;

  // Track the viewport size for the row window.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setScroll({ top: element.scrollTop, height: element.clientHeight || 480 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const selectedIndex = inContainers ? -1 : rows.findIndex(row => refKey(row.ref) === state.selected);
  // Keep the selected row inside the scroll area; the sticky header covers the first slot.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || selectedIndex === -1) return;
    const rowTop = (selectedIndex + 1) * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    if (rowTop < element.scrollTop + ROW_HEIGHT) element.scrollTop = rowTop - ROW_HEIGHT;
    else if (rowBottom > element.scrollTop + element.clientHeight) element.scrollTop = rowBottom - element.clientHeight;
    setScroll({ top: element.scrollTop, height: element.clientHeight || 480 });
  }, [selectedIndex]);

  const filter = filterOf(state);
  const chipDefs = CHIPS[kind];
  const attention = attentionChip(kind);
  const filtered = isFiltered(filter);
  // Counts follow the search text only; chips are ignored.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const counts = useMemo(() => chipCounts(kind, searchedRows(state), state.now), [state.rows, kind, filter.text, state.now]);
  const showBar = !inContainers && (chipDefs.length > 0 || filtered);
  const columns: ColumnInfo[] = inContainers
    ? [{ key: 'name', label: 'Container' }, { key: 'image', label: 'Image' }]
    : columnsOf(state);
  const now = state.now || Date.now();
  const windowed = !inContainers && rows.length > WINDOW_THRESHOLD;
  const first = windowed ? Math.max(0, Math.floor(scroll.top / ROW_HEIGHT) - OVERSCAN) : 0;
  const last = windowed ? Math.min(rows.length, first + Math.ceil(scroll.height / ROW_HEIGHT) + 2 * OVERSCAN) : rows.length;
  const visible = rows.slice(first, last);
  const containers = state.containersOf?.containers ?? [];
  const pod = state.containersOf;

  // Every context menu event is handled here: either a menu opens or the native one is suppressed.
  const open = (event: ReactMouseEvent, target: MenuTarget) => {
    event.preventDefault();
    event.stopPropagation();
    onMenu?.(target, event.clientX, event.clientY);
  };

  return (
    <div className="kube-table-area">
      <div className="kube-kind-tabs" role="tablist" aria-label="Ressourcen" onContextMenu={event => event.preventDefault()}>
        {KUBE_KINDS.map((candidate, index) => {
          const digit = index === 9 ? '0' : String(index + 1);
          const on = candidate === kind && !inContainers;
          return (
            <button key={candidate} type="button" role="tab" aria-selected={on} className={`kube-kind${on ? ' kube-kind-on' : ''}`}
              onClick={() => dispatch({ type: 'setKind', kind: candidate })}>
              <kbd>{digit}</kbd> {KIND_INFO[candidate].label}
            </button>
          );
        })}
      </div>
      {showBar && (
        <div className="kube-chipbar" role="toolbar" aria-label="Status-Filter" onContextMenu={event => event.preventDefault()}>
          {chipDefs.map((chip, index) => {
            const on = filter.chips.includes(chip.id);
            const count = counts[chip.id] ?? 0;
            return (
              <Fragment key={chip.id}>
                {index > 0 && chipDefs[index - 1].group !== chip.group && <span className="kube-chip-sep" aria-hidden="true" />}
                <button type="button" aria-pressed={on} title={chip.id === attention ? 'Taste w' : undefined}
                  className={`kube-chip kube-filter-chip${on ? ' kube-chip-on' : ''}${count === 0 ? ' kube-chip-zero' : ''}`}
                  onClick={() => dispatch({ type: 'toggleChip', id: chip.id })}>
                  {chip.label} <span className="kube-chip-count">{count}</span>
                </button>
              </Fragment>
            );
          })}
          {filtered && !state.loading && (
            <span className="kube-chipbar-end">
              <span>{rows.length} von {state.rows.length}</span>
              <button type="button" className="kube-chipbar-reset" title="Suche und Status-Filter zurücksetzen (F)"
                onClick={() => dispatch({ type: 'clearFilter' })}>Zurücksetzen</button>
            </span>
          )}
        </div>
      )}
      <div ref={tableRef} className="kube-table-focus" tabIndex={-1}>
        <div ref={scrollRef} className="kube-table-scroll"
          onContextMenu={event => {
            // Key-triggered native events bubble from the focus element above this div and never reach it.
            event.preventDefault();
            open(event, { type: 'background' });
          }}
          onScroll={event => setScroll({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
          <table className="kube-table">
            <thead>
              <tr>
                {columns.map(column => {
                  const sorted = !inContainers && state.sort?.key === column.key;
                  return (
                    <th key={column.key} scope="col" className={column.numeric ? 'kube-num' : undefined}
                      onContextMenu={event => open(event, inContainers ? { type: 'background' } : { type: 'header', column })}
                      aria-sort={sorted ? (state.sort?.descending ? 'descending' : 'ascending') : undefined}
                      onClick={inContainers ? undefined : () => dispatch({ type: 'sort', key: column.key })}>
                      {column.label}{sorted ? (state.sort?.descending ? ' ▾' : ' ▴') : ''}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {inContainers && containers.map(name => (
                <tr key={name} className={state.container === name ? 'kube-row-selected' : undefined} aria-selected={state.container === name}
                  onClick={() => dispatch({ type: 'selectContainer', name })}
                  onContextMenu={event => {
                    if (!pod) { open(event, { type: 'background' }); return; }
                    dispatch({ type: 'selectContainer', name });
                    open(event, { type: 'container', pod, name });
                  }}>
                  <td>{name}</td>
                  <td>{pod ? containerImage(pod, name) : '–'}</td>
                </tr>
              ))}
              {!inContainers && first > 0 && (
                <tr className="kube-spacer" aria-hidden="true"><td colSpan={columns.length} style={{ height: first * ROW_HEIGHT }} /></tr>
              )}
              {!inContainers && visible.map(row => {
                const key = refKey(row.ref);
                const selected = key === state.selected;
                return (
                  <tr key={row.uid} className={`kube-row kube-tone-${row.tone}${selected ? ' kube-row-selected' : ''}`} aria-selected={selected}
                    onClick={() => dispatch({ type: 'select', key })}
                    onContextMenu={event => { dispatch({ type: 'select', key }); open(event, rowMenuTarget(row)); }}
                    onDoubleClick={() => { dispatch({ type: 'select', key }); dispatch({ type: 'drill' }); }}>
                    {columns.map(column => (
                      <td key={column.key} className={column.numeric ? 'kube-num' : undefined}>{cellText(state, row, column, now)}</td>
                    ))}
                  </tr>
                );
              })}
              {!inContainers && last < rows.length && (
                <tr className="kube-spacer" aria-hidden="true"><td colSpan={columns.length} style={{ height: (rows.length - last) * ROW_HEIGHT }} /></tr>
              )}
            </tbody>
          </table>
          {!inContainers && rows.length === 0 && (
            <div className="kube-empty-block">
              <p className={`kube-empty${state.trouble ? ' error-message' : ''}`} role={state.trouble ? 'alert' : undefined}>{emptyText(state)}</p>
              {widenable(state) && (
                <button type="button" className="kube-empty-action" onClick={() => dispatch({ type: 'setNamespace', namespace: null })}>In allen Namespaces suchen</button>
              )}
            </div>
          )}
          {!inContainers && rows.length > 0 && state.trouble && <p className="kube-empty error-message" role="alert">{state.trouble}</p>}
        </div>
      </div>
    </div>
  );
}

/** The all-namespaces search is offered only where setNamespace keeps the table (no drill-down) and the kind has namespaces. */
function widenable(state: KubeViewState): boolean {
  if (state.trouble || state.loading || state.rows.length === 0 || !isFiltered(filterOf(state))) return false;
  return state.query.namespace !== null && KIND_INFO[state.query.kind].namespaced && state.crumbs.length === 0;
}

function emptyText(state: KubeViewState): string {
  if (state.trouble) return state.trouble;
  if (state.loading) return 'Lade …';
  if (state.rows.length === 0) return 'Keine Einträge.';
  const filter = filterOf(state);
  const text = filter.text.trim();
  const labels = CHIPS[state.query.kind].filter(chip => filter.chips.includes(chip.id)).map(chip => chip.label).join(', ');
  const ns = state.query.namespace !== null ? ` in ${state.query.namespace}` : '';
  if (text && labels) return `Keine Treffer für „${text}“ mit ${labels}${ns}.`;
  if (text) return `Keine Treffer für „${text}“${ns}.`;
  if (labels) return `Keine Zeilen mit ${labels}${ns}.`;
  return 'Keine Einträge.';
}

/** The pod's container images come from the `image:<container>` cells when the main side provides them. */
function containerImage(pod: KubeRow, name: string): string {
  const image = pod.cells[`image:${name}`];
  return typeof image === 'string' && image ? image : '–';
}

function cellText(state: KubeViewState, row: KubeRow, column: ColumnInfo, now: number): string {
  if (column.usage) {
    const history = state.usage[refKey(row.ref)];
    if (history && history.length > 0) {
      const series = history.map(sample => column.usage === 'cpu' ? sample.cpuMilli : sample.memoryBytes);
      return `${formatUsage(column.usage, series[series.length - 1])} ${sparkline(series)}`;
    }
    const cell = row.cells[column.key];
    return cell === undefined || cell === '' ? '–' : String(cell);
  }
  if (column.key === 'namespace') return row.ref.namespace ?? '–';
  const value = row.cells[column.key] ?? (column.key === 'name' ? row.ref.name : '');
  if (column.age) return formatAge(String(value), now);
  return String(value) || '–';
}
