import { describe, expect, it } from 'vitest';
import { hostLabel } from './known-hosts';

describe('hostLabel', () => {
  it('omits the default port', () => {
    expect(hostLabel('web-01', 22)).toBe('web-01');
  });

  it('appends a non-default port', () => {
    expect(hostLabel('web-01', 2222)).toBe('web-01:2222');
  });

  it('brackets IPv6 addresses', () => {
    expect(hostLabel('::1', 2222)).toBe('[::1]:2222');
  });
});
