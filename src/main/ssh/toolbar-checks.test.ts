import { EventEmitter } from 'node:events';
import type { ClientChannel } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolbarChecks } from './toolbar-checks';
import type { ToolbarItem, ToolbarResult } from '../../shared/toolbar';
import { ToolbarItemSchema } from '../../shared/toolbar';
const item = ToolbarItemSchema.parse({ id: '11111111-1111-4111-8111-111111111111', kind: 'status', name: 'Service', command: '/opt/check.sh', description: '', enabled: true, showText: true, confirm: false,
  icon: 'server', color: '#ffffff', text: '', trigger: 'both', intervalMs: 1000, timeoutMs: 2000, mappings: [], unknown: { icon: 'warning', color: '#aaaaaa', text: '?' } });
function setup(items: ToolbarItem[] = [item]) {
  const streams: (EventEmitter & { stderr: EventEmitter; signal: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> })[] = [];
  const results: ToolbarResult[] = [];
  let allowed = true;
  const exec = vi.fn((_command, callback) => { const stream = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), signal: vi.fn(), close: vi.fn() }); streams.push(stream); callback(undefined, stream as unknown as ClientChannel); });
  const runner = new ToolbarChecks(exec, result => results.push(result), () => allowed);
  runner.configure(items);
  return { runner, streams, results, exec, deny: () => { allowed = false; } };
}
afterEach(() => vi.useRealTimers());
describe('invisible SSH status checks', () => {
  it('runs periodic checks immediately, skips overlaps and preserves split UTF-8 JSON', async () => {
    vi.useFakeTimers();
    const s = setup();
    expect(s.exec).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    s.runner.run(item.id);
    expect(s.exec).toHaveBeenCalledOnce();
    const bytes = Buffer.from('{"value":"banana","message":"grün","extra":true}');
    const split = bytes.indexOf(Buffer.from('ü')) + 1;
    s.streams[0].emit('data', bytes.subarray(0, split)); s.streams[0].emit('data', bytes.subarray(split));
    s.streams[0].emit('exit', 0); s.streams[0].emit('close');
    expect(s.results.at(-1)).toMatchObject({ state: 'ok', value: 'banana', message: 'grün', lastSuccess: expect.any(Number) });
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.exec).toHaveBeenCalledTimes(2);
    s.runner.stop();
    expect(s.streams[1].signal).toHaveBeenCalledWith('TERM');
    expect(s.streams[1].close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not execute click-only or disabled indicators automatically', () => {
    const s = setup([{ ...item, trigger: 'click' }, { ...item, id: crypto.randomUUID(), enabled: false }]);
    expect(s.exec).not.toHaveBeenCalled();
    s.runner.run(item.id); expect(s.exec).toHaveBeenCalledOnce(); s.runner.stop();
  });
  it('times out only the exec channel and reports a technical error', async () => {
    vi.useFakeTimers(); const s = setup([{ ...item, trigger: 'click' }]); s.runner.run(item.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.results.at(-1)).toMatchObject({ state: 'error', error: 'timeout' });
    expect(s.streams[0].close).toHaveBeenCalledOnce(); s.runner.stop();
  });
  it('bounds stdout and stderr and reports invalid JSON and exit errors', () => {
    const s = setup([{ ...item, trigger: 'click' }]);
    s.runner.run(item.id); s.streams[0].emit('data', Buffer.alloc(32769));
    expect(s.results.at(-1)?.error).toBe('output-limit');
    s.runner.run(item.id); s.streams[1].emit('data', Buffer.from('{"value":1}')); s.streams[1].emit('exit', 0); s.streams[1].emit('close');
    expect(s.results.at(-1)?.error).toBe('invalid-json');
    s.runner.run(item.id); s.streams[2].stderr.emit('data', Buffer.from('\x1b[31mservice failed\x1b[0m')); s.streams[2].emit('exit', 3); s.streams[2].emit('close');
    expect(s.results.at(-1)).toMatchObject({ error: 'exit', detail: 'service failed' }); s.runner.stop();
  });
  it('does not execute or emit results after a vault lock and closes late channels', () => {
    const s = setup([{ ...item, trigger: 'click' }]); s.deny(); s.runner.run(item.id); expect(s.exec).not.toHaveBeenCalled(); s.runner.stop();
    let reply: ((error?: Error, channel?: ClientChannel) => void) | undefined;
    const emit = vi.fn(); const runner = new ToolbarChecks((_command, callback) => { reply = callback; }, emit, () => true);
    runner.configure([{ ...item, trigger: 'click' }]); runner.run(item.id); runner.stop();
    const channel = { close: vi.fn(), signal: vi.fn() };
    reply?.(undefined, channel as unknown as ClientChannel);
    expect(channel.close).toHaveBeenCalledOnce(); expect(emit).toHaveBeenCalledTimes(1);
  });
  it('bounds concurrent channels, services waiting indicators and drops removed ones', async () => {
    const items = Array.from({ length: 6 }, () => ({ ...item, id: crypto.randomUUID() }));
    const s = setup(items); expect(s.exec).toHaveBeenCalledTimes(4);
    s.streams[0].emit('data', Buffer.from('{"value":"ok"}')); s.streams[0].emit('exit', 0); s.streams[0].emit('close');
    await Promise.resolve(); expect(s.exec).toHaveBeenCalledTimes(5);
    s.runner.configure([]); s.runner.run(items[0].id); expect(s.exec).toHaveBeenCalledTimes(5); s.runner.stop();
  });
});
