import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { RdpSessionManager, rdpStatusError, splitAccount } from './host';

vi.mock('electron', () => ({ screen: { dipToScreenRect: (_window: unknown, rect: unknown) => rect } }));
vi.mock('node:child_process', () => ({
  spawn: () => Object.assign(Object.assign(new (require('node:events').EventEmitter)(), {
    stdin: Object.assign(new (require('node:events').EventEmitter)(), { write: () => true, end: () => undefined }),
    stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null,
  })),
}));

function openSession(emit: (ownerId: number, event: unknown) => void): { manager: RdpSessionManager; sessionId: string; receive(line: string): void } {
  const manager = new RdpSessionManager({ executable: 'x', mode: 'owned' as never, getTarget: () => ({ host: 'h', port: 3389, clipboard: false }), emit });
  const window = {
    getNativeWindowHandle: () => Buffer.alloc(8), getContentBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    webContents: { getZoomFactor: () => 1 }, on: () => undefined, isDestroyed: () => false,
  } as unknown as BrowserWindow;
  const { sessionId } = manager.open(7, window, { connectionId: 'c', bounds: { x: 0, y: 0, width: 1, height: 1 }, visible: true } as never);
  return { manager, sessionId, receive: line => (manager as unknown as { receive(line: string): void }).receive(line) };
}

describe('helper error lines', () => {
  it('ends a session whose open failed', () => {
    const emit = vi.fn();
    const { manager, sessionId, receive } = openSession(emit);
    receive(JSON.stringify({ type: 'error', sessionId, message: 'x' }));
    expect(emit).toHaveBeenCalledWith(7, { type: 'status', sessionId, status: 'error', error: { code: 'core.rdpFailed', detail: 'x' } });
    expect(manager.owns(7, sessionId)).toBe(false);
  });
  it('ignores an error line without a known session', () => {
    const emit = vi.fn();
    const { receive } = openSession(emit);
    receive(JSON.stringify({ type: 'error', message: 'x' }));
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('splitAccount', () => {
  it('splits DOMAIN\\user and keeps UPNs and plain names intact', () => {
    expect(splitAccount('EXAMPLE\\administrator')).toEqual({ domain: 'EXAMPLE', username: 'administrator' });
    expect(splitAccount('admin@example.test')).toEqual({ username: 'admin@example.test' });
    expect(splitAccount(' admin ')).toEqual({ username: 'admin' });
    expect(splitAccount('')).toEqual({});
    expect(splitAccount(undefined)).toEqual({});
  });
  it('does not treat a leading backslash as an empty domain', () => {
    expect(splitAccount('\\admin')).toEqual({ username: '\\admin' });
  });
});

describe('rdpStatusError limits', () => {
  it('truncates a long helper text to 500 characters', () => {
    const long = 'x'.repeat(600);
    expect(rdpStatusError('error', long)?.detail).toHaveLength(500);
    expect(rdpStatusError('disconnected', long)?.detail).toHaveLength(500);
  });
});

describe('rdpStatusError', () => {
  it('keeps the native helper text only as detail of a core.rdp* code', () => {
    expect(rdpStatusError('error', 'Zeitüberschreitung')).toEqual({ code: 'core.rdpFailed', detail: 'Zeitüberschreitung' });
    expect(rdpStatusError('error')).toEqual({ code: 'core.rdpFailed' });
    expect(rdpStatusError('disconnected', 'Getrennt')).toEqual({ code: 'core.rdpDisconnected', detail: 'Getrennt' });
  });
  it('reports nothing for a plain disconnect', () => {
    expect(rdpStatusError('disconnected')).toBeUndefined();
  });
});
