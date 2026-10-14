import { describe, expect, it } from 'vitest';
import { ActionRequestSchema, ListRequestSchema } from './validation';

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
});
