import { describe, expect, it } from 'vitest';
import { ContainerTargetSchema, InventoryRefSchema, TerminalTargetSchema } from './containers-schema';

const web = { kind: 'container', runtime: 'docker', ref: 'web-1', name: 'web-1' };
const ct = { kind: 'lxc', vmid: 101, name: 'ct-web' };

describe('ContainerTargetSchema', () => {
  it('accepts a valid container and an LXC target', () => {
    expect(ContainerTargetSchema.safeParse(web).success).toBe(true);
    expect(ContainerTargetSchema.safeParse(ct).success).toBe(true);
  });
  it('rejects a bad ref', () => {
    expect(ContainerTargetSchema.safeParse({ ...web, ref: 'a b' }).success).toBe(false);
  });
  it('rejects a bad VMID', () => {
    expect(ContainerTargetSchema.safeParse({ ...ct, vmid: 99 }).success).toBe(false);
  });
  it('rejects an extra key', () => {
    expect(ContainerTargetSchema.safeParse({ ...web, extra: true }).success).toBe(false);
  });
});

describe('TerminalTargetSchema', () => {
  it('accepts a valid terminal target and rejects an extra key', () => {
    expect(TerminalTargetSchema.safeParse({ item: web, mode: 'shell' }).success).toBe(true);
    expect(TerminalTargetSchema.safeParse({ item: web, mode: 'shell', extra: 1 }).success).toBe(false);
  });
});

describe('InventoryRefSchema', () => {
  const ref = { kind: 'images', runtime: 'docker', ref: 'nginx:1.27' };
  it('accepts a valid ref', () => {
    expect(InventoryRefSchema.safeParse(ref).success).toBe(true);
  });
  it('rejects an extra key, a bad ref and a bad runtime', () => {
    expect(InventoryRefSchema.safeParse({ ...ref, extra: 1 }).success).toBe(false);
    expect(InventoryRefSchema.safeParse({ ...ref, ref: 'x:1; rm -rf /' }).success).toBe(false);
    expect(InventoryRefSchema.safeParse({ ...ref, runtime: 'proxmox' }).success).toBe(false);
  });
});

describe('TerminalTargetSchema images', () => {
  it('rejects an image as terminal target', () => {
    const item = { kind: 'image', runtime: 'docker', ref: 'nginx:1.27', name: 'nginx' };
    expect(TerminalTargetSchema.safeParse({ item, mode: 'shell' }).success).toBe(false);
  });
});
