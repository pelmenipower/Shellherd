import type { AiSettings, ConnectionTimeouts, Vault, VaultSettings } from '../../shared/vault/types';
import { effectiveTimeouts } from '../../shared/vault/timeouts';
import { t } from './i18n';

export const SETTINGS_SECTIONS = ['general', 'vault', 'connections', 'assistant'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** ['general'] without a vault, all four with one. */
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
