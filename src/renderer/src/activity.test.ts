import { describe, expect, it, vi } from 'vitest';
import { reportActivity } from './activity';

function fakeTarget() {
  const listeners = new Map<string, EventListener>();
  const target = {
    addEventListener: vi.fn((type: string, listener: EventListener) => { listeners.set(type, listener); }),
    removeEventListener: vi.fn((type: string) => { listeners.delete(type); }),
  };
  return { target: target as unknown as Window, listeners, fire: (type: string) => listeners.get(type)?.(new Event(type)) };
}

describe('reportActivity', () => {
  it('sends on the first event, then at most once per throttle window', () => {
    const { target, fire } = fakeTarget();
    const send = vi.fn();
    let time = 1_000;
    reportActivity(target, send, 10_000, () => time);
    fire('keydown');
    expect(send).toHaveBeenCalledTimes(1);
    time += 9_999;
    fire('pointermove');
    expect(send).toHaveBeenCalledTimes(1);
    time += 1;
    fire('wheel');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('removes all four listeners', () => {
    const { target, listeners } = fakeTarget();
    const remove = reportActivity(target, vi.fn());
    expect([...listeners.keys()].sort()).toEqual(['keydown', 'pointerdown', 'pointermove', 'wheel']);
    remove();
    expect(listeners.size).toBe(0);
  });
});
