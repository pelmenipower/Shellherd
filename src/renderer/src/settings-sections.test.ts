import { afterEach, describe, expect, it } from 'vitest';
import type { AiSettings, Vault } from '../../shared/vault/types';
import { exampleVault } from '../../shared/vault/example';
import { i18n } from './i18n';
import { DEFAULT_TIMEOUTS } from '../../shared/vault/timeouts';
import { DEFAULT_TERMINAL_SETTINGS, TERMINAL_LIMITS } from '../../shared/vault/terminal-settings';
import { aiProviderSummary, parseFontFamily, parseGroupedNumber, settingsSections, withAutoLockMinutes, withConfirmBeforeClosing, withTerminal, withTimeouts } from './settings-sections';

afterEach(async () => { await i18n.changeLanguage('de-DE'); });

const openai = { id: 'p1', name: 'OpenAI', kind: 'openai', model: 'gpt' } as const;
const azure = { id: 'p2', name: 'Azure', kind: 'azure', model: 'gpt' } as const;

describe('settingsSections', () => {
  it('offers only "general" without a vault', () => {
    expect(settingsSections(null)).toEqual(['general']);
  });

  it('offers all sections with a vault', () => {
    const vault = { ...exampleVault } satisfies Vault;
    expect(settingsSections(vault)).toEqual(['general', 'vault', 'connections', 'terminal', 'assistant']);
  });
});

describe('aiProviderSummary', () => {
  it('says that nothing is set up', () => {
    expect(aiProviderSummary(undefined)).toBe('Noch kein Anbieter eingerichtet.');
    expect(aiProviderSummary({ providers: [] })).toBe('Noch kein Anbieter eingerichtet.');
  });

  it('falls back to the first provider as default', () => {
    expect(aiProviderSummary({ providers: [openai] })).toBe('1 Anbieter, Standard: OpenAI');
    expect(aiProviderSummary({ providers: [openai, azure], defaultProviderId: 'gone' })).toBe('2 Anbieter, Standard: OpenAI');
  });

  it('names the configured default', () => {
    const ai: AiSettings = { providers: [openai, azure], defaultProviderId: 'p2' };
    expect(aiProviderSummary(ai)).toBe('2 Anbieter, Standard: Azure');
  });

  it('follows the UI language', async () => {
    await i18n.changeLanguage('en-US');
    expect(aiProviderSummary({ providers: [openai, azure], defaultProviderId: 'p2' })).toBe('2 providers, default: Azure');
    expect(aiProviderSummary({ providers: [openai] })).toBe('1 provider, default: OpenAI');
  });
});

describe('withConfirmBeforeClosing', () => {
  it('returns a new object and changes only the flag', () => {
    const settings = { theme: 'dark', autoLockMinutes: 7, confirmBeforeClosingSession: true } as const;
    const next = withConfirmBeforeClosing(settings, false);
    expect(next).not.toBe(settings);
    expect(next).toEqual({ theme: 'dark', autoLockMinutes: 7, confirmBeforeClosingSession: false });
    expect(settings.confirmBeforeClosingSession).toBe(true);
  });
});

describe('withAutoLockMinutes', () => {
  it('returns a new object and changes only the minutes', () => {
    const settings = { theme: 'dark', autoLockMinutes: 7, confirmBeforeClosingSession: true } as const;
    const next = withAutoLockMinutes(settings, 20);
    expect(next).not.toBe(settings);
    expect(next).toEqual({ theme: 'dark', autoLockMinutes: 20, confirmBeforeClosingSession: true });
  });
});

describe('withTimeouts', () => {
  const base = { theme: 'dark', autoLockMinutes: 7, confirmBeforeClosingSession: true } as const;

  it('stores the full object with defaults plus the patch when the vault has none', () => {
    expect(withTimeouts(base, { idleMinutes: 30 }).timeouts).toEqual({ ...DEFAULT_TIMEOUTS, idleMinutes: 30 });
  });

  it('changes only the patched key of an existing object', () => {
    const settings = { ...base, timeouts: { idleMinutes: 5, keepaliveSeconds: 20, keepaliveCount: 4, connectSeconds: 60 } };
    const next = withTimeouts(settings, { keepaliveCount: 6 });
    expect(next.timeouts).toEqual({ idleMinutes: 5, keepaliveSeconds: 20, keepaliveCount: 6, connectSeconds: 60 });
    expect(settings.timeouts.keepaliveCount).toBe(4);
    expect(next.autoLockMinutes).toBe(7);
  });
});

describe('withTerminal', () => {
  const base = { theme: 'dark', autoLockMinutes: 7, confirmBeforeClosingSession: true } as const;

  it('stores the full object with defaults plus the patch when the vault has none', () => {
    expect(withTerminal(base, { cursorStyle: 'bar' }).terminal).toEqual({ ...DEFAULT_TERMINAL_SETTINGS, cursorStyle: 'bar' });
  });

  it('changes only the patched key of an existing object', () => {
    const settings = { ...base, terminal: { fontFamily: 'Fira', fontSize: 12, scrollback: 9000, cursorStyle: 'block', cursorBlink: true } as const };
    const next = withTerminal(settings, { cursorBlink: false });
    expect(next.terminal).toEqual({ fontFamily: 'Fira', fontSize: 12, scrollback: 9000, cursorStyle: 'block', cursorBlink: false });
    expect(settings.terminal.cursorBlink).toBe(true);
    expect(next.timeouts).toBeUndefined();
  });
});

describe('parseFontFamily', () => {
  it('accepts blank as the default and trims names', () => {
    expect(parseFontFamily('')).toBe('');
    expect(parseFontFamily('   ')).toBe('');
    expect(parseFontFamily('  Fira Code ')).toBe('Fira Code');
    expect(parseFontFamily('Source_Code-Pro.2')).toBe('Source_Code-Pro.2');
    expect(parseFontFamily('Schrift Köln')).toBe('Schrift Köln');
  });

  it('rejects quotes, commas and other characters', () => {
    expect(parseFontFamily('"Fira"')).toBeNull();
    expect(parseFontFamily('Fira, serif')).toBeNull();
    expect(parseFontFamily('Fira;')).toBeNull();
  });

  it('allows up to 64 characters', () => {
    expect(parseFontFamily('a'.repeat(64))).toBe('a'.repeat(64));
    expect(parseFontFamily('a'.repeat(65))).toBeNull();
  });
});

describe('parseGroupedNumber', () => {
  const scrollback = TERMINAL_LIMITS.scrollback;

  it('reads plain and grouped whole numbers within the limits', () => {
    expect(parseGroupedNumber('5000', scrollback)).toBe(5000);
    expect(parseGroupedNumber('5.000', scrollback)).toBe(5000);
    expect(parseGroupedNumber('5,000', scrollback)).toBe(5000);
    expect(parseGroupedNumber('50 000', scrollback)).toBe(50000);
    expect(parseGroupedNumber(' 14 ', TERMINAL_LIMITS.fontSize)).toBe(14);
  });

  it('rejects values outside the limits', () => {
    expect(parseGroupedNumber('50.001', scrollback)).toBeNull();
    expect(parseGroupedNumber('999', scrollback)).toBeNull();
    expect(parseGroupedNumber('33', TERMINAL_LIMITS.fontSize)).toBeNull();
  });

  it('rejects decimals, malformed groups and blanks', () => {
    expect(parseGroupedNumber('1.5', scrollback)).toBeNull();
    expect(parseGroupedNumber('5.00', scrollback)).toBeNull();
    expect(parseGroupedNumber('1.000.0', scrollback)).toBeNull();
    expect(parseGroupedNumber('', scrollback)).toBeNull();
    expect(parseGroupedNumber('abc', scrollback)).toBeNull();
  });
});
