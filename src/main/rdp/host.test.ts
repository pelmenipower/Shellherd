import { describe, expect, it } from 'vitest';
import { splitAccount } from './host';

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
