import { useEffect, useRef, useState, type RefObject } from 'react';
import { KIND_COLUMNS, KIND_INFO, KUBE_KINDS, refKey, type ColumnInfo, type KubeRow } from '../../../../shared/kubernetes';
import { formatAge, formatUsage, sparkline, type KubeViewAction, type KubeViewState } from '../../kube-view';

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
}

/** Kind tabs and the k9s-style table. Keys are handled by the view; this component only renders and scrolls. */
export function ResourceTable({ state, rows, dispatch, tableRef }: ResourceTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 480 });
  const [now, setNow] = useState(() => Date.now());
  const kind = state.query.kind;
  const inContainers = state.containersOf !== null;

  // Ages refresh every ten seconds.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

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

  const columns: ColumnInfo[] = inContainers
    ? [{ key: 'name', label: 'Container' }, { key: 'image', label: 'Image' }]
    : KIND_COLUMNS[kind];
  const windowed = !inContainers && rows.length > WINDOW_THRESHOLD;
  const first = windowed ? Math.max(0, Math.floor(scroll.top / ROW_HEIGHT) - OVERSCAN) : 0;
  const last = windowed ? Math.min(rows.length, first + Math.ceil(scroll.height / ROW_HEIGHT) + 2 * OVERSCAN) : rows.length;
  const visible = rows.slice(first, last);
  const containers = state.containersOf?.containers ?? [];
  const pod = state.containersOf;

  return (
    <div className="kube-table-area">
      <div className="kube-kind-tabs" role="tablist" aria-label="Ressourcen">
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
      <div ref={tableRef} className="kube-table-focus" tabIndex={-1}>
        <div ref={scrollRef} className="kube-table-scroll"
          onScroll={event => setScroll({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
          <table className="kube-table">
            <thead>
              <tr>
                {columns.map(column => {
                  const sorted = !inContainers && state.sort?.key === column.key;
                  return (
                    <th key={column.key} scope="col" className={column.numeric ? 'kube-num' : undefined}
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
                  onClick={() => dispatch({ type: 'selectContainer', name })}>
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
          {!inContainers && rows.length === 0 && <p className="kube-empty">{emptyText(state)}</p>}
        </div>
      </div>
    </div>
  );
}

function emptyText(state: KubeViewState): string {
  if (state.loading) return 'Lade …';
  if (state.filter.trim()) return `Keine Treffer für „${state.filter.trim()}“.`;
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
  const value = row.cells[column.key] ?? (column.key === 'name' ? row.ref.name : '');
  if (column.age) return formatAge(String(value), now);
  return String(value) || '–';
}
