import { afterEach, describe, expect, it } from 'vitest';
import type { AiSettings, Vault } from '../../shared/vault/types';
import { exampleVault } from '../../shared/vault/example';
import { i18n } from './i18n';
import { DEFAULT_TIMEOUTS } from '../../shared/vault/timeouts';
import { aiProviderSummary, settingsSections, withAutoLockMinutes, withConfirmBeforeClosing, withTimeouts } from './settings-sections';

afterEach(async () => { await i18n.changeLanguage('de-DE'); });

const openai = { id: 'p1', name: 'OpenAI', kind: 'openai', model: 'gpt' } as const;
const azure = { id: 'p2', name: 'Azure', kind: 'azure', model: 'gpt' } as const;

describe('settingsSections', () => {
  it('offers only "general" without a vault', () => {
    expect(settingsSections(null)).toEqual(['general']);
  });

  it('offers all sections with a vault', () => {
    const vault = { ...exampleVault } satisfies Vault;
    expect(settingsSections(vault)).toEqual(['general', 'vault', 'connections', 'assistant']);
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
