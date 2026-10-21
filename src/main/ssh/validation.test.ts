import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AckSchema, InputSchema, parseRequest, PrepareSchema, ResizeSchema } from './validation';

describe('SSH IPC input validation', () => {
  const sessionId = randomUUID();
  it('accepts only a saved connection ID and bounded terminal dimensions', () => {
    expect(parseRequest(PrepareSchema, { connectionId: 'id', cols: 80, rows: 24 })).toEqual({ connectionId: 'id', cols: 80, rows: 24 });
    expect(() => parseRequest(PrepareSchema, { connectionId: 'id', cols: 80, rows: 24, host: 'injected', password: 'synthetic' })).toThrow(expect.objectContaining({ code: 'ssh.invalidRequest' }));
    expect(() => parseRequest(PrepareSchema, { connectionId: 'id', cols: 501, rows: 24 })).toThrow();
    expect(() => parseRequest(ResizeSchema, { sessionId, cols: 80.1, rows: 24 })).toThrow();
  });
  it('rejects malformed session IDs, oversized input and invalid acknowledgments without exposing payloads', () => {
    expect(() => parseRequest(InputSchema, { sessionId: 'wrong', data: 'synthetic-secret' })).toThrow(expect.objectContaining({ code: 'ssh.invalidRequest' }));
    expect(() => parseRequest(InputSchema, { sessionId, data: 'x'.repeat(16385) })).toThrow();
    expect(() => parseRequest(AckSchema, { sessionId, sequence: -1 })).toThrow();
  });
  it('never accepts commands or a login switch from the renderer', () => {
    const base = { connectionId: 'c1', cols: 80, rows: 24 };
    expect(PrepareSchema.safeParse({ ...base, skipLogin: true }).success).toBe(false);
    expect(PrepareSchema.safeParse({ ...base, commands: ['id'] }).success).toBe(false);
  });
  it('accepts an optional container target and rejects malformed ones', () => {
    const base = { connectionId: 'c1', cols: 80, rows: 24 };
    expect(PrepareSchema.safeParse({ ...base, target: { item: { kind: 'lxc', vmid: 101, name: 'ct' }, mode: 'shell' } }).success).toBe(true);
    expect(PrepareSchema.safeParse({ ...base, target: { item: { kind: 'lxc', vmid: 101, name: 'ct' }, mode: 'exec' } }).success).toBe(false);
    expect(PrepareSchema.safeParse({ ...base, target: { item: { kind: 'container', runtime: 'docker', ref: 'a b', name: 'a' }, mode: 'shell' } }).success).toBe(false);
  });
});
