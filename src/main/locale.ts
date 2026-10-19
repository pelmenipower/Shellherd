import { readAppSettings, writeAppSettings } from './app-settings';
import { resolveLocale, systemLocale } from '../shared/locale';
import type { LanguageSetting, LanguageState } from '../shared/locale';

export interface LocaleStoreOptions { settingsFile: string; systemLanguages: () => readonly string[] }

export class LocaleStore {
  private state: LanguageState = { setting: 'system', effective: 'de-DE', system: 'de-DE' };
  private file: string | undefined;
  private listeners = new Set<(state: LanguageState) => void>();

  /** Reads settings.json and the system languages once. */
  init(options: LocaleStoreOptions): LanguageState {
    const preferred = options.systemLanguages();
    this.file = options.settingsFile;
    const { language } = readAppSettings(options.settingsFile);
    this.state = { setting: language, effective: resolveLocale(language, preferred), system: systemLocale(preferred) };
    return this.state;
  }

  /** Before init: { setting: 'system', effective: 'de-DE', system: 'de-DE' }. */
  get(): LanguageState { return this.state; }

  /** Persists (best effort); notifies only if setting or effective changed. */
  set(setting: LanguageSetting): LanguageState {
    const previous = this.state;
    const effective = setting === 'system' ? previous.system : setting;
    this.state = { setting, effective, system: previous.system };
    if (this.file) writeAppSettings(this.file, { language: setting });
    if (setting !== previous.setting || effective !== previous.effective) {
      for (const listener of [...this.listeners]) listener(this.state);
    }
    return this.state;
  }

  subscribe(listener: (state: LanguageState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

export const localeStore = new LocaleStore();
