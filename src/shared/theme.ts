/** App colour scheme, stored in settings.json; main applies it via nativeTheme.themeSource. */
export const THEME_SETTINGS = ['system', 'dark', 'light'] as const;
export type ThemeSetting = typeof THEME_SETTINGS[number];
