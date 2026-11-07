import { describe, expect, it } from 'vitest';
import { PRESENCE_TIMING, PresenceLoop, type PresenceHandlers, type PresenceTimers, type PresenceTransport } from './presence';

class FakeClock implements PresenceTimers {
  t = 0;
  private seq = 0;
  private items = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.items.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.items.delete(handle as number);
  }
  now(): number {
    return this.t;
  }
  get pending(): number {
    return this.items.size;
  }
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      await flush();
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.items) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      this.items.delete(next[0]);
      this.t = Math.max(this.t, next[1].at);
      next[1].fn();
    }
    this.t = end;
    await flush();
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const statusError = (status: number): Error => Object.assign(new Error(`http ${status}`), { status });

function setup(overrides: Partial<PresenceTransport> = {}) {
  const clock = new FakeClock();
  const calls: string[] = [];
  const transport: PresenceTransport = {
    register: async name => { calls.push(`register:${name}`); },
    sessions: async () => { calls.push('sessions'); return [{ id: 's' }]; },
    devices: async () => { calls.push('devices'); return [{ id: 'd' }]; },
    refresh: async () => { calls.push('refresh'); return { expiresAt: 1234 }; },
    unregister: async () => { calls.push('unregister'); },
    ...overrides
  };
  const events: string[] = [];
  const handlers: PresenceHandlers = {
    onSessions: list => events.push(`sessions:${list.length}`),
    onDevices: list => events.push(`devices:${list.length}`),
    onValidUntil: ms => events.push(`valid:${ms}`),
    onOffline: code => events.push(`offline:${code}`)
  };
  const loop = new PresenceLoop(transport, 'Laptop', clock, handlers);
  const count = (name: string): number => calls.filter(c => c === name).length;
  return { clock, calls, events, loop, count };
}

describe('PresenceLoop', () => {
  it('exports the timing constants', () => {
    expect(PRESENCE_TIMING).toEqual({ leaseMs: 30000, pollMs: 5000, refreshMs: 300000, backoffMs: [5000, 10000, 20000], offlineMs: 60000 });
  });

  it('registers once and polls immediately', async () => {
    const { loop, calls, events } = setup();
    await loop.start();
    expect(calls).toEqual(['register:Laptop', 'sessions', 'devices']);
    expect(events).toEqual(['sessions:1', 'devices:1']);
    await loop.stop();
  });

  it('propagates register errors unchanged and schedules nothing', async () => {
    const boom = new Error('boom');
    const { loop, clock, count } = setup({ register: async () => { throw boom; } });
    await expect(loop.start()).rejects.toBe(boom);
    expect(clock.pending).toBe(0);
    expect(count('sessions')).toBe(0);
  });

  it('runs lease every 30 s, poll every 5 s, refresh every 300 s', async () => {
    const { loop, clock, count, events } = setup();
    await loop.start();
    await clock.advance(30000);
    expect(count('register:Laptop')).toBe(2);
    expect(count('sessions')).toBe(1 + 6);
    expect(count('refresh')).toBe(0);
    await clock.advance(270000);
    expect(count('register:Laptop')).toBe(11);
    expect(count('sessions')).toBe(1 + 60);
    expect(count('refresh')).toBe(1);
    expect(events).toContain('valid:1234');
    await loop.stop();
  });

  it('does not overlap a chain: a hanging poll blocks only its own chain', async () => {
    let release: () => void = () => {};
    let first = true;
    const { loop, clock, count } = setup({
      sessions: async () => {
        if (first) { first = false; await new Promise<void>(r => { release = r; }); }
        return [];
      }
    });
    const started = loop.start();
    await flush();
    await clock.advance(60000);
    expect(count('devices')).toBe(0);
    expect(count('register:Laptop')).toBeGreaterThanOrEqual(3); // lease chain keeps running
    release();
    await started;
    await loop.stop();
  });

  it.each(['sessions', 'devices', 'refresh', 'register'] as const)('401 from %s goes offline(authentication) once and stops', async method => {
    let armed = false;
    const { loop, clock, events, count } = setup({
      [method]: async () => {
        if (armed) throw statusError(401);
        return method === 'refresh' ? { expiresAt: 1 } : [];
      }
    } as Partial<PresenceTransport>);
    await loop.start();
    armed = true;
    await clock.advance(400000);
    expect(events.filter(e => e.startsWith('offline'))).toEqual(['offline:authentication']);
    expect(count('unregister')).toBe(1);
    expect(clock.pending).toBe(0);
  });

  it('retries a failed lease after 5/10/20/20 s and goes offline(connection) at 60 s', async () => {
    const times: number[] = [];
    let fail = false;
    const clock0 = { ref: undefined as FakeClock | undefined };
    const { loop, clock, events } = setup({
      register: async () => {
        if (clock0.ref) times.push(clock0.ref.t);
        if (fail) throw statusError(503);
      }
    });
    clock0.ref = clock;
    await loop.start();
    times.length = 0;
    fail = true;
    await clock.advance(30000 + 5000 + 10000 + 20000 + 1000);
    expect(times).toEqual([30000, 35000, 45000, 65000]);
    expect(events.filter(e => e.startsWith('offline'))).toEqual(['offline:connection']);
    await clock.advance(100000);
    expect(times.length).toBe(4);
  });

  it('keeps retrying at 20 s while under 60 s since the last ok lease', async () => {
    const times: number[] = [];
    let fail = false;
    const ref = { clock: undefined as FakeClock | undefined };
    const { loop, clock, events } = setup({
      register: async () => {
        if (ref.clock) times.push(ref.clock.t);
        if (fail) throw statusError(503);
      }
    });
    ref.clock = clock;
    await loop.start();
    await clock.advance(30000); // ok lease at 30 s
    times.length = 0;
    fail = true;
    await clock.advance(30000); // fail at 60 s
    expect(times).toEqual([60000]);
    fail = false;
    await clock.advance(5000); // recovers at 65 s
    expect(events).not.toContain('offline:connection');
    expect(times).toEqual([60000, 65000]);
    await clock.advance(30000);
    expect(times[2]).toBe(95000);
    await loop.stop();
  });

  it('a failing poll continues after 5 s', async () => {
    let n = 0;
    const { loop, clock, events } = setup({ sessions: async () => { if (++n === 2) throw statusError(500); return []; } });
    await loop.start();
    await clock.advance(10000);
    expect(events.filter(e => e === 'sessions:0')).toHaveLength(2);
    expect(n).toBe(3);
    expect(events.some(e => e.startsWith('offline'))).toBe(false);
    await loop.stop();
  });

  it('retries a failed refresh after 5/10/20 s, then returns to the normal cadence', async () => {
    const times: number[] = [];
    const ref = { clock: undefined as FakeClock | undefined };
    const { loop, clock, events } = setup({
      refresh: async () => { times.push(ref.clock!.t); throw statusError(500); }
    });
    ref.clock = clock;
    await loop.start();
    await clock.advance(300000 + 35000 + 1000);
    expect(times).toEqual([300000, 305000, 315000, 335000]);
    await clock.advance(300000);
    expect(times[4]).toBe(635000);
    expect(events.some(e => e.startsWith('offline'))).toBe(false);
    await loop.stop();
  });

  it('stop is idempotent, unregisters once and swallows unregister errors', async () => {
    const { loop, count, clock } = setup({ unregister: async () => { throw new Error('x'); } });
    await loop.start();
    await Promise.all([loop.stop(), loop.stop()]);
    await loop.stop();
    expect(clock.pending).toBe(0);
    expect(count('register:Laptop')).toBe(1);
  });

  it('calls no handler after stop, even for in-flight responses', async () => {
    let release: () => void = () => {};
    let gate = false;
    const { loop, clock, events } = setup({
      sessions: async () => {
        if (gate) await new Promise<void>(r => { release = r; });
        return [];
      },
      refresh: async () => { throw statusError(401); }
    });
    await loop.start();
    events.length = 0;
    gate = true;
    await clock.advance(5000);
    await loop.stop();
    release();
    await clock.advance(1000);
    expect(events).toEqual([]);
  });

  it('does not call onOffline for a 401 that arrives after stop', async () => {
    let reject: (e: unknown) => void = () => {};
    let gate = false;
    const { loop, clock, events } = setup({
      devices: async () => {
        if (gate) await new Promise<unknown[]>((_, r) => { reject = r; });
        return [];
      }
    });
    await loop.start();
    events.length = 0;
    gate = true;
    await clock.advance(5000);
    await loop.stop();
    reject(statusError(401));
    await clock.advance(1000);
    expect(events).toEqual([]);
  });
});
