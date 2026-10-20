import { describe, expect, it } from 'vitest';
import type { DiscoveryResult } from '../../shared/containers';
import { containerTreeReducer, groupItems, hasUsableLocalRuntime, itemCommands, runtimeEntries } from './container-tree';

const ct = { kind: 'lxc' as const, vmid: 101, name: 'ct', state: 'running' as const };
const result: DiscoveryResult = { runtimes: ['docker', 'proxmox'], problems: { proxmox: { code: 'containers.proxmoxNeedsRoot' } },
  items: [ct, { kind: 'vm', vmid: 100, name: 'win11', state: 'stopped' }] };

describe('container tree state', () => {
  it('moves through loading, ready, busy and error', () => {
    let state = containerTreeReducer({}, { type: 'loading', hostId: 'h1' });
    expect(state.h1).toEqual({ status: 'loading' });
    state = containerTreeReducer(state, { type: 'loaded', hostId: 'h1', result });
    state = containerTreeReducer(state, { type: 'busy', hostId: 'h1', key: 'lxc:101', busy: true });
    expect(state.h1).toMatchObject({ status: 'ready', busy: ['lxc:101'] });
    state = containerTreeReducer(state, { type: 'notice', hostId: 'h1', key: 'lxc:101', message: 'kaputt' });
    expect(state.h1).toMatchObject({ notice: { key: 'lxc:101', message: 'kaputt' } });
    state = containerTreeReducer(state, { type: 'failed', hostId: 'h1', message: 'weg' });
    expect(state.h1).toEqual({ status: 'error', message: 'weg' });
  });
  it('keeps the result and busy flags while a ready host reloads', () => {
    let state = containerTreeReducer({}, { type: 'loaded', hostId: 'h1', result });
    state = containerTreeReducer(state, { type: 'busy', hostId: 'h1', key: 'lxc:101', busy: true });
    state = containerTreeReducer(state, { type: 'loading', hostId: 'h1' });
    expect(state.h1).toMatchObject({ status: 'ready', result, busy: ['lxc:101'], refreshing: true });
  });
  it('keeps busy flags and an existing notice when a reload finishes', () => {
    let state = containerTreeReducer({}, { type: 'loaded', hostId: 'h1', result });
    state = containerTreeReducer(state, { type: 'busy', hostId: 'h1', key: 'lxc:101', busy: true });
    state = containerTreeReducer(state, { type: 'busy', hostId: 'h1', key: 'vm:100', busy: true });
    state = containerTreeReducer(state, { type: 'notice', hostId: 'h1', key: 'lxc:101', message: 'kaputt' });
    state = containerTreeReducer(state, { type: 'loading', hostId: 'h1' });
    state = containerTreeReducer(state, { type: 'loaded', hostId: 'h1', result });
    expect(state.h1).toMatchObject({ status: 'ready', busy: ['lxc:101', 'vm:100'], notice: { key: 'lxc:101', message: 'kaputt' } });
    expect(state.h1).not.toHaveProperty('refreshing');
  });
  it('shows loading for a host that was never loaded', () => {
    expect(containerTreeReducer({}, { type: 'loading', hostId: 'h1' })).toEqual({ h1: { status: 'loading' } });
  });
  it('ignores busy and notice for hosts that are not ready', () => {
    expect(containerTreeReducer({}, { type: 'busy', hostId: 'h1', key: 'x', busy: true })).toEqual({});
  });
});

describe('runtimeEntries', () => {
  it('lists docker before podman and skips proxmox', () => {
    expect(runtimeEntries({ runtimes: ['podman', 'docker', 'proxmox'], items: [], problems: {} })).toEqual(['docker', 'podman']);
    expect(runtimeEntries({ runtimes: ['proxmox'], items: [], problems: {} })).toEqual([]);
  });
});

describe('groupItems', () => {
  it('returns only Proxmox groups and keeps the problem once', () => {
    expect(groupItems(result).map(group => [group.label, group.items.length, group.problem])).toEqual([
      ['Proxmox LXC', 1, 'Proxmox-Befehle brauchen root. sudo aktivieren oder als root verbinden.'], ['Proxmox VMs', 1, undefined],
    ]);
  });
  it('hides empty Proxmox groups without problems', () => {
    const clean: DiscoveryResult = { runtimes: ['proxmox'], problems: {}, items: [{ kind: 'lxc', vmid: 101, name: 'ct', state: 'running' }] };
    expect(groupItems(clean).map(group => group.label)).toEqual(['Proxmox LXC']);
  });
  it('never yields Docker or Podman groups', () => {
    expect(groupItems({ runtimes: ['docker', 'podman'], items: [], problems: {} })).toEqual([]);
  });
});

describe('itemCommands', () => {
  it('offers what fits the guest state', () => {
    expect(itemCommands(ct).map(command => command.run)).toEqual(['shell', 'shutdown', 'stop']);
    expect(itemCommands({ ...ct, state: 'stopped' }).map(command => command.run)).toEqual(['start']);
    const vmStop = itemCommands({ kind: 'vm', vmid: 100, name: 'win11', state: 'running' }).find(command => command.run === 'stop');
    expect(vmStop?.confirm).toContain('win11');
  });
});

describe('hasUsableLocalRuntime', () => {
  it('is true when docker or podman is listed, even with a problem', () => {
    expect(hasUsableLocalRuntime({ runtimes: ['docker'], items: [], problems: {} })).toBe(true);
    expect(hasUsableLocalRuntime({ runtimes: ['docker'], items: [], problems: { docker: { code: 'containers.dockerNotRunning' } } })).toBe(true);
    expect(hasUsableLocalRuntime({ runtimes: ['proxmox'], items: [], problems: {} })).toBe(false);
    expect(hasUsableLocalRuntime({ runtimes: [], items: [], problems: {} })).toBe(false);
  });
});
