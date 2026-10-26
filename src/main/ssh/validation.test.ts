import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AckSchema, AuthPromptAnswerSchema, ForwardSchema, InputSchema, parseRequest, PrepareSchema, ResizeSchema } from './validation';

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

describe('SSH auth prompt and port forward validation', () => {
  const promptId = randomUUID();
  const sessionId = randomUUID();
  it('accepts an answer with a UUID, at most eight texts of 1024 characters, or a cancel', () => {
    expect(parseRequest(AuthPromptAnswerSchema, { promptId, answers: ['synthetic-code'] })).toEqual({ promptId, answers: ['synthetic-code'] });
    expect(parseRequest(AuthPromptAnswerSchema, { promptId, answers: null })).toEqual({ promptId, answers: null });
    expect(() => parseRequest(AuthPromptAnswerSchema, { promptId: 'wrong', answers: null })).toThrow(expect.objectContaining({ code: 'ssh.invalidRequest' }));
    expect(() => parseRequest(AuthPromptAnswerSchema, { promptId, answers: Array(9).fill('x') })).toThrow();
    expect(() => parseRequest(AuthPromptAnswerSchema, { promptId, answers: ['x'.repeat(1025)] })).toThrow();
    expect(() => parseRequest(AuthPromptAnswerSchema, { promptId, answers: null, extra: 1 })).toThrow();
  });
  it('accepts a forward request with UUIDs and a boolean run only', () => {
    const forwardId = randomUUID();
    expect(parseRequest(ForwardSchema, { sessionId, forwardId, run: true })).toEqual({ sessionId, forwardId, run: true });
    expect(() => parseRequest(ForwardSchema, { sessionId, forwardId: 'local-1', run: true })).toThrow();
    expect(() => parseRequest(ForwardSchema, { sessionId, forwardId, run: 'yes' })).toThrow();
    expect(() => parseRequest(ForwardSchema, { sessionId, forwardId, run: true, host: 'injected' })).toThrow();
  });
});
