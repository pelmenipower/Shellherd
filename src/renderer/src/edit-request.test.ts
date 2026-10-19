import { describe, expect, it, vi } from 'vitest';
import { canEditConnections, onEditRequest, requestEdit } from './edit-request';

describe('edit-request', () => {
  it('has no handler by default and ignores requests', () => {
    expect(canEditConnections()).toBe(false);
    expect(() => requestEdit('a')).not.toThrow();
  });
  it('delivers requests to the registered handler until unsubscribed', () => {
    const handler = vi.fn();
    const off = onEditRequest(handler);
    expect(canEditConnections()).toBe(true);
    requestEdit('conn-1');
    expect(handler).toHaveBeenCalledWith('conn-1');
    off();
    expect(canEditConnections()).toBe(false);
    requestEdit('conn-2');
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it('a stale unsubscribe does not remove a newer handler', () => {
    const first = vi.fn(); const second = vi.fn();
    const offFirst = onEditRequest(first);
    const offSecond = onEditRequest(second);
    offFirst();
    expect(canEditConnections()).toBe(true);
    requestEdit('x');
    expect(second).toHaveBeenCalledWith('x');
    offSecond();
    expect(canEditConnections()).toBe(false);
  });
});
