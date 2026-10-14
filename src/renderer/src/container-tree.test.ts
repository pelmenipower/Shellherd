import { describe, expect, it } from 'vitest';
import type { DiscoveryResult } from '../../shared/containers';
import { containerTreeReducer, groupItems, hasUsableLocalRuntime, itemCommands } from './container-tree';

const web = { kind: 'container' as const, runtime: 'docker' as const, id: 'a', ref: 'web-1', name: 'web-1', image: 'nginx', state: 'running' as const };
const result: DiscoveryResult = { runtimes: ['docker', 'proxmox'], problems: { proxmox: 'Proxmox-Befehle brauchen root.' },
  items: [web, { kind: 'vm', vmid: 100, name: 'win11', state: 'stopped' }] };

describe('container tree state', () => {
  it('moves through loading, ready, busy and error', () => {
    let state = containerTreeReducer({}, { type: 'loading', hostId: 'h1' });
    expect(state.h1).toEqual({ status: 'loading' });
    state = containerTreeReducer(state, { type: 'loaded', hostId: 'h1', result });
    state = containerTreeReducer(state, { type: 'busy', hostId: 'h1', key: 'container:docker:web-1', busy: true });
    expect(state.h1).toMatchObject({ status: 'ready', busy: ['container:docker:web-1'] });
    state = containerTreeReducer(state, { type: 'notice', hostId: 'h1', key: 'container:docker:web-1', message: 'kaputt' });
    expect(state.h1).toMatchObject({ notice: { key: 'container:docker:web-1', message: 'kaputt' } });
    state = containerTreeReducer(state, { type: 'failed', hostId: 'h1', message: 'weg' });
    expect(state.h1).toEqual({ status: 'error', message: 'weg' });
  });
  it('ignores busy and notice for hosts that are not ready', () => {
    expect(containerTreeReducer({}, { type: 'busy', hostId: 'h1', key: 'x', busy: true })).toEqual({});
  });
});

describe('groupItems', () => {
  it('groups by runtime in a fixed order and keeps problems', () => {
    expect(groupItems(result).map(group => [group.label, group.items.length, group.problem])).toEqual([
      ['Docker', 1, undefined], ['Proxmox LXC', 0, 'Proxmox-Befehle brauchen root.'], ['Proxmox VMs', 1, undefined],
    ]);
  });
  it('shows a problem once for Proxmox and hides empty Proxmox groups without problems', () => {
    const clean: DiscoveryResult = { runtimes: ['proxmox'], problems: {}, items: [{ kind: 'lxc', vmid: 101, name: 'ct', state: 'running' }] };
    expect(groupItems(clean).map(group => group.label)).toEqual(['Proxmox LXC']);
  });
});

describe('itemCommands', () => {
  it('offers what fits the state', () => {
    expect(itemCommands(web).map(command => command.run)).toEqual(['shell', 'logs', 'restart', 'stop']);
    expect(itemCommands({ ...web, state: 'stopped' }).map(command => command.run)).toEqual(['start', 'logs']);
    expect(itemCommands({ kind: 'lxc', vmid: 101, name: 'ct', state: 'running' }).map(command => command.run)).toEqual(['shell', 'shutdown', 'stop']);
    const vmStop = itemCommands({ kind: 'vm', vmid: 100, name: 'win11', state: 'running' }).find(command => command.run === 'stop');
    expect(vmStop?.confirm).toContain('win11');
  });
});

describe('hasUsableLocalRuntime', () => {
  it('needs at least one runtime that answered', () => {
    expect(hasUsableLocalRuntime({ runtimes: ['docker'], items: [], problems: {} })).toBe(true);
    expect(hasUsableLocalRuntime({ runtimes: ['docker'], items: [], problems: { docker: 'Der Docker-Dienst läuft nicht.' } })).toBe(false);
    expect(hasUsableLocalRuntime({ runtimes: [], items: [], problems: {} })).toBe(false);
  });
});
