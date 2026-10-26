import type { AiSettings, ConnectionTimeouts, TerminalSettings, Vault, VaultSettings } from '../../shared/vault/types';
import { effectiveTimeouts, parseBounded } from '../../shared/vault/timeouts';
import { FONT_FAMILY_MAX, FONT_FAMILY_PATTERN, effectiveTerminalSettings } from '../../shared/vault/terminal-settings';
import { t } from './i18n';

export const SETTINGS_SECTIONS = ['general', 'vault', 'connections', 'terminal', 'assistant'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** ['general'] without a vault, all five with one. */
export function settingsSections(vault: Vault | null): readonly SettingsSection[] {
  return vault ? SETTINGS_SECTIONS : ['general'];
}

/** "Noch kein Anbieter eingerichtet." or "2 Anbieter, Standard: Azure"; the default falls back to the first provider. */
export function aiProviderSummary(ai: AiSettings | undefined): string {
  const providers = ai?.providers ?? [];
  if (providers.length === 0) return t('app:settings.assistant.none');
  const standard = providers.find(item => item.id === ai?.defaultProviderId) ?? providers[0]!;
  return t('app:settings.assistant.summary', { count: providers.length, name: standard.name });
}

/** New object; only confirmBeforeClosingSession changes. */
export function withConfirmBeforeClosing(settings: VaultSettings, value: boolean): VaultSettings {
  return { ...settings, confirmBeforeClosingSession: value };
}

/** New object; only autoLockMinutes changes. */
export function withAutoLockMinutes(settings: VaultSettings, minutes: number): VaultSettings {
  return { ...settings, autoLockMinutes: minutes };
}

/** Stores the full object, based on effectiveTimeouts(settings). */
export function withTimeouts(settings: VaultSettings, patch: Partial<ConnectionTimeouts>): VaultSettings {
  return { ...settings, timeouts: { ...effectiveTimeouts(settings), ...patch } };
}

/** Stores the full object, based on effectiveTerminalSettings(settings). */
export function withTerminal(settings: VaultSettings, patch: Partial<TerminalSettings>): VaultSettings {
  return { ...settings, terminal: { ...effectiveTerminalSettings(settings), ...patch } };
}

/** Trimmed name ('' = default), or null when it has a forbidden character or is longer than FONT_FAMILY_MAX. */
export function parseFontFamily(draft: string): string | null {
  const value = draft.trim();
  return value.length <= FONT_FAMILY_MAX && FONT_FAMILY_PATTERN.test(value) ? value : null;
}

/** Whole number with optional thousands grouping ("5.000", "5,000", "5 000"), then parseBounded; the display of scrollback uses grouping. */
export function parseGroupedNumber(draft: string, limits: readonly [number, number]): number | null {
  const text = draft.trim();
  const plain = /^\d{1,3}(?:[.,\s]\d{3})+$/.test(text) ? text.replace(/\D/g, '') : text;
  return parseBounded(plain, limits);
}
