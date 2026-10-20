import { describe, expect, it } from 'vitest';
import type { InventoryKind, InventoryRow } from '../../shared/containers';
import {
  COLUMNS, FILTER_HELP, cellValues, columnsFor, compileColumnFilters, displayCell, facetValues, formatBytes, groupOptionsFor,
  groupRows, isValidColumnFilter, parseSizeFilter, primaryFilterColumn,
} from './container-columns';
import { EMPTY_VALUE } from './kube-columns';
import { setFormatLocale } from '../../shared/format';

const NOW = Date.parse('2026-10-18T12:00:00Z');

function row(kind: InventoryKind, name: string, cells: Record<string, string | number> = {}): InventoryRow {
  return { uid: `docker:${kind}:${name}`, ref: { kind, runtime: 'docker', ref: name }, id: name, name, cells: { name, ...cells }, tone: 'ok', labels: {} };
}
const col = (kind: InventoryKind, key: string) => COLUMNS[kind].find(column => column.key === key)!;

describe('columns', () => {
  it('drops pod for docker only', () => {
    expect(columnsFor('containers', 'docker').map(c => c.key)).not.toContain('pod');
    expect(columnsFor('containers', 'podman').map(c => c.key)).toContain('pod');
    expect(columnsFor('images', 'docker')).toEqual(COLUMNS.images);
  });
  it('uses repository as primary filter of images', () => {
    expect(primaryFilterColumn('images')).toBe('repository');
    expect(primaryFilterColumn('volumes')).toBe('name');
  });
});

describe('cellValues', () => {
  it('splits networks and drops empty markers', () => {
    expect(cellValues(row('containers', 'a', { networks: 'front, back' }), 'networks')).toEqual(['front', 'back']);
    expect(cellValues(row('containers', 'a', { project: '–' }), 'project')).toEqual([]);
    expect(cellValues(row('containers', 'a'), 'pod')).toEqual([]);
    expect(cellValues(row('images', 'a', { usedBy: 0 }), 'usedBy')).toEqual(['0']);
  });
});

describe('parseSizeFilter', () => {
  it('parses operators and units', () => {
    expect(parseSizeFilter('>100MB')).toEqual({ op: '>', bytes: 100_000_000 });
    expect(parseSizeFilter('<= 1.5 GB')).toEqual({ op: '<=', bytes: 1_500_000_000 });
    expect(parseSizeFilter('2048')).toEqual({ op: '=', bytes: 2048 });
    expect(parseSizeFilter('=0')).toEqual({ op: '=', bytes: 0 });
    expect(parseSizeFilter('10 kb')).toEqual({ op: '=', bytes: 10_000 });
    expect(parseSizeFilter('>10XB')).toBeNull();
    expect(parseSizeFilter('abc')).toBeNull();
  });
});

describe('formatBytes and displayCell', () => {
  it('formats decimal sizes', () => {
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(142_000_000)).toBe('142 MB');
    expect(formatBytes(1_200_000_000)).toBe('1.2 GB');
    expect(formatBytes(10_500)).toBe('10.5 kB');
    expect(formatBytes(0)).toBe('0 B');
  });
  it('shows size, age, empty and plain cells', () => {
    const image = row('images', 'a', { size: 142_000_000, created: '2026-10-18T10:00:00Z', usedBy: 2, tag: '' });
    expect(displayCell(image, col('images', 'size'), NOW)).toBe('142 MB');
    expect(displayCell(image, col('images', 'created'), NOW)).toBe('2h');
    expect(displayCell(image, col('images', 'usedBy'), NOW)).toBe('2');
    expect(displayCell(image, col('images', 'tag'), NOW)).toBe('–');
    expect(displayCell(row('images', 'b', { size: '' }), col('images', 'size'), NOW)).toBe('–');
  });
});

describe('column filters', () => {
  const rows = [
    row('images', 'a', { repository: 'nginx', size: 142_000_000, usedBy: 2, created: '2026-10-18T11:55:00Z' }),
    row('images', 'b', { repository: 'redis', size: 50_000_000, usedBy: 0, created: '2026-10-10T00:00:00Z' }),
    row('images', 'c', { repository: 'web', size: '', usedBy: '' }),
  ];
  const columns = COLUMNS.images;
  const names = (filters: Record<string, string>) => rows.filter(compileColumnFilters(columns, filters, NOW)).map(r => r.name);

  it('filters text, size, number and age', () => {
    expect(names({ repository: 'NGI' })).toEqual(['a']);
    expect(names({ size: '>100MB' })).toEqual(['a']);
    expect(names({ size: '<=50000000' })).toEqual(['b']);
    expect(names({ usedBy: '=0' })).toEqual(['b']);
    expect(names({ usedBy: '>0' })).toEqual(['a']);
    expect(names({ created: '<10m' })).toEqual(['a']);
    expect(names({ created: '>1d' })).toEqual(['b']);
  });
  it('treats invalid filters as matching all', () => {
    expect(names({ size: '>10XB', usedBy: 'x', created: '5' })).toEqual(['a', 'b', 'c']);
    expect(isValidColumnFilter(col('images', 'size'), '>10XB')).toBe(false);
    expect(isValidColumnFilter(col('images', 'size'), '>10MB')).toBe(true);
    expect(isValidColumnFilter(col('images', 'usedBy'), 'x')).toBe(false);
    expect(isValidColumnFilter(col('images', 'created'), '5')).toBe(false);
    expect(isValidColumnFilter(col('images', 'size'), '  ')).toBe(true);
    expect(isValidColumnFilter(col('images', 'repository'), '???')).toBe(true);
  });
  it('select matches exactly, networks per value, and EMPTY_VALUE the empty cell', () => {
    const containers = [
      row('containers', 'x', { status: 'running', networks: 'front, back', project: 'shop' }),
      row('containers', 'y', { status: 'exited', networks: 'front', project: '' }),
    ];
    const cols = columnsFor('containers', 'docker');
    const pick = (filters: Record<string, string>) => containers.filter(compileColumnFilters(cols, filters, NOW)).map(r => r.name);
    expect(pick({ status: 'running' })).toEqual(['x']);
    expect(pick({ status: 'run' })).toEqual([]);
    expect(pick({ networks: 'back' })).toEqual(['x']);
    expect(pick({ networks: 'front' })).toEqual(['x', 'y']);
    expect(pick({ project: EMPTY_VALUE })).toEqual(['y']);
  });
});

describe('facetValues', () => {
  const cols = columnsFor('containers', 'docker');
  const rows = [
    row('containers', 'a', { status: 'running', project: 'shop' }),
    row('containers', 'b', { status: 'exited', project: 'shop' }),
    row('containers', 'c', { status: 'running', project: '' }),
  ];
  const all = () => true;
  it('counts among rows passing the other filters', () => {
    const status = col('containers', 'status');
    expect(facetValues(rows, cols, status, undefined, NOW, all).map(o => o.label)).toEqual(['exited (1)', 'running (2)']);
    expect(facetValues(rows, cols, status, { project: 'shop' }, NOW, all).map(o => o.label)).toEqual(['exited (1)', 'running (1)']);
    const project = col('containers', 'project');
    expect(facetValues(rows, cols, project, undefined, NOW, all).map(o => o.value)).toEqual(['shop', EMPTY_VALUE]);
  });
  it('ignores the own filter and keeps a selection without matches at 0', () => {
    const status = col('containers', 'status');
    const options = facetValues(rows, cols, status, { status: 'exited', project: EMPTY_VALUE }, NOW, all);
    expect(options).toEqual([
      { value: 'exited', label: 'exited (0)', count: 0 },
      { value: 'running', label: 'running (1)', count: 1 },
    ]);
  });
  it('applies the other predicate', () => {
    const status = col('containers', 'status');
    expect(facetValues(rows, cols, status, undefined, NOW, r => r.name !== 'a').map(o => o.label)).toEqual(['exited (1)', 'running (1)']);
  });
});

describe('grouping', () => {
  it('offers pod only for podman', () => {
    expect(groupOptionsFor('containers', 'docker').map(o => o.id)).toEqual(['project', 'status', 'image']);
    expect(groupOptionsFor('containers', 'podman').map(o => o.id)).toContain('pod');
    expect(groupOptionsFor('networks', 'docker').map(o => o.id)).toEqual(['driver']);
    expect(groupOptionsFor('images', 'docker').map(o => o.id)).toEqual(['repository']);
  });
  const rows = [
    row('containers', 'a', { project: 'shop' }),
    row('containers', 'b', { project: '' }),
    row('containers', 'c', { project: 'blog' }),
    row('containers', 'd', { project: 'shop' }),
  ];
  const options = groupOptionsFor('containers', 'docker');
  it('keeps order without grouping', () => {
    expect(groupRows(rows, options, null, []).map(i => i.type)).toEqual(['row', 'row', 'row', 'row']);
    expect(groupRows(rows, options, 'pod', []).length).toBe(4);
  });
  it('sorts groups with the empty one last and honours collapsed', () => {
    const items = groupRows(rows, options, 'project', ['shop']);
    expect(items.map(i => (i.type === 'group' ? `G:${i.label}:${i.count}:${i.collapsed}` : i.row.name))).toEqual([
      'G:blog:1:false', 'c', 'G:shop:2:true', `G:${EMPTY_VALUE}:1:false`, 'b',
    ]);
  });
});

describe('FILTER_HELP', () => {
  it('has the five forms', () => {
    expect(FILTER_HELP.map(f => f.form)).toEqual(['Text', 'Auswahl', 'Zahl', 'Größe', 'Alter']);
    expect(FILTER_HELP[3]).toEqual({ form: 'Größe', description: 'Vergleich in Bytes, Einheiten B, kB, MB, GB, TB', example: '>100MB' });
  });
});
