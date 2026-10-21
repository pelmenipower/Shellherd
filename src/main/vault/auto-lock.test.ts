import { describe, expect, it, vi } from 'vitest';
import { AutoLock, type AutoLockDeps } from './auto-lock';

const MIN = 60_000;

function setup(over: Partial<AutoLockDeps> = {}): { auto: AutoLock; lock: ReturnType<typeof vi.fn>; time: { now: number } } {
  const time = { now: 1_000_000 };
  const lock = vi.fn();
  const auto = new AutoLock({
    minutes: () => 5, lock, systemIdleSeconds: () => 0, rdpConnected: () => false, now: () => time.now, ...over,
  });
  auto.start();
  return { auto, lock, time };
}

describe('AutoLock', () => {
  it('locks after the limit, not before', () => {
    const { auto, lock, time } = setup();
    time.now += 5 * MIN - 1; auto.check();
    expect(lock).not.toHaveBeenCalled();
    time.now += 1; auto.check();
    expect(lock).toHaveBeenCalledWith(5);
  });
  it('touch resets the timer', () => {
    const { auto, lock, time } = setup();
    time.now += 4 * MIN; auto.touch();
    time.now += 4 * MIN; auto.check();
    expect(lock).not.toHaveBeenCalled();
  });
  it('0 never locks', () => {
    const { auto, lock, time } = setup({ minutes: () => 0 });
    time.now += 10_000 * MIN; auto.check();
    expect(lock).not.toHaveBeenCalled();
  });
  it('reads minutes on every check', () => {
    let minutes = 60;
    const { auto, lock, time } = setup({ minutes: () => minutes });
    time.now += 10 * MIN; auto.check();
    expect(lock).not.toHaveBeenCalled();
    minutes = 5; auto.check();
    expect(lock).toHaveBeenCalledWith(5);
  });
  it('with RDP connected, the system must be idle too', () => {
    let idle = 0;
    const { auto, lock, time } = setup({ rdpConnected: () => true, systemIdleSeconds: () => idle });
    time.now += 6 * MIN; auto.check();
    expect(lock).not.toHaveBeenCalled();
    idle = 5 * 60; auto.check();
    expect(lock).toHaveBeenCalledTimes(1);
  });
  it('does not lock twice while minutes() stays 0 after locking', () => {
    let minutes = 5;
    const { auto, lock, time } = setup({ minutes: () => minutes });
    time.now += 6 * MIN; auto.check();
    minutes = 0; time.now += 6 * MIN; auto.check();
    expect(lock).toHaveBeenCalledTimes(1);
  });
  it('resets the timestamp when locking', () => {
    const { auto, lock, time } = setup();
    time.now += 6 * MIN; auto.check(); auto.check();
    expect(lock).toHaveBeenCalledTimes(1);
  });
  it('ticks via interval and dispose stops it', () => {
    vi.useFakeTimers();
    try {
      const lock = vi.fn();
      const auto = new AutoLock({ minutes: () => 1, lock, systemIdleSeconds: () => 0, rdpConnected: () => false });
      auto.start(); auto.start();
      vi.advanceTimersByTime(MIN + 30_000);
      expect(lock).toHaveBeenCalledTimes(1);
      auto.dispose();
      vi.advanceTimersByTime(10 * MIN);
      expect(lock).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
