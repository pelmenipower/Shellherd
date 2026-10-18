import { describe, expect, it } from 'vitest';
import { LOCAL_CONTAINER_HOST, type InventoryKind, type InventoryRow } from '../../shared/containers';
import { confirmationFor, hostLabel } from './container-confirm';

const row = (kind: InventoryKind, name: string): InventoryRow => ({
  uid: 'u', ref: { kind, runtime: 'docker', ref: name }, id: 'x', name, cells: {}, tone: 'ok', labels: {},
});

describe('hostLabel', () => {
  it('says "diesem Computer" locally and the host name otherwise', () => {
    expect(hostLabel(LOCAL_CONTAINER_HOST, 'Dieser Computer')).toBe('diesem Computer');
    expect(hostLabel('ssh-1', 'srv')).toBe('srv');
  });
});

describe('confirmationFor', () => {
  it('runs start without a dialog', () => {
    expect(confirmationFor(row('containers', 'web-1'), 'start', 'srv')).toBeNull();
  });
  it('words stop and restart without typing', () => {
    expect(confirmationFor(row('containers', 'web-1'), 'stop', 'diesem Computer')).toEqual({
      title: 'Container stoppen?', body: 'Container „web-1“ auf diesem Computer wird gestoppt.', requireTyping: null, confirmLabel: 'Stoppen',
    });
    expect(confirmationFor(row('containers', 'web-1'), 'restart', 'srv')).toEqual({
      title: 'Container neu starten?', body: 'Container „web-1“ auf srv wird neu gestartet.', requireTyping: null, confirmLabel: 'Neu starten',
    });
  });
  it('words remove per kind and requires typing the name', () => {
    expect(confirmationFor(row('containers', 'web-1'), 'remove', 'srv')).toEqual({
      title: 'Container entfernen?',
      body: 'Container „web-1“ auf srv wird entfernt. Anonyme Volumes bleiben erhalten und erscheinen unter Volumes.',
      requireTyping: 'web-1', confirmLabel: 'Entfernen',
    });
    expect(confirmationFor(row('images', 'nginx:1.27'), 'remove', 'srv')).toEqual({
      title: 'Image entfernen?', body: 'Image „nginx:1.27“ auf srv wird entfernt.', requireTyping: 'nginx:1.27', confirmLabel: 'Entfernen',
    });
    expect(confirmationFor(row('volumes', 'data'), 'remove', 'srv')).toEqual({
      title: 'Volume entfernen?', body: 'Volume „data“ auf srv wird gelöscht. Die Daten gehen verloren.', requireTyping: 'data', confirmLabel: 'Entfernen',
    });
  });
});
