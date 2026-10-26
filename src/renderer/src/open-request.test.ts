import { describe, expect, it } from 'vitest';
import { shouldOpen } from './open-request';

describe('shouldOpen', () => {
  it('does not open on mount, the handled value starts at the current request', () => {
    expect(shouldOpen(3, 3)).toBe(false);
  });

  it('opens when the request counter changes', () => {
    expect(shouldOpen(3, 4)).toBe(true);
  });

  it('does not open when the value is unchanged', () => {
    expect(shouldOpen(4, 4)).toBe(false);
  });

  it('never opens for undefined or 0', () => {
    expect(shouldOpen(0, undefined)).toBe(false);
    expect(shouldOpen(3, undefined)).toBe(false);
    expect(shouldOpen(3, 0)).toBe(false);
  });
});
