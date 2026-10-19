import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from './i18n';
import { CHIPS } from '../../shared/kube-status';
import { KIND_COLUMNS, KUBE_KINDS } from '../../shared/kubernetes';
import { chipLabel, columnLabel } from './kube-labels';

afterEach(async () => { await i18n.changeLanguage('de-DE'); });

describe('columnLabel', () => {
  it('names every column of every kind in German', () => {
    expect(columnLabel('name')).toBe('Name');
    expect(columnLabel('age')).toBe('Alter');
    expect(columnLabel('upToDate')).toBe('Aktuell');
    expect(columnLabel('lastRun')).toBe('Letzter Lauf');
    expect(columnLabel('memory')).toBe('RAM');
    expect(columnLabel('clusterIp')).toBe('Cluster-IP');
    expect(columnLabel('namespace')).toBe('Namespace');
    expect(columnLabel('container')).toBe('Container');
    for (const kind of KUBE_KINDS) for (const column of KIND_COLUMNS[kind]) expect(columnLabel(column.key)).not.toBe(column.key);
  });
  it('follows the UI language', async () => {
    await i18n.changeLanguage('en-US');
    expect(columnLabel('age')).toBe('Age');
    expect(columnLabel('lastRun')).toBe('Last run');
  });
  it('returns an unknown key unchanged', () => {
    expect(columnLabel('image:web')).toBe('image:web');
    expect(columnLabel('constructor')).toBe('constructor');
  });
});

describe('chipLabel', () => {
  it('names every chip of every kind', () => {
    expect(chipLabel('attention')).toBe('Auffällig');
    expect(chipLabel('running')).toBe('Läuft');
    expect(chipLabel('5m')).toBe('Letzte 5 min');
    for (const kind of KUBE_KINDS) for (const chip of CHIPS[kind]) expect(chipLabel(chip.id, kind)).not.toBe(chip.id);
  });
  it('tells the pod and job chip "failed" apart by kind', () => {
    expect(chipLabel('failed')).toBe('Fehler');
    expect(chipLabel('failed', 'pods')).toBe('Fehler');
    expect(chipLabel('failed', 'jobs')).toBe('Fehlgeschlagen');
  });
  it('follows the UI language', async () => {
    await i18n.changeLanguage('en-US');
    expect(chipLabel('attention')).toBe('Needs attention');
    expect(chipLabel('failed', 'jobs')).toBe('Failed');
  });
  it('returns an unknown id unchanged', () => {
    expect(chipLabel('nope')).toBe('nope');
    expect(chipLabel('toString')).toBe('toString');
  });
});
