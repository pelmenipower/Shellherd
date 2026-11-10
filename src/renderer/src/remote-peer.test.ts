import { describe, expect, it, vi } from 'vitest';
import type { RemoteLabEvent, RemoteLabReply, RemoteLabRequest, RemoteLabState } from '../../shared/remote-lab';
import { RemoteSessionController } from './remote-peer';

const idle: RemoteLabState = { phase: 'online' };

function setup(opts: { reply?: (r: RemoteLabRequest) => RemoteLabReply } = {}) {
  const requests: RemoteLabRequest[] = [];
  let listener: (e: RemoteLabEvent) => void = () => {};
  const unsubscribe = vi.fn();
  const api = {
    remoteLabAction: vi.fn(async (r: RemoteLabRequest): Promise<RemoteLabReply> => {
      requests.push(r);
      return opts.reply ? opts.reply(r) : { ok: true, state: idle };
    }),
    onRemoteLabEvent: (l: (e: RemoteLabEvent) => void) => { listener = l; return unsubscribe; }
  };
  const controller = new RemoteSessionController(api, 'c1');
  return { controller, api, requests, kinds: () => requests.map(r => r.kind), emit: (e: RemoteLabEvent) => listener(e), unsubscribe };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('RemoteSessionController act', () => {
  it('adds the clientId, applies the state and clears the error', async () => {
    const t = setup({ reply: () => ({ ok: true, state: { phase: 'signedIn' } }) });
    const seen: unknown[] = [];
    t.controller.subscribe(v => seen.push(v));
    expect(seen).toHaveLength(1);
    await t.controller.act({ kind: 'connect', serverUrl: 'http://x' });
    expect(t.requests[0]).toEqual({ kind: 'connect', serverUrl: 'http://x', clientId: 'c1' });
    expect(t.controller.view.state.phase).toBe('signedIn');
    expect(t.controller.view.error).toBeUndefined();
  });

  it('records error codes and maps an IPC throw to connection', async () => {
    const t = setup({ reply: () => ({ ok: false, code: 'limit' }) });
    await t.controller.act({ kind: 'status' });
    expect(t.controller.view.error).toBe('limit');
    t.controller.clearError();
    expect(t.controller.view.error).toBeUndefined();
    t.api.remoteLabAction.mockRejectedValueOnce(new Error('x'));
    const reply = await t.controller.act({ kind: 'status' });
    expect(reply).toEqual({ ok: false, code: 'connection' });
    expect(t.controller.view.error).toBe('connection');
  });

  it('remembers the device name of goOnline', async () => {
    const t = setup();
    await t.controller.act({ kind: 'goOnline', deviceName: 'Laptop' });
    expect(t.controller.deviceName).toBe('Laptop');
  });

  it('applies state and error events', () => {
    const t = setup();
    t.emit({ kind: 'state', state: { phase: 'signedIn' } });
    expect(t.controller.view.state.phase).toBe('signedIn');
    t.emit({ kind: 'error', code: 'mediaWindow' });
    expect(t.controller.view.error).toBe('mediaWindow');
  });
});

describe('RemoteSessionController share (agent)', () => {
  it('sends only armCapture', async () => {
    const t = setup();
    await t.controller.share('s1', 'abcd');
    expect(t.requests).toEqual([{ kind: 'armCapture', sessionId: 's1', verification: 'abcd', clientId: 'c1' }]);
  });

  it('records the error when armCapture is refused', async () => {
    const t = setup({ reply: () => ({ ok: false, code: 'stale' }) });
    await t.controller.share('s1', null);
    expect(t.kinds()).toEqual(['armCapture']);
    expect(t.controller.view.error).toBe('stale');
  });
});

describe('RemoteSessionController events and stop', () => {
  it('sets ended on an ended event and sends nothing back', async () => {
    const t = setup();
    t.emit({ kind: 'ended', sessionId: 's1', reason: 'remote' });
    await flush();
    expect(t.controller.view.ended).toBe('remote');
    expect(t.requests).toEqual([]);
  });

  it('stop() sends only stop for the current session and marks it stopped', async () => {
    const t = setup();
    t.emit({ kind: 'state', state: { phase: 'online', session: { id: 's1', role: 'viewer', peer: { id: 'x', name: 'n' }, scope: 'view', state: 'active', expiresAt: 1 } } });
    t.controller.stop();
    await flush();
    expect(t.requests).toEqual([{ kind: 'stop', sessionId: 's1', clientId: 'c1' }]);
    expect(t.controller.view.ended).toBe('stopped');
  });

  it('never sends accept, signal or stopped', async () => {
    const t = setup();
    await t.controller.share('s1', null);
    t.emit({ kind: 'ended', sessionId: 's1', reason: 'failed' });
    t.controller.stop();
    await flush();
    for (const kind of t.kinds()) expect(['accept', 'signal', 'stopped']).not.toContain(kind);
  });

  it('dispose unsubscribes and silences listeners', () => {
    const t = setup();
    const seen = vi.fn();
    t.controller.subscribe(seen);
    t.controller.dispose();
    expect(t.unsubscribe).toHaveBeenCalled();
    seen.mockClear();
    t.emit({ kind: 'state', state: { phase: 'signedIn' } });
    expect(seen).not.toHaveBeenCalled();
  });
});
