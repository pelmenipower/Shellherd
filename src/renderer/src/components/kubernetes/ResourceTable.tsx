import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent, type RefObject } from 'react';
import { KIND_INFO, KUBE_KINDS, refKey, type ColumnInfo, type KubeKind, type KubeRow } from '../../../../shared/kubernetes';
import { activeFilter, activeGrouping, columnsOf, compileFilter, filterOf, formatAge, formatUsage, isFiltered, searchedRows, sparkline, tableItems, type KubeViewAction, type KubeViewState } from '../../kube-view';
import { EMPTY_VALUE, GROUP_OPTIONS, columnFilterKind, facetValues, isValidColumnFilter, type FacetOption } from '../../kube-columns';
import { CHIPS, attentionChip, chipCounts } from '../../../../shared/kube-status';
import { rowMenuTarget } from '../../kube-menu-run';
import type { MenuTarget } from '../../kube-menus';

const ROW_HEIGHT = 24;
/** Above this many items (rows plus group rows) only the visible window is rendered. */
const WINDOW_THRESHOLD = 200;
const OVERSCAN = 10;
const NUMBER_TITLE = 'Zahl: >3, >=3, <3, <=3, =3 oder 3';
const AGE_TITLE = 'Alter: <10m, >1h, <2d (Einheiten s, m, h, d)';

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

  const filter = filterOf(state);
  const active = activeFilter(state);
  const grouping = activeGrouping(state);
  // Rows plus group header rows; all are ROW_HEIGHT high, so the window works on items.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => (inContainers ? [] : tableItems(state, rows)), [rows, state.groups, kind, state.query.namespace, inContainers]);
  const selectedIndex = inContainers ? -1 : items.findIndex(item => item.type === 'row' && refKey(item.row.ref) === state.selected);
  // The table view has two sticky header rows (header and filter row), the container list one.
  const headerRows = inContainers ? 1 : 2;
  // Keep the selected row inside the scroll area; the sticky headers cover the first slots.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || selectedIndex === -1) return;
    const rowTop = (selectedIndex + headerRows) * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    if (rowTop < element.scrollTop + headerRows * ROW_HEIGHT) element.scrollTop = rowTop - headerRows * ROW_HEIGHT;
    else if (rowBottom > element.scrollTop + element.clientHeight) element.scrollTop = rowBottom - element.clientHeight;
    setScroll({ top: element.scrollTop, height: element.clientHeight || 480 });
  }, [selectedIndex, headerRows]);

  const chipDefs = CHIPS[kind];
  const attention = attentionChip(kind);
  const filtered = isFiltered(active);
  const searchText = filter.text.trim();
  // Counts follow search text and column filters; chips are ignored.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const counts = useMemo(() => chipCounts(kind, searchedRows(state), state.now), [state.rows, kind, filter.text, filter.columns, state.query.namespace, state.now]);
  const showBar = !inContainers;
  const columns: ColumnInfo[] = inContainers
    ? [{ key: 'name', label: 'Container' }, { key: 'image', label: 'Image' }]
    : columnsOf(state);
  const now = state.now || Date.now();
  // Facets of all select filters, computed once per input change (not per row render): each counts the rows that pass
  // all other column filters plus chips and search text.
  const facets = useMemo(() => {
    const result: Record<string, FacetOption[]> = {};
    if (inContainers) return result;
    const otherPredicate = compileFilter(kind, { text: active.text, chips: active.chips }, state.now, columns);
    for (const column of columns) {
      if (columnFilterKind(kind, column) === 'select') result[column.key] = facetValues(state.rows, kind, column, active.columns, state.now, otherPredicate);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rows, kind, active.text, active.chips, active.columns, state.now, state.query.namespace, inContainers]);
  const windowed = !inContainers && items.length > WINDOW_THRESHOLD;
  const first = windowed ? Math.max(0, Math.floor(scroll.top / ROW_HEIGHT) - OVERSCAN) : 0;
  const last = windowed ? Math.min(items.length, first + Math.ceil(scroll.height / ROW_HEIGHT) + 2 * OVERSCAN) : items.length;
  const visible = items.slice(first, last);
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
        <div className="kube-chipbar" role="toolbar" aria-label="Filter" onContextMenu={event => event.preventDefault()}>
          {searchText !== '' && (
            <span className="kube-chip kube-text-chip">Filter: {searchText}{' '}
              <button type="button" className="kube-text-chip-clear" aria-label="Textfilter entfernen"
                onClick={() => dispatch({ type: 'search', text: '' })}>×</button>
            </span>
          )}
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
          <span className="kube-chipbar-end">
            {filtered && !state.loading && (
              <>
                <span>{rows.length} von {state.rows.length}</span>
                <button type="button" className="kube-chipbar-reset" title="Alle Filter zurücksetzen (F)"
                  onClick={() => dispatch({ type: 'clearFilter' })}>Zurücksetzen</button>
              </>
            )}
            <label className="kube-group-by">Gruppieren nach
              <select aria-label="Gruppieren nach" value={grouping?.by ?? ''}
                onKeyDown={event => returnFocus(event, tableRef)}
                onChange={event => {
                  dispatch({ type: 'setGroupBy', groupBy: GROUP_OPTIONS[kind].find(option => option.id === event.target.value)?.id ?? null });
                  // A select that keeps focus swallows j/k and type-ahead would change the choice again.
                  tableRef.current?.focus({ preventScroll: true });
                }}>
                <option value="">keine</option>
                {GROUP_OPTIONS[kind].map(option => {
                  const blocked = option.allNamespacesOnly === true && state.query.namespace !== null;
                  return <option key={option.id} value={option.id} disabled={blocked}>{blocked ? 'Namespace – nur bei allen Namespaces' : option.label}</option>;
                })}
              </select>
            </label>
          </span>
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
              {!inContainers && (
                <tr className="kube-filter-row">
                  {columns.map(column => (
                    <th key={column.key} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
                      <FilterField kind={kind} column={column} current={filter.columns?.[column.key] ?? ''} options={facets[column.key]}
                        dispatch={dispatch} tableRef={tableRef} />
                    </th>
                  ))}
                </tr>
              )}
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
              {!inContainers && visible.map(item => {
                if (item.type === 'group') {
                  return (
                    <tr key={`group:${item.key}`} className="kube-group-row" aria-expanded={!item.collapsed}
                      onClick={() => dispatch({ type: 'toggleGroup', key: item.key })}
                      onContextMenu={event => open(event, { type: 'background' })}>
                      <td colSpan={columns.length}>{item.collapsed ? '▸' : '▾'} {item.label} · {item.count}</td>
                    </tr>
                  );
                }
                const row = item.row;
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
              {!inContainers && last < items.length && (
                <tr className="kube-spacer" aria-hidden="true"><td colSpan={columns.length} style={{ height: (items.length - last) * ROW_HEIGHT }} /></tr>
              )}
            </tbody>
          </table>
          {!inContainers && rows.length === 0 && (
            <div className="kube-empty-block">
              <p className={`kube-empty${state.trouble ? ' error-message' : ''}`} role={state.trouble ? 'alert' : undefined}>{emptyText(state)}</p>
              {!state.trouble && !state.loading && state.rows.length > 0 && filtered && (
                <button type="button" className="kube-empty-action" onClick={() => dispatch({ type: 'clearFilter' })}>Filter zurücksetzen</button>
              )}
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

interface FilterFieldProps {
  kind: KubeKind;
  column: ColumnInfo;
  /** Raw stored value of this column's filter. */
  current: string;
  /** Facet options of a select column. */
  options?: readonly FacetOption[];
  dispatch: (action: KubeViewAction) => void;
  tableRef: RefObject<HTMLDivElement | null>;
}

/** One cell of the filter row; `data-column-filter` is the hook ClusterView's `/` focuses. */
/** Enter and Escape hand the focus back to the table so the hotkeys work again. */
function returnFocus(event: KeyboardEvent<HTMLElement>, tableRef: RefObject<HTMLDivElement | null>): void {
  if (event.key !== 'Enter' && event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  tableRef.current?.focus({ preventScroll: true });
}

function FilterField({ kind, column, current, options = [], dispatch, tableRef }: FilterFieldProps) {
  const filterKind = columnFilterKind(kind, column);
  const key = column.key;
  const isSelect = filterKind === 'select';
  // Columns without a field keep an empty placeholder of the same height so the row does not jump.
  if (filterKind === 'none') return <span className="kube-col-filter kube-col-filter-empty" aria-hidden="true" />;
  const set = (value: string) => dispatch({ type: 'setColumnFilter', key, value });
  if (isSelect) {
    return (
      <select data-column-filter={key} aria-label={`Filter ${column.label}`} value={current}
        onKeyDown={event => returnFocus(event, tableRef)}
        onChange={event => { set(event.target.value); tableRef.current?.focus({ preventScroll: true }); }}>
        <option value="">alle</option>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }
  const valid = isValidColumnFilter(kind, column, current);
  const hint = filterKind === 'number' ? NUMBER_TITLE : filterKind === 'age' ? AGE_TITLE : undefined;
  const title = hint === undefined ? undefined : valid ? hint : `Ungültig, filtert nicht. ${hint}`;
  return (
    <span className="kube-col-filter">
      <input type="text" size={1} data-column-filter={key} aria-label={`Filter ${column.label}`} placeholder="Filter …" maxLength={100}
        spellCheck={false} autoComplete="off" value={current} aria-invalid={!valid} className={valid ? undefined : 'kube-filter-invalid'} title={title}
        onChange={event => set(event.target.value)}
        onKeyDown={event => returnFocus(event, tableRef)} />
      {current && <button type="button" className="kube-col-filter-clear" aria-label={`Filter ${column.label} leeren`} onClick={() => set('')}>×</button>}
    </span>
  );
}

/** The all-namespaces search is offered only where setNamespace keeps the table (no drill-down) and the kind has namespaces. */
function widenable(state: KubeViewState): boolean {
  if (state.trouble || state.loading || state.rows.length === 0 || !isFiltered(activeFilter(state))) return false;
  return state.query.namespace !== null && KIND_INFO[state.query.kind].namespaced && state.crumbs.length === 0;
}

function emptyText(state: KubeViewState): string {
  if (state.trouble) return state.trouble;
  if (state.loading) return 'Lade …';
  if (state.rows.length === 0) return 'Keine Einträge.';
  if (isFiltered(activeFilter(state))) return 'Keine Treffer für die Filter.';
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
