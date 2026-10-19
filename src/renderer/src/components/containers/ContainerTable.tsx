import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import {
  compileColumnFilters, displayCell, facetValues, groupOptionsFor, isValidColumnFilter,
  type ColumnFilterKind, type ContainerColumn,
} from '../../container-columns';
import { CHIPS, attentionChip, chipCounts, compileChips } from '../../container-status';
import { currentColumns, rowsOf, tableItems as groupedItems, type ContainerViewAction, type ContainerViewState } from '../../container-view';
import type { InventoryRow } from '../../../../shared/containers';
import { errorText } from '../../error-text';
import { useT } from '../../i18n';
import { rowMenuTarget } from '../../container-menu-run';
import type { ContainerMenuTarget } from '../../container-menus';

const ROW_HEIGHT = 24;
/** Above this many items (rows plus group rows) only the visible window is rendered. */
const WINDOW_THRESHOLD = 200;
const OVERSCAN = 10;
const HEADER_ROWS = 2;
const HINT_KEYS = {
  number: 'containers:table.hintNumber', size: 'containers:table.hintSize', age: 'containers:table.hintAge',
} as const satisfies Partial<Record<ColumnFilterKind, string>>;
const EMPTY_TEXT_KEYS = {
  containers: 'containers:table.empty.containers', images: 'containers:table.empty.images',
  volumes: 'containers:table.empty.volumes', networks: 'containers:table.empty.networks',
} as const;

interface ContainerTableProps {
  state: ContainerViewState;
  /** `visibleRows(state)`: filtered and sorted. */
  rows: InventoryRow[];
  dispatch: (action: ContainerViewAction) => void;
  tableRef: RefObject<HTMLDivElement | null>;
  onMenu: (target: ContainerMenuTarget, x: number, y: number) => void;
}

/** Chip bar and table. Keys are handled by the view; this component only renders and scrolls. */
export function ContainerTable({ state, rows, dispatch, tableRef, onMenu }: ContainerTableProps) {
  const { t } = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 480 });
  const kind = state.kind;
  const view = state.views[kind];
  const runtime = state.inventory?.runtime ?? 'docker';

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

  const allRows = rowsOf(state);
  const columns = useMemo(() => currentColumns(state),
    // currentColumns reads exactly these fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.kind, runtime]);
  const filterKey = JSON.stringify(view.filters);
  const items = useMemo(() => groupedItems(state, rows),
    // groupedItems reads the view, the kind and the runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, view.groupBy, view.collapsed, kind, runtime]);
  const selectedIndex = items.findIndex(item => item.type === 'row' && item.row.uid === state.selected);

  // Keep the selected row inside the scroll area; the sticky headers cover the first slots.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || selectedIndex === -1) return;
    const rowTop = (selectedIndex + HEADER_ROWS) * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    if (rowTop < element.scrollTop + HEADER_ROWS * ROW_HEIGHT) element.scrollTop = rowTop - HEADER_ROWS * ROW_HEIGHT;
    else if (rowBottom > element.scrollTop + element.clientHeight) element.scrollTop = rowBottom - element.clientHeight;
    setScroll({ top: element.scrollTop, height: element.clientHeight || 480 });
  }, [selectedIndex]);

  const chipDefs = CHIPS[kind];
  const attention = attentionChip(kind);
  const filtered = Object.keys(view.filters).length > 0 || view.chips.length > 0;
  // Chip counts follow the column filters; chips themselves are ignored.
  const counts = useMemo(() => chipCounts(kind, allRows.filter(compileColumnFilters(columns, view.filters, state.now))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.inventory, kind, filterKey, state.now, columns]);
  // Facets of all select filters: each counts the rows that pass all other column filters and the chips.
  const facets = useMemo(() => {
    const result: Record<string, ReturnType<typeof facetValues>> = {};
    const otherPredicate = compileChips(kind, view.chips);
    for (const column of columns) {
      if (column.filter === 'select') result[column.key] = facetValues(allRows, columns, column, view.filters, state.now, otherPredicate);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.inventory, kind, filterKey, view.chips, state.now, columns]);

  const now = state.now || Date.now();
  const windowed = items.length > WINDOW_THRESHOLD;
  const first = windowed ? Math.max(0, Math.floor(scroll.top / ROW_HEIGHT) - OVERSCAN) : 0;
  const last = windowed ? Math.min(items.length, first + Math.ceil(scroll.height / ROW_HEIGHT) + 2 * OVERSCAN) : items.length;
  const shown = items.slice(first, last);
  const groups = groupOptionsFor(kind, runtime);

  // Every context menu event is handled here: either a menu opens or the native one is suppressed.
  const open = (event: ReactMouseEvent, target: ContainerMenuTarget) => {
    event.preventDefault();
    event.stopPropagation();
    onMenu(target, event.clientX, event.clientY);
  };

  const problemError = state.inventory?.problems[kind];
  const problem = problemError ? errorText(problemError) : undefined;
  const emptyText = problem ?? (state.loading && !state.inventory ? t('containers:loading')
    : allRows.length === 0 ? t(EMPTY_TEXT_KEYS[kind])
      : t('containers:table.noMatch'));

  return (
    <div className="kube-table-area">
      <div className="kube-chipbar" role="toolbar" aria-label={t('containers:table.filterBar')} onContextMenu={event => event.preventDefault()}>
        {chipDefs.map((chip, index) => {
          const on = view.chips.includes(chip.id);
          const count = counts[chip.id] ?? 0;
          return (
            <Fragment key={chip.id}>
              {index > 0 && chipDefs[index - 1].group !== chip.group && <span className="kube-chip-sep" aria-hidden="true" />}
              <button type="button" aria-pressed={on} title={chip.id === attention ? t('containers:table.attentionTitle') : undefined}
                className={`kube-chip kube-filter-chip${on ? ' kube-chip-on' : ''}${count === 0 ? ' kube-chip-zero' : ''}`}
                onClick={() => dispatch({ type: 'toggleChip', id: chip.id })}>
                {chip.label} <span className="kube-chip-count">{count}</span>
              </button>
            </Fragment>
          );
        })}
        <span className="kube-chipbar-end">
          {filtered && state.inventory && (
            <>
              <span>{t('containers:table.count', { shown: rows.length, total: allRows.length })}</span>
              <button type="button" className="kube-chipbar-reset" title={t('containers:table.resetTitle')}
                onClick={() => dispatch({ type: 'clearFilter' })}>{t('containers:table.reset')}</button>
            </>
          )}
          <label className="kube-group-by">{t('containers:table.groupBy')}
            <select aria-label={t('containers:table.groupBy')} value={view.groupBy ?? ''}
              onKeyDown={event => returnFocus(event, tableRef)}
              onChange={event => {
                dispatch({ type: 'setGroupBy', groupBy: groups.find(option => option.id === event.target.value)?.id ?? null });
                // A select that keeps focus swallows j/k and type-ahead would change the choice again.
                tableRef.current?.focus({ preventScroll: true });
              }}>
              <option value="">{t('containers:table.noGrouping')}</option>
              {groups.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
        </span>
      </div>
      <div ref={tableRef} className="kube-table-focus" tabIndex={-1}>
        <div ref={scrollRef} className="kube-table-scroll"
          onContextMenu={event => open(event, { type: 'background' })}
          onScroll={event => setScroll({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
          <table className="kube-table">
            <thead>
              <tr>
                {columns.map(column => {
                  const sorted = view.sort?.key === column.key;
                  return (
                    <th key={column.key} scope="col" className={isNumeric(column) ? 'kube-num' : undefined}
                      onContextMenu={event => open(event, { type: 'header', column })}
                      aria-sort={sorted ? (view.sort?.dir === 'desc' ? 'descending' : 'ascending') : undefined}
                      onClick={() => dispatch({ type: 'sort', key: column.key })}>
                      {column.label}{sorted ? (view.sort?.dir === 'desc' ? ' ▾' : ' ▴') : ''}
                    </th>
                  );
                })}
              </tr>
              <tr className="kube-filter-row">
                {columns.map(column => (
                  <th key={column.key} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
                    <FilterField column={column} current={view.filters[column.key] ?? ''} options={facets[column.key]} dispatch={dispatch} tableRef={tableRef} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {first > 0 && <tr className="kube-spacer" aria-hidden="true"><td colSpan={columns.length} style={{ height: first * ROW_HEIGHT }} /></tr>}
              {shown.map(item => {
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
                const selected = row.uid === state.selected;
                const busy = state.busy.includes(row.uid);
                return (
                  <tr key={row.uid} className={`kube-row kube-tone-${row.tone}${selected ? ' kube-row-selected' : ''}${busy ? ' ctr-busy' : ''}`}
                    aria-selected={selected} aria-busy={busy || undefined}
                    onClick={() => dispatch({ type: 'select', uid: row.uid })}
                    onContextMenu={event => { dispatch({ type: 'select', uid: row.uid }); open(event, rowMenuTarget(row)); }}
                    onDoubleClick={() => {
                      dispatch({ type: 'select', uid: row.uid });
                      dispatch({ type: 'dock', mode: kind === 'containers' ? 'logs' : 'inspect' });
                    }}>
                    {columns.map(column => (
                      <td key={column.key} className={isNumeric(column) ? 'kube-num' : undefined}>{displayCell(row, column, now)}</td>
                    ))}
                  </tr>
                );
              })}
              {last < items.length && <tr className="kube-spacer" aria-hidden="true"><td colSpan={columns.length} style={{ height: (items.length - last) * ROW_HEIGHT }} /></tr>}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="kube-empty-block">
              <p className={`kube-empty${problem ? ' error-message' : ''}`} role={problem ? 'alert' : undefined}>{emptyText}</p>
              {!problem && allRows.length > 0 && filtered && (
                <button type="button" className="kube-empty-action" onClick={() => dispatch({ type: 'clearFilter' })}>{t('containers:table.resetFilters')}</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const isNumeric = (column: ContainerColumn): boolean => column.filter === 'number' || column.filter === 'size';

/** Enter and Escape hand the focus back to the table so the hotkeys work again. */
function returnFocus(event: KeyboardEvent<HTMLElement>, tableRef: RefObject<HTMLDivElement | null>): void {
  if (event.key !== 'Enter' && event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  tableRef.current?.focus({ preventScroll: true });
}

interface FilterFieldProps {
  column: ContainerColumn;
  /** Raw stored value of this column's filter. */
  current: string;
  /** Facet options of a select column. */
  options?: readonly { value: string; label: string }[] | undefined;
  dispatch: (action: ContainerViewAction) => void;
  tableRef: RefObject<HTMLDivElement | null>;
}

/** One cell of the filter row; `data-column-filter` is the hook the view's `/` focuses. */
function FilterField({ column, current, options = [], dispatch, tableRef }: FilterFieldProps) {
  const { t } = useT();
  const key = column.key;
  const set = (value: string) => dispatch({ type: 'setColumnFilter', key, value });
  if (column.filter === 'select') {
    return (
      <select data-column-filter={key} aria-label={t('containers:table.filterOf', { column: column.label })} value={current}
        onKeyDown={event => returnFocus(event, tableRef)}
        onChange={event => { set(event.target.value); tableRef.current?.focus({ preventScroll: true }); }}>
        <option value="">{t('containers:table.all')}</option>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        {current !== '' && !options.some(option => option.value === current) && <option value={current}>{current}</option>}
      </select>
    );
  }
  const valid = isValidColumnFilter(column, current);
  const hintKey = column.filter === 'number' || column.filter === 'size' || column.filter === 'age' ? HINT_KEYS[column.filter] : undefined;
  const hint = hintKey === undefined ? undefined : t(hintKey);
  const title = hint === undefined ? undefined : valid ? hint : t('containers:table.invalid', { hint });
  return (
    <span className="kube-col-filter">
      <input type="text" size={1} data-column-filter={key} aria-label={t('containers:table.filterOf', { column: column.label })} placeholder={t('containers:table.placeholder')} maxLength={100}
        spellCheck={false} autoComplete="off" value={current} aria-invalid={!valid} className={valid ? undefined : 'kube-filter-invalid'} title={title}
        onChange={event => set(event.target.value)}
        onKeyDown={event => returnFocus(event, tableRef)} />
      {current && <button type="button" className="kube-col-filter-clear" aria-label={t('containers:table.clearFilterOf', { column: column.label })} onClick={() => set('')}>×</button>}
    </span>
  );
}
