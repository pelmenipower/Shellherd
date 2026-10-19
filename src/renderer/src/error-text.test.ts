import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import { errorText } from './error-text';
import { i18n } from './i18n';

afterEach(async () => {
  await i18n.changeLanguage('de-DE');
});

describe('errorText', () => {
  it('translates a CodedError', () => {
    expect(errorText({ code: 'core.vaultLocked' })).toBe('Es ist kein Vault entsperrt.');
  });

  it('translates an AppError and follows the language', async () => {
    await i18n.changeLanguage('en-US');
    expect(errorText(new AppError('core.vaultLocked'))).toBe(i18n.t('errors:core.vaultLocked'));
    expect(errorText(new AppError('core.vaultLocked'))).not.toBe('Es ist kein Vault entsperrt.');
  });

  it('decodes IPC-wrapped errors and plain strings', () => {
    const wrapped = new Error("Error invoking remote method 'vault:x': Error: §core.invalidRequest");
    expect(errorText(wrapped)).toBe('Die Anfrage ist ungültig.');
    expect(errorText('§core.invalidRequest')).toBe('Die Anfrage ist ungültig.');
  });

  it('appends the detail', () => {
    expect(errorText(new AppError('core.invalidRequest', undefined, 'Port 0')))
      .toBe('Die Anfrage ist ungültig. Details: Port 0');
  });

  it('uses core.unknown for a code missing in the catalog', () => {
    expect(errorText({ code: 'core.doesNotExist' as never })).toBe('Ein unerwarteter Fehler ist aufgetreten.');
  });

  it('strips the IPC prefix from foreign errors', () => {
    expect(errorText(new Error("Error invoking remote method 'a:b': Error: ECONNRESET"))).toBe('ECONNRESET');
    expect(errorText(new Error('boom'))).toBe('boom');
  });

  it('truncates long foreign messages', () => {
    expect(errorText(new Error('x'.repeat(900)))).toHaveLength(500);
  });

  it('uses the fallback for empty or non-error input', () => {
    expect(errorText(new Error("Error invoking remote method 'a:b': Error: "), 'Eigener Text')).toBe('Eigener Text');
    expect(errorText(undefined, 'Eigener Text')).toBe('Eigener Text');
    expect(errorText(42)).toBe('Ein unerwarteter Fehler ist aufgetreten.');
    expect(errorText(new Error(''))).toBe('Ein unerwarteter Fehler ist aufgetreten.');
  });
});
