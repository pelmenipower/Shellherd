import { describe, expect, it } from 'vitest';
import {
  CONTAINER_VIEW_SUFFIX, RUNTIME_LABEL, containerTone, containerViewHostName, containerViewTabName, inventoryRefValid, isInventoryRef,
} from './containers';
import type { InventoryRef } from './containers';

describe('containerTone', () => {
  it('rates running containers by health', () => {
    expect(containerTone('running', 'Up 2 hours')).toBe('ok');
    expect(containerTone('running', 'Up 2 hours (healthy)')).toBe('ok');
    expect(containerTone('running', 'Up 2 hours (unhealthy)')).toBe('bad');
    expect(containerTone('running', 'Up 5 seconds (health: starting)')).toBe('warn');
    expect(containerTone('running', 'Up 5 seconds (starting)')).toBe('warn');
    expect(containerTone('running', 'Up (UNHEALTHY)')).toBe('bad');
  });
  it('rates the other states', () => {
    expect(containerTone('restarting', '')).toBe('warn');
    expect(containerTone('paused', '')).toBe('muted');
    expect(containerTone('created', '')).toBe('muted');
    expect(containerTone('dead', '')).toBe('bad');
    expect(containerTone('unknown', '')).toBe('warn');
  });
  it('rates stopped containers by exit code', () => {
    for (const state of ['exited', 'stopped'] as const) {
      expect(containerTone(state, '')).toBe('muted');
      expect(containerTone(state, '', 0)).toBe('muted');
      expect(containerTone(state, '', 137)).toBe('bad');
    }
  });
});

const img = (ref: string): InventoryRef => ({ kind: 'images', runtime: 'docker', ref });
const hex64 = 'a'.repeat(64);

describe('inventoryRefValid', () => {
  it('accepts valid image refs and IDs', () => {
    for (const ref of ['nginx:1.27', 'docker.io/library/nginx:latest', 'registry:5000/a/b:v1', 'harbor.local/proj/img:1.0', 'localhost/app:dev',
      'abcdef012345', hex64, `sha256:${hex64}`, 'sha256:abcdef012345']) {
      expect(inventoryRefValid(img(ref)), ref).toBe(true);
    }
  });
  it('rejects unsafe or malformed image refs', () => {
    for (const ref of ['<none>:<none>', 'nginx', 'a b:1', 'x:1; rm -rf /', '$(id):1', '-f', '--force', '-rf:1', `nginx@sha256:${hex64}`, `a:${'b'.repeat(300)}`]) {
      expect(inventoryRefValid(img(ref)), ref).toBe(false);
    }
  });
  it('rejects an unknown runtime or kind and bad names', () => {
    expect(inventoryRefValid({ kind: 'images', runtime: 'proxmox' as never, ref: 'nginx:1' })).toBe(false);
    expect(inventoryRefValid({ kind: 'pods' as never, runtime: 'docker', ref: 'web' })).toBe(false);
    expect(inventoryRefValid({ kind: 'volumes', runtime: 'docker', ref: '-v' })).toBe(false);
    expect(inventoryRefValid({ kind: 'containers', runtime: 'podman', ref: 'web-1' })).toBe(true);
    expect(inventoryRefValid({ kind: 'networks', runtime: 'docker', ref: 'a b' })).toBe(false);
  });
});

describe('isInventoryRef', () => {
  it('tells inventory refs from container targets', () => {
    expect(isInventoryRef({ kind: 'volumes', runtime: 'docker', ref: 'data' })).toBe(true);
    expect(isInventoryRef({ kind: 'container', runtime: 'docker', ref: 'web', name: 'web' })).toBe(false);
    expect(isInventoryRef({ kind: 'lxc', vmid: 101, name: 'ct' })).toBe(false);
  });
});

describe('containerViewHostName', () => {
  it('strips only a trailing suffix', () => {
    expect(containerViewHostName(`srv${CONTAINER_VIEW_SUFFIX}`)).toBe('srv');
    expect(containerViewHostName('srv')).toBe('srv');
    expect(containerViewHostName(`${CONTAINER_VIEW_SUFFIX}x`)).toBe(`${CONTAINER_VIEW_SUFFIX}x`);
  });
  it('strips the runtime suffixes too', () => {
    expect(containerViewHostName('srv · Docker')).toBe('srv');
    expect(containerViewHostName('srv · Podman')).toBe('srv');
    expect(containerViewHostName('srv · Dockerx')).toBe('srv · Dockerx');
    expect(containerViewHostName('srv · Docker · Docker')).toBe('srv · Docker');
  });
});

describe('containerViewTabName', () => {
  it('appends the runtime or Container', () => {
    expect(containerViewTabName('srv')).toBe('srv · Container');
    expect(containerViewTabName('srv', 'docker')).toBe('srv · Docker');
    expect(containerViewTabName('srv', 'podman')).toBe('srv · Podman');
  });
});

describe('RUNTIME_LABEL', () => {
  it('labels both runtimes', () => {
    expect(RUNTIME_LABEL).toEqual({ docker: 'Docker', podman: 'Podman' });
  });
});
