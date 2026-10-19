import { describe, expect, it } from 'vitest';
import { AppError, MAX_DETAIL, codedFrom, decodeError, encodeError, isCodedError, truncateDetail } from './errors';

describe('errors', () => {
  it('encodes and decodes a bare code', () => {
    expect(encodeError('core.unknown')).toBe('§core.unknown');
    expect(decodeError('§core.unknown')).toEqual({ code: 'core.unknown' });
  });

  it('roundtrips params and detail', () => {
    const text = encodeError('core.invalidRequest', { n: 3, name: 'a' }, 'boom');
    expect(text).toBe('§core.invalidRequest {"params":{"n":3,"name":"a"},"detail":"boom"}');
    expect(decodeError(text)).toEqual({ code: 'core.invalidRequest', params: { n: 3, name: 'a' }, detail: 'boom' });
  });

  it('roundtrips detail without params', () => {
    expect(decodeError(encodeError('core.unknown', undefined, 'x'))).toEqual({ code: 'core.unknown', detail: 'x' });
  });

  it('accepts Electron and Error-name prefixes', () => {
    const wrapped = "Error invoking remote method 'x:y': Error: §core.unknown";
    expect(decodeError(wrapped)).toEqual({ code: 'core.unknown' });
    expect(decodeError('HostAccessError: §containers.sudoRejected')).toEqual({ code: 'containers.sudoRejected' });
  });

  it('returns null for foreign text', () => {
    expect(decodeError('connect ECONNREFUSED')).toBeNull();
    expect(decodeError('Fehler §core.unknown')).toBeNull();
  });

  it('keeps the code on invalid JSON and drops non-scalar params', () => {
    expect(decodeError('§core.unknown {oops}')).toEqual({ code: 'core.unknown' });
    expect(decodeError('§core.unknown {"params":{"a":1,"b":{"c":1},"d":true}}')).toEqual({
      code: 'core.unknown', params: { a: 1 },
    });
  });

  it('truncates detail to 500 characters', () => {
    const long = 'x'.repeat(900);
    expect(truncateDetail(long)).toHaveLength(MAX_DETAIL);
    expect(truncateDetail(long).endsWith('…')).toBe(true);
    expect(truncateDetail('short')).toBe('short');
    expect(decodeError(encodeError('core.unknown', undefined, long))?.detail).toHaveLength(MAX_DETAIL);
  });

  it('AppError carries the wire format and converts', () => {
    const error = new AppError('core.invalidRequest', { a: 1 }, 'd');
    expect(error.message).toBe(encodeError('core.invalidRequest', { a: 1 }, 'd'));
    expect(error.name).toBe('Error');
    expect(error.toCoded()).toEqual({ code: 'core.invalidRequest', params: { a: 1 }, detail: 'd' });
    expect(AppError.from(error.toCoded()).message).toBe(error.message);
    expect(new AppError('core.unknown').toCoded()).toEqual({ code: 'core.unknown' });
  });

  it('roundtrips causes and AppError keeps them', () => {
    const causes = [{ label: 'h1', error: { code: 'ssh.timeout' as const, detail: 'x' } }, { label: 'h2', error: { code: 'core.unknown' as const, params: { n: 1 } } }];
    const text = encodeError('kubernetes.accessHostsUnreachable', { hosts: 'h1, h2' }, undefined, causes);
    expect(decodeError(text)).toEqual({ code: 'kubernetes.accessHostsUnreachable', params: { hosts: 'h1, h2' }, causes });
    const error = new AppError('kubernetes.accessHostsUnreachable', undefined, undefined, causes);
    expect(error.toCoded().causes).toEqual(causes);
    expect(decodeError(error.message)?.causes).toEqual(causes);
    expect(AppError.from(error.toCoded()).message).toBe(error.message);
  });

  it('drops invalid causes and nested causes on decode', () => {
    const payload = { causes: [
      { label: 'ok', error: { code: 'ssh.timeout', causes: [{ label: 'deep', error: { code: 'core.unknown' } }] } },
      { label: 1, error: { code: 'ssh.timeout' } },
      { label: 'nocode', error: {} },
      { label: 'badcode', error: { code: 'nope' } },
      'junk', null,
    ] };
    expect(decodeError(`§core.unknown ${JSON.stringify(payload)}`)).toEqual({ code: 'core.unknown', causes: [{ label: 'ok', error: { code: 'ssh.timeout' } }] });
    expect(decodeError('§core.unknown {"causes":"x"}')).toEqual({ code: 'core.unknown' });
    expect(decodeError('§core.unknown {"causes":[{"label":"a"}]}')).toEqual({ code: 'core.unknown' });
  });

  it('isCodedError distinguishes coded objects', () => {
    expect(isCodedError({ code: 'core.unknown' })).toBe(true);
    expect(isCodedError(new Error('x'))).toBe(false);
    expect(isCodedError(null)).toBe(false);
    expect(isCodedError('core.unknown')).toBe(false);
  });

  it('codedFrom maps everything to a coded error', () => {
    expect(codedFrom(new AppError('core.vaultLocked'), 'core.unknown')).toEqual({ code: 'core.vaultLocked' });
    expect(codedFrom({ code: 'core.vaultLocked' }, 'core.unknown')).toEqual({ code: 'core.vaultLocked' });
    expect(codedFrom(new Error('§core.vaultLocked'), 'core.unknown')).toEqual({ code: 'core.vaultLocked' });
    expect(codedFrom('§core.vaultLocked', 'core.unknown')).toEqual({ code: 'core.vaultLocked' });
    expect(codedFrom(new Error('ECONNRESET'), 'core.invalidRequest')).toEqual({ code: 'core.invalidRequest' });
    expect(codedFrom(42, 'core.unknown')).toEqual({ code: 'core.unknown' });
  });
});
