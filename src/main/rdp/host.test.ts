import { describe, expect, it } from 'vitest';
import { rdpStatusError, splitAccount } from './host';

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

describe('rdpStatusError limits', () => {
  it('truncates a long helper text to 500 characters', () => {
    const long = 'x'.repeat(600);
    expect(rdpStatusError('error', long)?.detail).toHaveLength(500);
    expect(rdpStatusError('disconnected', long)?.detail).toHaveLength(500);
  });
});

describe('rdpStatusError', () => {
  it('keeps the native helper text only as detail of a core.rdp* code', () => {
    expect(rdpStatusError('error', 'Zeitüberschreitung')).toEqual({ code: 'core.rdpFailed', detail: 'Zeitüberschreitung' });
    expect(rdpStatusError('error')).toEqual({ code: 'core.rdpFailed' });
    expect(rdpStatusError('disconnected', 'Getrennt')).toEqual({ code: 'core.rdpDisconnected', detail: 'Getrennt' });
  });
  it('reports nothing for a plain disconnect', () => {
    expect(rdpStatusError('disconnected')).toBeUndefined();
  });
});
