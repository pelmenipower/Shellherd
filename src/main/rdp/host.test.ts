import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { RdpSessionManager, rdpStatusError, splitAccount } from './host';

vi.mock('electron', () => ({ screen: { dipToScreenRect: (_window: unknown, rect: unknown) => rect } }));
const spawned = vi.hoisted(() => ({ count: 0, lines: [] as string[] }));
vi.mock('node:child_process', () => ({
  spawn: () => {
    spawned.count += 1;
    return Object.assign(Object.assign(new (require('node:events').EventEmitter)(), {
      stdin: Object.assign(new (require('node:events').EventEmitter)(), { write: (line: string) => { spawned.lines.push(line.trim()); return true; }, end: () => undefined }),
      stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null,
    }));
  },
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

describe('hasConnected', () => {
  it('is false without a session and true once the login completed', () => {
    const { manager, sessionId, receive } = openSession(vi.fn());
    expect(new RdpSessionManager({ executable: 'x', mode: 'owned' as never, getTarget: () => ({ host: 'h', port: 3389, clipboard: false }), emit: vi.fn() }).hasConnected()).toBe(false);
    expect(manager.hasConnected()).toBe(false);
    receive(JSON.stringify({ type: 'status', sessionId, status: 'loginComplete' }));
    expect(manager.hasConnected()).toBe(true);
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

describe('protect', () => {
  const make = (emit = vi.fn()): RdpSessionManager => new RdpSessionManager({ executable: 'x', mode: 'owned' as never, getTarget: () => ({ host: 'h', port: 3389, clipboard: false }), emit });
  const window = {
    getNativeWindowHandle: () => Buffer.alloc(8), getContentBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    webContents: { getZoomFactor: () => 1 }, on: () => undefined, isDestroyed: () => false,
  } as unknown as BrowserWindow;
  const reset = (): void => { spawned.count = 0; spawned.lines.length = 0; };

  it('does not start the helper without one running', () => {
    reset();
    make().protect(true);
    expect(spawned.count).toBe(0);
  });
  it('writes protect as the first line when the helper starts afterwards', () => {
    reset();
    const manager = make();
    manager.protect(true);
    manager.open(7, window, { connectionId: 'c', bounds: { x: 0, y: 0, width: 1, height: 1 }, visible: true } as never);
    expect(spawned.count).toBe(1);
    expect(JSON.parse(spawned.lines[0])).toEqual({ type: 'protect', protect: true });
    expect(JSON.parse(spawned.lines[1]).type).toBe('open');
  });
  it('writes no protect line at helper start when unprotected', () => {
    reset();
    const manager = make();
    manager.protect(true);
    manager.protect(false);
    manager.open(7, window, { connectionId: 'c', bounds: { x: 0, y: 0, width: 1, height: 1 }, visible: true } as never);
    expect(JSON.parse(spawned.lines[0]).type).toBe('open');
  });
  it('writes exactly one line per change on a running helper', () => {
    reset();
    const manager = make();
    manager.open(7, window, { connectionId: 'c', bounds: { x: 0, y: 0, width: 1, height: 1 }, visible: true } as never);
    spawned.lines.length = 0;
    manager.protect(true);
    expect(spawned.lines.map(line => JSON.parse(line))).toEqual([{ type: 'protect', protect: true }]);
    manager.protect(true);
    expect(spawned.lines).toHaveLength(1);
    manager.protect(false);
    expect(spawned.lines.map(line => JSON.parse(line))).toEqual([{ type: 'protect', protect: true }, { type: 'protect', protect: false }]);
    expect(spawned.count).toBe(1);
  });
  it('does not emit for a protected line', () => {
    const emit = vi.fn();
    const { receive, sessionId } = openSession(emit);
    receive(JSON.stringify({ type: 'protected', sessionId, mode: 'exclude' }));
    expect(emit).not.toHaveBeenCalled();
  });
});
