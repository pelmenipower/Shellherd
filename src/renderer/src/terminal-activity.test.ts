import { afterEach, describe, expect, it, vi } from 'vitest';
import { tabActivity } from './terminal-activity';

afterEach(() => {
  for (const id of tabActivity.snapshot()) tabActivity.clear(id);
});

describe('tabActivity', () => {
  it('marks a tab once and notifies only on change', () => {
    const listener = vi.fn();
    const off = tabActivity.subscribe(listener);
    tabActivity.mark('a');
    const before = tabActivity.snapshot();
    tabActivity.mark('a');
    expect(tabActivity.snapshot().has('a')).toBe(true);
    expect(tabActivity.snapshot()).toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('clears a marked tab and ignores clearing an unmarked one', () => {
    const listener = vi.fn();
    const off = tabActivity.subscribe(listener);
    tabActivity.clear('b');
    expect(listener).not.toHaveBeenCalled();
    tabActivity.mark('b');
    tabActivity.clear('b');
    expect(tabActivity.snapshot().has('b')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
  });

  it('keeps other tabs marked', () => {
    tabActivity.mark('x');
    tabActivity.mark('y');
    tabActivity.clear('x');
    expect([...tabActivity.snapshot()]).toEqual(['y']);
  });
});
