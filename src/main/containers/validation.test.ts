import { describe, expect, it } from 'vitest';
import { ActionRequestSchema, InspectRequestSchema, InventoryActionRequestSchema, InventoryRequestSchema, ListRequestSchema } from './validation';

describe('container IPC validation', () => {
  it('accepts valid requests', () => {
    expect(ListRequestSchema.safeParse({ hostId: 'h1' }).success).toBe(true);
    expect(ActionRequestSchema.safeParse({ hostId: 'h1', target: { kind: 'lxc', vmid: 101, name: 'ct' }, action: 'shutdown' }).success).toBe(true);
  });
  it('rejects command text, unknown actions and extra fields', () => {
    expect(ActionRequestSchema.safeParse({ hostId: 'h1', target: { kind: 'container', runtime: 'docker', ref: 'a; rm -rf /', name: 'a' }, action: 'stop' }).success).toBe(false);
    expect(ActionRequestSchema.safeParse({ hostId: 'h1', target: { kind: 'vm', vmid: 100, name: 'x' }, action: 'exec' }).success).toBe(false);
    expect(ListRequestSchema.safeParse({ hostId: 'h1', command: 'id' }).success).toBe(false);
  });
  it('validates inventory requests', () => {
    const target = { kind: 'containers', runtime: 'docker', ref: 'web-1' };
    expect(InventoryRequestSchema.safeParse({ hostId: 'h1', runtime: 'podman' }).success).toBe(true);
    expect(InventoryRequestSchema.safeParse({ hostId: 'h1', runtime: 'lxc' }).success).toBe(false);
    expect(InspectRequestSchema.safeParse({ hostId: 'h1', ref: target }).success).toBe(true);
    expect(InventoryActionRequestSchema.safeParse({ hostId: 'h1', target, action: 'remove' }).success).toBe(true);
    expect(InventoryActionRequestSchema.safeParse({ hostId: 'h1', target, action: 'shutdown' }).success).toBe(false);
  });
  it('keeps remove away from container targets', () => {
    const target = { kind: 'container', runtime: 'docker', ref: 'web-1', name: 'web-1' };
    expect(ActionRequestSchema.safeParse({ hostId: 'h1', target, action: 'remove' }).success).toBe(false);
    expect(InventoryActionRequestSchema.safeParse({ hostId: 'h1', target, action: 'remove' }).success).toBe(false);
  });
});
