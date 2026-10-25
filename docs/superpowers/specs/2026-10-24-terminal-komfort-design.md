# Terminal-Komfort – Design

> Übernommen aus dem Konzept (Opus, `.superpowers/sdd/terminal-komfort-research.md`). Bindend geht `2026-10-24-terminal-komfort-validation.md` vor.


Stand 0.19.0 (SSH-Paket), Branch `claude/feature/terminal-komfort`. Zielversion **0.20.0**. Vault bleibt Version 2 (nur ein optionales Feld kommt dazu).

## 0. Entscheidungen auf einen Blick (Rulings)

| # | Frage | Entscheidung |
|---|---|---|
| R1 | Suchkürzel | **Strg+Umschalt+F**, nie Strg+F (bash: ein Zeichen vor, less/vim: Seite vor). Wie Windows Terminal. Ausgelöst über `term.attachCustomKeyEventHandler`, also nur im Terminal mit Tastaturfokus |
| R2 | Treffer-Hervorhebung | über die **Auswahl** (`--color-selection-bg` via `terminal-theme.ts`). `allowProposedApi` bleibt `false` (`TerminalPanel.tsx:90`); Such-Decorations brauchen die Proposed-API (`registerDecoration` ruft `_checkProposedApi`, `node_modules/@xterm/xterm/lib/xterm.js`). Keine Trefferzahl in Stufe 1 |
| R3 | Copy-on-select bei Suche | Auswahl, deren Text dem Suchbegriff entspricht (ohne Groß/Klein), wird bei offener Suche **nicht** kopiert. Sonst überschreibt jede Suche die Zwischenablage (`TerminalPanel.tsx:117-123`) |
| R4 | Suche in Dock-Terminals | nein (`embedded`): Dock-Panels sind kein Flex-Column (`kubernetes-ui.css:114`), Strg+Umschalt+F geht dort an xterm durch |
| R5 | Links | `@xterm/addon-web-links` **und** xterm-Option `linkHandler` (OSC 8) öffnen nur bei **Strg+Klick**, nur `http:`/`https:`, ohne Benutzer/Passwort in der URL, höchstens 2048 Zeichen. Main prüft erneut (gemeinsame Funktion) und ruft `shell.openExternal(href)` mit der normalisierten `URL.href`. Neuer Kanal `app:open-external` |
| R6 | Tab-Kürzel | **Strg+Tab / Strg+Umschalt+Tab** (nächster/vorheriger Tab im fokussierten Bereich), **Strg+Umschalt+T** (Verbindungsauswahl „+“ des fokussierten Bereichs öffnen), **Strg+Umschalt+W** (aktiven Tab des fokussierten Bereichs schließen, mit vorhandener Rückfrage). Nie Strg+T/Strg+W (bash: Zeichen tauschen/Wort löschen). Strg+1…9 ist Extra; dann als Strg+Umschalt+1…9, nie Strg+Alt (AltGr = Strg+Alt: AltGr+7/8/9/0 sind `{[]}`) |
| R7 | Kürzel ohne Wiederholung | T und W feuern nicht bei Tastenwiederholung (gehaltenes W schlösse sonst alle Tabs). Tab darf wiederholen |
| R8 | Kürzel-Sperren | ignoriert (aber verschluckt), wenn `busy`, die Fläche unsichtbar ist, ein Modal offen ist (`dialog[open], [role="dialog"][aria-modal="true"]`, deckt den Sperrbildschirm ab, `LockScreen.tsx:60`) oder der Fokus in `input, textarea, select, [contenteditable]` liegt, **außer** in xterms `textarea.xterm-helper-textarea` |
| R9 | Terminal-Einstellungen | im **Vault** (`settings.terminal?`, optional wie `timeouts?`), nicht lokal: der Dialog speichert schon Vault-Settings, Nebenfenster bekommen sie über den Katalog, und alles gilt sofort |
| R10 | Grenzen | Schriftgröße 8–32 (Standard 14), Verlauf **1.000–50.000** Zeilen (Standard 5.000), Cursor `block`/`bar`/`underline` (Standard `block`), blinkt ja/nein (Standard ja), Schriftart freier Text ≤ 64 Zeichen aus Buchstaben, Ziffern, Leerzeichen, `.`, `_`, `-` (leer = Standard). 100.000 Zeilen wären ~144 MB je Terminal bei 120 Spalten (12 Byte je Zelle), ×16 Sitzungen über 2 GB; deshalb 50.000 |
| R11 | Tab-Übergabe | Snapshot bleibt bei `scrollback: 5000` (`TerminalPanel.tsx:102`); die IPC-Grenze ist 8 MiB je Tab (`window-ipc.ts:38`) |
| R12 | Fensterposition | nur Hauptfenster; normale Bounds (`getNormalBounds()`) und maximiert im **userData** `settings.json` (Schlüssel `mainWindow`, neben `language`), nie im Vault. Beim Start durch `visibleBounds` (`windows.ts:18`). Minimiert geschlossen: nichts schreiben |
| R13 | Aktivität | inaktiver (nicht sichtbarer) Tab mit neuer Ausgabe: Ring nach dem Namen, Name hell und fett, Tooltip „· Neue Ausgabe“. Keine Animation, kein OS-Toast, keine Glocke (Extra). Sichtbar werden löscht die Markierung |
| R14 | Eingabe an alle | pro Fenster, für die **aktuelle Ansicht**; Mitglieder sind die aktiven Tabs der angezeigten Bereiche, die **verbunden** und **reine SSH- oder lokale Shells** sind (`protocol` `ssh`/`powershell`/`cmd`, ohne `view`, `target`, `kube`). Container-Tabs, Pod-Terminals (egal ob Produktion), RDP, SFTP, Cluster, Willkommen: **nie**. Mindestens 2 Mitglieder, sonst aus. Aus beim Ansichtswechsel. Workflows und Assistent tippen weiterhin nur in einen Tab |
| R15 | Sichtbarkeit Eingabe an alle | jeder Mitglieds-Bereich bekommt eine Warn-Linie unter dem Kopf und den Knopf „An alle“ (beendet beim Klick); beim Einschalten eine Info-Meldung. Nie still |
| R16 | Neue npm-Pakete | genau zwei, exakt gepinnt: `@xterm/addon-search@0.16.0`, `@xterm/addon-web-links@0.12.0` (am selben Tag wie `@xterm/xterm@6.0.0` veröffentlicht; heute **nicht** installiert, `node_modules/@xterm` hat nur `xterm`, `addon-fit`, `addon-serialize`) |
| R17 | Tokens | keine neuen Tokens und keine Bewegung; Motion-Gate unverändert |

## 1. Bestand und Lücken

| Bestand | Fundstelle |
|---|---|
| xterm-Optionen fest: `cursorBlink: true`, `scrollback: 5000`, `fontSize: 14`, `fontFamily: 'Consolas, "Cascadia Mono", monospace'`, `allowProposedApi: false` | `src/renderer/src/components/TerminalPanel.tsx:89-91` |
| Addons nur Fit und Serialize | `TerminalPanel.tsx:4-5`, `:92-97`; `package.json:50-52` (`@xterm/xterm ^6.0.0`, `addon-fit ^0.11.0`, `addon-serialize 0.14.0`) |
| Snapshot für Tab-Übergabe mit 5000 Zeilen | `TerminalPanel.tsx:102`; Grenze `src/main/window-ipc.ts:38`, `:147` |
| Copy-on-select (80 ms) | `TerminalPanel.tsx:117-123` |
| Eingabe: 256-KiB-Grenze, Queue, 4-KiB-Stücke | `TerminalPanel.tsx:163-182` |
| Farben aus Tokens | `src/renderer/src/terminal-theme.ts:2-8` |
| Kürzel-Hooks (Capture-Phase, `matchesShortcut` schließt Alt aus) | `src/renderer/src/hooks/useShortcut.ts:4-27`, `src/renderer/src/shortcut-match.ts:5-7` |
| Belegte Kürzel: Strg+Umschalt+Leertaste, Strg+Umschalt+K, Strg+, | `App.tsx:130`, `SecondaryWindow.tsx:117`, `hooks/useAssistantToggle.ts:17`, `App.tsx:218-222` |
| Tabs im Tabstreifen nur per Pfeil/Pos1/Ende | `src/renderer/src/components/TerminalTabs.tsx:36-48` |
| Tab-Punkt zeigt nur Verbindungsstatus | `TerminalTabs.tsx:78`, CSS `terminal-ui.css:15-18` |
| Ein `SplitTerminalArea` je Fenster (Haupt- und Nebenfenster) | `App.tsx:900`, `SecondaryWindow.tsx:122` |
| Fokussierter Bereich, `selectTab`, Layout-Menü „Layout und Tastaturaktionen“ | `SplitTerminalArea.tsx:191`, `:216`, `:401-405`, `:406-427` |
| Panels als stabile Geschwister, Dock-Terminals mit Tab-Id `…:dock` | `SplitTerminalArea.tsx:429-451`; `ContainerDock.tsx:159`, `DetailDock.tsx:180` |
| Sitzungsregister je Fenster (Picks bei Übergabe, Funktionen sind sicher) | `src/renderer/src/session-registry.ts:4-23`; `hooks/useTabTransfer.ts:53-56`, `:72-75` |
| Hauptfenster fest 1280×800, Position nicht gemerkt | `src/main/index.ts:91-94`, Aufruf `:322`, `:326` |
| `visibleBounds` vorhanden, nur für Workspace-Nebenfenster genutzt | `src/main/windows.ts:17-27` |
| Lokale App-Einstellungen in `userData/settings.json` (nur `language`), schreibt Temp + Rename und behält fremde Schlüssel | `src/main/app-settings.ts:7-33`; Pfad `index.ts:211` |
| Lokale Renderer-Vorlieben in `localStorage` (Assistent offen, gesehene Version) | `hooks/useAssistantToggle.ts:8-14`, `release-notes.ts:15-23` |
| Vault-Settings: `theme`, `autoLockMinutes`, `confirmBeforeClosingSession`, `timeouts?` | `src/shared/vault/types.ts:278-284`, `src/shared/vault/schema.ts:228-236` |
| Katalog für Nebenfenster trägt `confirmBeforeClosingSession`, wird bei jeder Vault-Änderung gesendet | `src/shared/windows.ts:73`, `window-ipc.ts:81-84`, `:225-227`, `index.ts:307` |
| Einstellungen-Dialog: Abschnitte, `NumberSetting` (Blur/Enter) | `components/SettingsDialog.tsx:25-30`, `:45-67`, `:87-127`; `settings-sections.ts:5-11` |
| Kein `shell.openExternal`, Fenster verweigern `window.open` und Navigation | `index.ts:115-116`; nur `shell.openPath` in `main/files/ipc.ts:61` |
| Sender-Prüfung für Fenster-Hauptframes | `src/main/ssh/ipc.ts:20-26` (`requireSshSender`) |
| Produktionsmarke nur am Cluster, nicht am Tab | `shared/vault/types.ts:151`, `ClusterView.tsx:66-68` |

**Lücken:** keine Suche, Links werden nicht erkannt (OSC-8-Links liefen in `window.open` und damit ins Leere), keine Tab-Kürzel, Terminal-Darstellung nicht einstellbar, Hauptfenster startet immer 1280×800 auf dem Primärschirm, keine Aktivitätsanzeige, keine gemeinsame Eingabe.

## 2. Empfehlung je Funktion

| Funktion | Wert | Aufwand | Stufe 1 |
|---|---|---|---|
| 1 Suche (Strg+Umschalt+F) | ★★★ | nur Renderer (+1 Paket) | Leiste oben im Panel, vor/zurück, „Keine Treffer“ |
| 2 Klickbare Links | ★★ | kleine Main-Änderung | Strg+Klick, Hinweis beim Überfahren |
| 3 Tab-Kürzel | ★★★ | nur Renderer | Strg+(Umschalt+)Tab, Strg+Umschalt+T/W |
| 4 Terminal-Einstellungen | ★★★ | nur Renderer + Schema | Abschnitt „Terminal“, live |
| 5 Fensterposition | ★★ | kleine Main-Änderung | Hauptfenster |
| 6 Aktivität | ★★ | nur Renderer | Ring am Tab |
| 7 Eingabe an alle | ★★ | nur Renderer | Umschalter im Layout-Menü, Chip je Bereich |

## 3. Gemeinsamer Vertrag (Welle 0, exakt so)

### 3.1 `src/shared/vault/types.ts` (ergänzen)

```ts
export type TerminalCursorStyle = 'block' | 'bar' | 'underline';
export interface TerminalSettings {
  /** One font name; '' = default chain. Fallbacks are always appended. */
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  cursorStyle: TerminalCursorStyle;
  cursorBlink: boolean;
}
// in VaultSettings, nach `timeouts?`:
  /** Absent in older vaults: DEFAULT_TERMINAL_SETTINGS apply. */
  terminal?: TerminalSettings;
```

### 3.2 `src/shared/vault/terminal-settings.ts` (neu) + `terminal-settings.test.ts`

```ts
import type { TerminalSettings, VaultSettings } from './types';

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = { fontFamily: '', fontSize: 14, scrollback: 5000, cursorStyle: 'block', cursorBlink: true };
export const TERMINAL_LIMITS = { fontSize: [8, 32], scrollback: [1_000, 50_000] } as const satisfies Record<'fontSize' | 'scrollback', readonly [number, number]>;
export const FONT_FAMILY_MAX = 64;
/** Letters, digits, space, dot, underscore, hyphen; '' allowed. No quotes or commas: the name goes into a CSS font list. */
export const FONT_FAMILY_PATTERN = /^[\p{L}\p{N} ._-]*$/u;
export const FALLBACK_FONTS = 'Consolas, "Cascadia Mono", monospace';

/** Defaults, then the vault's values. */
export function effectiveTerminalSettings(settings?: Pick<VaultSettings, 'terminal'>): TerminalSettings {
  return { ...DEFAULT_TERMINAL_SETTINGS, ...settings?.terminal };
}
/** '"<name>", Consolas, "Cascadia Mono", monospace' for a non-blank trimmed name, else FALLBACK_FONTS. */
export function xtermFontFamily(fontFamily: string): string {
  const name = fontFamily.trim();
  return name ? `"${name}", ${FALLBACK_FONTS}` : FALLBACK_FONTS;
}
```

Tests: Standardwerte; `effectiveTerminalSettings(undefined)` und `({})` = Standard; Teilwerte überschreiben; `xtermFontFamily('')`, `('  ')`, `(' Fira Code ')` → `"Fira Code", Consolas, "Cascadia Mono", monospace`.

### 3.3 `src/shared/vault/schema.ts` (ergänzen) + `schema.test.ts`

```ts
import { FONT_FAMILY_MAX, FONT_FAMILY_PATTERN, TERMINAL_LIMITS } from './terminal-settings';

export const TerminalSettingsSchema: z.ZodType<TerminalSettings> = z.object({
  fontFamily: z.string().max(FONT_FAMILY_MAX).regex(FONT_FAMILY_PATTERN),
  fontSize: z.number().int().min(TERMINAL_LIMITS.fontSize[0]).max(TERMINAL_LIMITS.fontSize[1]),
  scrollback: z.number().int().min(TERMINAL_LIMITS.scrollback[0]).max(TERMINAL_LIMITS.scrollback[1]),
  cursorStyle: z.enum(['block', 'bar', 'underline']),
  cursorBlink: z.boolean(),
});
// VaultSettingsSchema: nach `timeouts: ConnectionTimeoutsSchema.optional(),`
    terminal: TerminalSettingsSchema.optional(),
```

`TerminalSettingsSchema` steht vor `VaultSettingsSchema`. Tests: gültig; ohne `terminal` gültig; abgelehnt: `fontFamily: 'A"B'`, `'A,B'`, 65 Zeichen, `fontSize: 7`/`33`/`14.5`, `scrollback: 999`/`50001`, `cursorStyle: 'beam'`.

### 3.4 `src/shared/links.ts` (neu) + `links.test.ts`

```ts
export const MAX_LINK_LENGTH = 2048;
/** Normalized href of an http(s) link without user or password, else null. Used by renderer and main. */
export function webLinkHref(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_LINK_LENGTH) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.href;
}
```

Tests: `https://example.org/a?b=1` → gleiche href; `HTTP://Example.org` → `http://example.org/`; `null` für `file:///C:/x`, `javascript:alert(1)`, `data:text/html,x`, `ftp://h/`, `https://u:p@h/`, `https://u@h/`, `'kein link'`, Zahl, 2049 Zeichen.

### 3.5 `src/shared/ipc.ts` und Preload

```ts
// IPC_CHANNELS, nach appLocaleChanged:
  openExternal: 'app:open-external',
// DesktopApi, nach writeClipboardText:
  /** Opens an http(s) link in the default browser; main validates it again. */
  openExternal: (url: string) => Promise<void>;
// src/preload/index.ts, nach writeClipboardText:
  openExternal: url => ipcRenderer.invoke('app:open-external', url),
```

### 3.6 `src/shared/windows.ts`

```ts
import type { TerminalSettings } from './vault/types';
export interface ConnectionCatalog { nodes: VaultNode[]; confirmBeforeClosingSession: boolean; workflows: Workflow[]; terminal: TerminalSettings }
```

`window-ipc.ts:83` liefert `terminal: effectiveTerminalSettings(vault.settings)`.

### 3.7 Fehlercode

`errors/core.json`, nach `settingsWriteFailed`:
- de: `"linkNotAllowed": "Dieser Link wird nicht geöffnet. Shellherd öffnet nur http- und https-Adressen."`
- en: `"linkNotAllowed": "This link is not opened. Shellherd only opens http and https addresses."`

### 3.8 Pakete und Version

`npm install --save-exact @xterm/addon-search@0.16.0 @xterm/addon-web-links@0.12.0`; `package.json` und `package-lock.json` Version `0.20.0`.

## 4. Funktion 1: Suche

### 4.1 `src/renderer/src/components/TerminalSearchBar.tsx` (neu)

```ts
export interface TerminalSearchBarProps {
  /** Runs one search step; true when a match is selected. '' clears and returns true. */
  onFind: (query: string, direction: 'next' | 'previous', incremental: boolean) => boolean;
  /** Panel closes the bar, clears the selection and focuses the terminal. */
  onClose: () => void;
  /** Changes when Ctrl+Shift+F is pressed again: focus and select the input. */
  focusRequest: number;
}
export function TerminalSearchBar(props: TerminalSearchBarProps): JSX.Element;
```

Markup und Verhalten:
- `<div className="terminal-search" role="search" aria-label={t('terminal:search.label')}>`
- `<input type="text" aria-label={t('terminal:search.input')} placeholder={t('terminal:search.placeholder')} spellCheck={false} autoComplete="off">`; Fokus und `select()` beim Mounten und bei jeder Änderung von `focusRequest`.
- `onChange`: `found = onFind(value, 'next', true)`.
- `onKeyDown`: `Enter` → `onFind(value, 'next', false)`; `Umschalt+Enter` → `onFind(value, 'previous', false)`; `Escape` → `preventDefault`, `stopPropagation`, `onClose()`. Jeweils `preventDefault`.
- Knopf vorher: `aria-label`/`title` `t('terminal:search.previous')`, SVG Pfeil hoch `M6 15l6-6 6 6`; Knopf nächster: `t('terminal:search.next')`, `M6 9l6 6 6-6`; Knopf schließen: `t('terminal:search.close')`, SVG wie `TerminalTabs.tsx:84`. Alle `type="button"`, SVG `width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"`.
- `<span className="terminal-search-status" role="status">` zeigt `t('terminal:search.none')`, wenn der letzte `onFind` für einen nicht leeren Begriff `false` lieferte, sonst leer.
- Keine Optionen (Groß/Klein, Regex) in Stufe 1; die Suche ignoriert Groß/Klein (Addon-Standard).

### 4.2 Einbau in `TerminalPanel.tsx`

- `import { SearchAddon } from '@xterm/addon-search';` laden wie Fit; Ref `searchAddon`.
- State `searchOpen: boolean`, `searchFocus: number`; Ref `searchQuery` (letzter Begriff, `''` wenn zu).
- `term.attachCustomKeyEventHandler(event => { if (!embedded && event.type === 'keydown' && matchesShortcut(event, { ctrl: true, shift: true, code: 'KeyF' })) { event.preventDefault(); setSearchOpen(true); setSearchFocus(n => n + 1); return false; } return true; });`
- `onFind = (query, direction, incremental) => { searchQuery.current = query; if (!query) { term.clearSelection(); return true; } return direction === 'next' ? addon.findNext(query, { incremental }) : addon.findPrevious(query); }`
- `onClose = () => { searchQuery.current = ''; setSearchOpen(false); terminal.current?.clearSelection(); terminal.current?.focus(); }`
- Copy-on-select (`:117-123`): nach `if (!text || !visibleRef.current) return;` zusätzlich `if (searchQuery.current && text.toLowerCase() === searchQuery.current.toLowerCase()) return;` (R3).
- Render: `{searchOpen && !embedded && <TerminalSearchBar … />}` **vor** `<div ref={container} className="terminal-container" />`. Der `ResizeObserver` (`:186`) passt die Größe an.

## 5. Funktion 2: Links

### 5.1 `src/renderer/src/terminal-links.ts` (neu)

```ts
/** Opens a terminal link only with Ctrl held; anything but http(s) is ignored. Main validates again. */
export function openTerminalLink(event: Pick<MouseEvent, 'ctrlKey'>, uri: string): void {
  if (!event.ctrlKey || !webLinkHref(uri)) return;
  void window.desktopApi.openExternal(uri).catch(error =>
    notify.error(t('terminal:links.failedTitle'), { body: errorText(error, t('terminal:links.failed')) }));
}
```

### 5.2 Einbau in `TerminalPanel.tsx`

- State `linkHint: boolean`.
- Terminal-Option zusätzlich: `linkHandler: { activate: (event, text) => openTerminalLink(event, text), hover: () => setLinkHint(true), leave: () => setLinkHint(false), allowNonHttpProtocols: false }`.
- `term.loadAddon(new WebLinksAddon((event, uri) => openTerminalLink(event, uri), { hover: () => setLinkHint(true), leave: () => setLinkHint(false) }));`
- Render nach dem Container: `{linkHint && <div className="terminal-link-hint" aria-hidden="true">{t('terminal:links.hint')}</div>}` (nur Maus, daher `aria-hidden`).

### 5.3 Main (`src/main/index.ts`, bei den Zwischenablage-Handlern `:283-293`)

```ts
ipcMain.handle(IPC_CHANNELS.openExternal, async (event, raw: unknown) => {
  requireSshSender(event);
  vaultSessionManager.getSnapshot();
  const href = webLinkHref(raw);
  if (!href) throw new AppError('core.linkNotAllowed');
  await shell.openExternal(href);
});
```

`shell` kommt zum Electron-Import dazu. Nie `raw` direkt übergeben, nur `href`.

## 6. Funktion 3: Tab-Kürzel

### 6.1 `src/renderer/src/hooks/useShortcut.ts`

```ts
/** Ctrl+Shift+<code>, capture phase, so terminals with focus do not swallow it; fires on repeat unless allowRepeat is false. */
export function useCtrlShiftShortcut(code: string, action: () => void, allowRepeat = true): void {
  useCaptureShortcut(code, true, allowRepeat, action);
}
```
Bestehende Aufrufer bleiben unverändert.

### 6.2 `src/renderer/src/components/ConnectionPicker.tsx`

Neue optionale Prop `openRequest?: number` („Changes open the picker; 0 or undefined never opens“). `useEffect` auf `openRequest`: wenn `openRequest` > 0, nicht `disabled` und `!popover.current?.matches(':popover-open')`, dann `toggle()`.

### 6.3 `SplitTerminalArea.tsx`

```ts
const shortcutBlocked = (): boolean => {
  if (busy || !visible || draggedTabId) return true;
  if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return true;
  const active = document.activeElement;
  return !!active?.matches('input, textarea, select, [contenteditable]') && !active.matches('textarea.xterm-helper-textarea');
};
const focusTerminal = (tabId: string) => requestAnimationFrame(() =>
  document.querySelector<HTMLElement>(`#terminal-${CSS.escape(tabId)} textarea.xterm-helper-textarea`)?.focus());
const cycleTab = (step: 1 | -1): void => {
  if (shortcutBlocked()) return;
  const ids = focusedPane.tabIds;
  if (ids.length < 2) return;
  const index = ids.indexOf(focusedPane.activeTabId ?? '');
  const next = ids[(index + step + ids.length) % ids.length];
  selectTab(focusedPane.id, next);
  focusTerminal(next);
};
useCtrlShortcut('Tab', () => cycleTab(1));
useCtrlShiftShortcut('Tab', () => cycleTab(-1));
useCtrlShiftShortcut('KeyW', () => { if (!shortcutBlocked() && focusedPane.activeTabId) onClose(focusedPane.activeTabId); }, false);
const [pickerRequest, setPickerRequest] = useState<{ paneId: string; count: number }>({ paneId: '', count: 0 });
useCtrlShiftShortcut('KeyT', () => { if (!shortcutBlocked()) setPickerRequest(current => ({ paneId: focusedPane.id, count: current.count + 1 })); }, false);
// ConnectionPicker: openRequest={pickerRequest.paneId === region.pane.id ? pickerRequest.count : 0}
```

Die Hooks stehen unbedingt vor dem ersten `return` (Hook-Regel). `onClose` ist die vorhandene Rückfrage (`App.tsx:526-530`, `SecondaryWindow.tsx:109-113`). Im Layout-Menü nach `dragHint` ein Absatz `<p>{t('terminal:layoutMenu.shortcutsHint')}</p>`.

## 7. Funktion 4: Terminal-Einstellungen

### 7.1 `src/renderer/src/terminal-prefs.ts` (neu) + Test

```ts
import type { ITerminalOptions } from '@xterm/xterm';
let current: TerminalSettings = DEFAULT_TERMINAL_SETTINGS;
const listeners = new Set<() => void>();
export const terminalPrefs = {
  get: (): TerminalSettings => current,
  /** No-op (no notification) when all five fields are equal. */
  set(next: TerminalSettings): void,
  subscribe(listener: () => void): () => void,
};
export type XtermPrefOptions = Pick<ITerminalOptions, 'fontFamily' | 'fontSize' | 'scrollback' | 'cursorStyle' | 'cursorBlink'>;
export function xtermOptions(prefs: TerminalSettings): XtermPrefOptions; // fontFamily via xtermFontFamily
```

Gespeist (Teil derselben Task): `App.tsx` `useEffect(() => terminalPrefs.set(effectiveTerminalSettings(vault?.settings)), [vault?.settings]);`, `SecondaryWindow.tsx` `useEffect(() => { if (catalog) terminalPrefs.set(catalog.terminal); }, [catalog]);`.

### 7.2 Einbau in `TerminalPanel.tsx`

- Erzeugung (`:89`): `new Terminal({ ...xtermOptions(terminalPrefs.get()), screenReaderMode: true, allowProposedApi: false, linkHandler: …, theme: … })`; `cursorBlink`, `scrollback`, `fontSize`, `fontFamily` fallen weg.
- Live: `useEffect(() => terminalPrefs.subscribe(() => { const term = terminal.current; if (!term) return; Object.assign(term.options, xtermOptions(terminalPrefs.get())); if (container.current?.clientWidth) fitAddon.current?.fit(); }), []);`
- `serialize({ scrollback: 5000 })` bleibt (R11).

### 7.3 `settings-sections.ts` + Test

```ts
export const SETTINGS_SECTIONS = ['general', 'vault', 'connections', 'terminal', 'assistant'] as const;
/** Stores the full object, based on effectiveTerminalSettings(settings). */
export function withTerminal(settings: VaultSettings, patch: Partial<TerminalSettings>): VaultSettings {
  return { ...settings, terminal: { ...effectiveTerminalSettings(settings), ...patch } };
}
```
Test `settings-sections.test.ts:20` erwartet die fünf Abschnitte; neuer Test für `withTerminal`.

### 7.4 `SettingsDialog.tsx`

- `sectionTitle` bekommt `terminal: t('app:settings.sections.terminal')`.
- Abschnitt `section === 'terminal' && vault`, `const terminal = effectiveTerminalSettings(vault.settings)`:
  1. `FontSetting` (neue lokale Komponente nach dem Muster `NumberSetting`, `:45-67`): `<div className="settings-field">`, Label `app:settings.terminal.font.label`, `<input type="text" placeholder={t('app:settings.terminal.font.placeholder')} spellCheck={false} autoComplete="off" readOnly={busy}>`, Commit bei Blur/Enter: `const value = draft.trim(); const ok = value.length <= FONT_FAMILY_MAX && FONT_FAMILY_PATTERN.test(value);` ungültig → `aria-invalid` + `<p className="field-error" role="alert">{t('app:settings.terminal.font.error')}</p>`; gültig und anders → `onSaveSettings(withTerminal(vault.settings, { fontFamily: value }))`. `aria-describedby` auf den Abschnittshinweis.
  2. `<div className="settings-numbers">` mit zwei `NumberSetting`: Schriftgröße (`TERMINAL_LIMITS.fontSize`, Einheit `app:settings.terminal.fontSize.unit`) und Verlauf (`TERMINAL_LIMITS.scrollback`, `app:settings.terminal.scrollback.unit`).
  3. `<div className="settings-field">` Label `app:settings.terminal.cursor.label` + `<select disabled={busy}>` mit Optionen `block`/`bar`/`underline` → `t('app:settings.terminal.cursor.block|bar|underline')` (volle Literale, keine Key-Zusammensetzung); `onChange` speichert `cursorStyle`.
  4. `<label className="settings-check"><input type="checkbox" checked={terminal.cursorBlink} …/>{t('app:settings.terminal.blink')}</label>`
  5. `<p className="settings-hint" id={`${id}-terminal-hint`}>{t('app:settings.terminal.hint')}</p>`
- `settings-ui.css`: `.settings-field { display: grid; grid-template-columns: max-content minmax(0, 240px); align-items: center; gap: var(--space-8); margin-top: var(--space-8); color: var(--color-text); font-size: var(--fs-md); }` und `.settings-field .field-error { grid-column: 2; margin: 0; color: var(--color-danger); }`.

## 8. Funktion 5: Fensterposition

### 8.1 `src/main/app-settings.ts` + Test

```ts
export interface MainWindowState { bounds: { x: number; y: number; width: number; height: number }; maximized: boolean }
export interface AppSettings { language: LanguageSetting; mainWindow?: MainWindowState }
const MainWindowStateSchema = z.object({
  bounds: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(900).max(20_000), height: z.number().int().min(600).max(20_000) }),
  maximized: z.boolean(),
});
// readAppSettings: mainWindow nur, wenn safeParse gelingt; sonst weggelassen. language unverändert.
```
Tests: gültig gelesen; `width: 100` → kein `mainWindow`; `writeAppSettings(file, { mainWindow })` behält `language`.

### 8.2 `src/main/index.ts`

- `const settingsFile = join(app.getPath('userData'), 'settings.json');` einmal, auch für `localeStore.init` (`:211`).
- `createWindow(role, bounds?, maximized = false)`; `ready-to-show`: `if (maximized) window.maximize(); window.show();`.
- Neue Funktion `createMainWindow(settingsFile)`: liest `readAppSettings(settingsFile).mainWindow`, ruft `createWindow('main', saved ? visibleBounds(saved.bounds) : undefined, saved?.maximized ?? false)` und hängt `window.on('close', () => { if (window.isDestroyed() || window.isMinimized()) return; const { x, y, width, height } = window.getNormalBounds(); writeAppSettings(settingsFile, { mainWindow: { bounds: { x, y, width, height }, maximized: window.isMaximized() } }); })` an. Aufrufer `:322` und `:326`.
- Schreibfehler bleiben still (`writeAppSettings` gibt `false`).

## 9. Funktion 6: Aktivität

### 9.1 `src/renderer/src/terminal-activity.ts` (neu) + Test

```ts
let marked: ReadonlySet<string> = new Set();
export const tabActivity = {
  /** New set and notification only when the id was not marked. */
  mark(tabId: string): void,
  /** New set and notification only when the id was marked. */
  clear(tabId: string): void,
  subscribe(listener: () => void): () => void,
  snapshot: (): ReadonlySet<string> => marked,
};
export function useTabActivity(): ReadonlySet<string> { return useSyncExternalStore(tabActivity.subscribe, tabActivity.snapshot); }
```

### 9.2 `TerminalPanel.tsx`

- Im `data`-Zweig (`:140`): `if (!embedded && !visibleRef.current) tabActivity.mark(tabId);`
- `useEffect(() => { if (visible) tabActivity.clear(tabId); }, [visible, tabId]);`
- Im Cleanup des Sitzungs-Effekts: `tabActivity.clear(tabId);`

### 9.3 `TerminalTabs.tsx`

- `const activity = useTabActivity();` vor dem `if (!tabs.length) return null;`
- je Tab `const fresh = !welcome && activity.has(tab.id);`; Button bekommt `data-activity={fresh || undefined}`; `title` hängt bei `fresh` `` ` · ${t('terminal:tabs.activity')}` `` an.
- Nach `<span className="tab-name">`: `{fresh && <span className="tab-activity" role="img" aria-label={t('terminal:tabs.activity')} />}`.

## 10. Funktion 7: Eingabe an alle

### 10.1 `src/renderer/src/terminal-broadcast.ts` (neu) + Test

```ts
/** Plain SSH or local shell, connected; never containers, pods, RDP, SFTP, clusters or the welcome tab. */
export function broadcastEligible(tab: Pick<TerminalTab, 'connection' | 'status'>): boolean {
  const { protocol, view, target, kube } = tab.connection;
  return tab.status === 'connected' && !view && !target && !kube && (protocol === 'ssh' || protocol === 'powershell' || protocol === 'cmd');
}
let members: readonly string[] = [];
export const broadcastGroup = {
  set(tabIds: readonly string[]): void { members = tabIds.length >= 2 ? [...tabIds] : []; },
  /** The other members when tabId is one, else []. */
  others(tabId: string): readonly string[] { return members.includes(tabId) ? members.filter(id => id !== tabId) : []; },
};
```

### 10.2 `session-registry.ts`

`LiveSession` bekommt `/** Terminals only: sends input through the panel's own queue and limits. */ input?: (data: string) => void;`

### 10.3 `TerminalPanel.tsx`

- Der Körper von `term.onData` (`:165-182`) wird zu `const enqueue = (data: string): void => { … }` (unverändert inkl. 256-KiB-Grenze und `connected`-Prüfung).
- `term.onData(data => { enqueue(data); for (const other of broadcastGroup.others(tabId)) liveSessions.get(other)?.input?.(data); })`
- `register` (`:102`) setzt zusätzlich `input: enqueue`.

### 10.4 `SplitTerminalArea.tsx`

```ts
const [broadcast, setBroadcast] = useState(false);
const candidates = shownRegions.flatMap(region => {
  const tab = tabs.find(item => item.id === region.pane.activeTabId);
  return tab && broadcastEligible(tab) ? [tab.id] : [];
});
const members = broadcast ? candidates : [];
const memberKey = members.join('|');
useEffect(() => { if (broadcast && candidates.length < 2) setBroadcast(false); }, [broadcast, candidates.length]);
useEffect(() => { broadcastGroup.set(memberKey ? memberKey.split('|') : []); }, [memberKey]);
useEffect(() => () => broadcastGroup.set([]), []);
useEffect(() => { setBroadcast(false); }, [viewControls?.activeViewId]);
```

- Layout-Menü, nach den Teilen-Knöpfen, nur bei `paneList.length > 1`: `<button type="button" aria-pressed={broadcast} disabled={busy || (!broadcast && candidates.length < 2)} onClick={…}>{broadcast ? t('terminal:broadcast.stop') : t('terminal:broadcast.start')}</button>`; bei `!broadcast && candidates.length < 2` darunter `<p>{t('terminal:broadcast.needsTwo')}</p>`. Einschalten: `setBroadcast(true); setMenuPane(null); notify.info(t('terminal:broadcast.startedTitle'), { body: t('terminal:broadcast.startedBody', { number: candidates.length }) });`
- `pane-chrome` bekommt bei `members.includes(region.pane.activeTabId ?? '')` die Klasse ` is-broadcast`; im Kopf nach `pane-header-spacer`: `<button type="button" className="broadcast-chip" title={t('terminal:broadcast.chipTitle', { number: members.length })} aria-label={t('terminal:broadcast.chipTitle', { number: members.length })} onClick={() => setBroadcast(false)}>{t('terminal:broadcast.chip')}</button>`.

## 11. Stil: `src/renderer/src/terminal-comfort-ui.css` (neu, Welle 0)

Import in `TerminalPanel.tsx` (`import '../terminal-comfort-ui.css';`). Keine Bewegung, keine neuen Tokens.

```css
/* Terminal comfort: search bar, link hint, tab activity, input to all panes. No motion: keyboard-triggered or frequent. */
.terminal-search { flex: none; display: flex; align-items: center; gap: var(--space-4); min-height: var(--control-sm); box-sizing: border-box; padding: var(--space-2) var(--space-8); border-bottom: 1px solid var(--color-border); background: var(--color-bg-panel); font-size: var(--fs-sm); }
.terminal-search input { flex: 0 1 240px; min-width: 0; height: var(--control-xs); min-height: var(--control-xs); }
.terminal-search button { display: grid; place-items: center; flex: 0 0 var(--control-xs); width: var(--control-xs); height: var(--control-xs); min-height: var(--control-xs); padding: 0; border: 0; border-radius: var(--radius-sm); color: var(--color-text-muted); background: transparent; }
.terminal-search button:hover { color: var(--color-text); background: var(--color-bg-hover); }
.terminal-search-status { color: var(--color-text-muted); }
.terminal-link-hint { position: absolute; right: var(--space-8); bottom: var(--space-8); z-index: var(--layer-chrome); padding: var(--space-4) var(--space-8); border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-bg-panel); color: var(--color-text-muted); font-size: var(--fs-xs); pointer-events: none; }
.pane-header .terminal-tab[data-activity] .tab-name { color: var(--color-text); font-weight: 600; }
.pane-header .tab-activity { flex: 0 0 var(--size-dot); width: var(--size-dot); height: var(--size-dot); box-sizing: border-box; border: 2px solid var(--color-text); border-radius: 50%; }
.pane-chrome.is-broadcast .pane-header { box-shadow: inset 0 -2px 0 var(--color-warn); }
.pane-header .broadcast-chip { flex: none; height: var(--control-xs); min-height: var(--control-xs); margin-right: var(--space-4); padding: 0 var(--space-8); border: 1px solid var(--color-warn-border); border-radius: var(--radius-pill); background: var(--color-warn-bg); color: var(--color-text); font-size: var(--fs-xs); white-space: nowrap; }
.pane-header .broadcast-chip:hover { border-color: var(--color-warn); }
```

Gelb ist Zustand („Eingabe geht an mehrere“), nie Kupfer (`design-system.md:11`). Der Aktivitäts-Ring ist neutral (`--color-text`) und unterscheidet sich vom Statuspunkt durch Form, Ort und Fettschrift.

## 12. Texte (wörtlich)

### `terminal.json`

| Key | de-DE | en-US |
|---|---|---|
| `search.label` | Suche im Terminal | Search in terminal |
| `search.input` | Suchbegriff | Search term |
| `search.placeholder` | Suchen | Search |
| `search.previous` | Vorheriger Treffer (Umschalt+Eingabe) | Previous match (Shift+Enter) |
| `search.next` | Nächster Treffer (Eingabe) | Next match (Enter) |
| `search.close` | Suche schließen (Esc) | Close search (Esc) |
| `search.none` | Keine Treffer | No matches |
| `links.hint` | Strg+Klick öffnet den Link im Browser | Ctrl+click opens the link in your browser |
| `links.failedTitle` | Link nicht geöffnet | Link not opened |
| `links.failed` | Der Link konnte nicht an den Browser übergeben werden. | The link could not be passed to the browser. |
| `tabs.activity` | Neue Ausgabe | New output |
| `layoutMenu.shortcutsHint` | Strg+Umschalt+F sucht im Terminal. Strg+Tab und Strg+Umschalt+Tab wechseln den Tab, Strg+Umschalt+T öffnet eine Verbindung, Strg+Umschalt+W schließt den Tab. | Ctrl+Shift+F searches the terminal. Ctrl+Tab and Ctrl+Shift+Tab switch tabs, Ctrl+Shift+T opens a connection, Ctrl+Shift+W closes the tab. |
| `broadcast.start` | Eingabe an alle Bereiche senden | Send input to all panes |
| `broadcast.stop` | Eingabe an alle Bereiche beenden | Stop sending input to all panes |
| `broadcast.needsTwo` | Braucht mindestens zwei verbundene SSH- oder lokale Terminals in dieser Ansicht. Container-, Pod- und Remotedesktop-Tabs zählen nicht. | Needs at least two connected SSH or local terminals in this view. Container, pod and remote desktop tabs do not count. |
| `broadcast.chip` | An alle | To all |
| `broadcast.chipTitle` | Eingabe geht an {{number}} Terminals dieser Ansicht. Klicken beendet. | Input goes to {{number}} terminals in this view. Click to stop. |
| `broadcast.startedTitle` | Eingabe an alle Bereiche | Input to all panes |
| `broadcast.startedBody` | Was du tippst, geht an {{number}} Terminals dieser Ansicht, bis du im Bereichskopf auf „An alle“ klickst. | Everything you type goes to {{number}} terminals in this view until you click “To all” in a pane header. |

Platzhalter heißt `number`, nicht `count` (kein Plural, mindestens 2).

### `app.json` (`settings`)

| Key | de-DE | en-US |
|---|---|---|
| `sections.terminal` | Terminal | Terminal |
| `terminal.font.label` | Schriftart | Font |
| `terminal.font.placeholder` | Consolas | Consolas |
| `terminal.font.error` | Nur Buchstaben, Ziffern, Leerzeichen, Punkt, Binde- und Unterstrich, höchstens 64 Zeichen. | Letters, digits, spaces, dots, hyphens and underscores only, at most 64 characters. |
| `terminal.fontSize.label` | Schriftgröße | Font size |
| `terminal.fontSize.unit` | Pixel | pixels |
| `terminal.scrollback.label` | Verlauf | Scrollback |
| `terminal.scrollback.unit` | Zeilen je Terminal | lines per terminal |
| `terminal.cursor.label` | Cursor | Cursor |
| `terminal.cursor.block` | Block | Block |
| `terminal.cursor.bar` | Strich | Bar |
| `terminal.cursor.underline` | Unterstrich | Underline |
| `terminal.blink` | Cursor blinkt | Blinking cursor |
| `terminal.hint` | Gilt sofort für alle offenen Terminals dieses Vaults. Leer oder auf diesem Computer nicht installiert: Consolas. Jede Verlaufszeile belegt Speicher, 10.000 Zeilen etwa 15 MB je Terminal, bei 16 offenen Terminals bis zu 240 MB. Ein kleinerer Wert kürzt den Verlauf offener Terminals. | Applies at once to every open terminal of this vault. Empty or not installed on this computer: Consolas. Every scrollback line takes memory, 10,000 lines about 15 MB per terminal, up to 240 MB with 16 open terminals. A smaller value trims the scrollback of open terminals. |

`errors/core.json`: siehe 3.7.

## 13. Regeln und Risiken: was ausdrücklich nicht getan wird

- Kein Strg+F, Strg+T, Strg+W, Strg+1…9 und kein Strg+Alt-Kürzel (R1, R6).
- `allowProposedApi` bleibt `false`; keine Such-Decorations, keine Trefferzahl.
- `shell.openExternal` nur mit `webLinkHref`-geprüfter `href`, nie `file:`, `javascript:`, `data:`, `ftp:`, `mailto:`, nie URLs mit Benutzer/Passwort, nie ohne Strg. OSC-8-Links gehen durch denselben Handler; `allowNonHttpProtocols: false`.
- Kein Öffnen ohne entsperrten Vault (`getSnapshot()` wirft gesperrt).
- Eingabe an alle: nie an Container-, Pod-, Log-, RDP-, SFTP-, Cluster- oder Willkommen-Tabs, nie über Ansichten oder Fenster hinweg, nie unsichtbar (Chip + Linie + Meldung), aus beim Ansichtswechsel und unter zwei Mitgliedern. Workflows (`terminal-input.ts:10-20`) und Assistent senden weiterhin nur an einen Tab.
- Jede Mitglieds-Eingabe läuft durch die Queue und 256-KiB-Grenze des jeweiligen Panels; nichts umgeht `connected`.
- Fensterzustand nie im Vault, keine Nebenfenster-Bounds (die bleiben Workspaces), kein Schreiben beim Minimieren oder bei jeder Bewegung (nur beim Schließen).
- Terminal-Einstellungen nicht pro Verbindung, keine Schriftliste aus dem System (`queryLocalFonts`), keine Farbschemata.
- Kein OS-Toast, keine Glocke, keine Animation; kein neuer Motion-Gate-Eintrag.
- Snapshot-Länge bleibt 5000 Zeilen.
- Ältere App-Versionen verwerfen `settings.terminal` beim Speichern (Zod-`object` entfernt unbekannte Schlüssel, wie bei `timeouts`). Bekannt und hingenommen.

**Risiken:** (a) Ob `onSelectionChange` bei `findNext` synchron feuert, ist egal: R3 vergleicht den Text. (b) Ein großer Verlaufswert trimmt beim Verkleinern den Verlauf offener Terminals (im Hinweis genannt). (c) Strg+Tab wird in der Capture-Phase immer verschluckt, auch im Dialog; dort hat es keine Funktion. (d) Ob Electrons Standardmenü Strg+Umschalt+W/T belegt, habe ich nicht am laufenden Programm geprüft; das Standardmenü belegt Strg+W, nicht die Umschalt-Varianten.

## 14. Stufe 1 gegenüber Extras

**Stufe 1:** alles in Abschnitt 3 bis 11.

**Extras (benannt, nicht bauen):** Trefferzahl und Hervorhebung aller Treffer (Proposed-API + Hex-Farben aus Tokens), Suchoptionen Groß/Klein, Regex, ganzes Wort; F3/Umschalt+F3; Glocke als eigener Hinweis; Aktivitätspunkt an Ansichten-Tabs; OS-Benachrichtigung bei Ausgabe im Hintergrund; Strg+Umschalt+1…9; Kürzel für „Eingabe an alle“ und freie Auswahl der Mitglieder; Workflows an alle; Pod-Terminals mit Produktionswarnung; Schrift-Auswahlliste; Zeilenhöhe, Ligaturen; Nebenfenster-Position außerhalb von Workspaces; Link-Kontextmenü „Link kopieren“.

## 15. Zerlegung in Tasks (exklusive Dateien)

| Welle | Task | Dateien (exklusiv) | Inhalt | hängt ab von |
|---|---|---|---|---|
| 0 | **A Vertrag** | `src/shared/vault/types.ts`, `src/shared/vault/schema.ts`, `src/shared/vault/schema.test.ts`, `src/shared/vault/terminal-settings.ts` (neu), `src/shared/vault/terminal-settings.test.ts` (neu), `src/shared/links.ts` (neu), `src/shared/links.test.ts` (neu), `src/shared/ipc.ts`, `src/shared/windows.ts`, `package.json`, `package-lock.json` | 3.1–3.6, 3.8 | – |
| 0 | **B Texte** | `src/shared/locales/de-DE/terminal.json`, `…/en-US/terminal.json`, `…/de-DE/app.json`, `…/en-US/app.json`, `…/de-DE/errors/core.json`, `…/en-US/errors/core.json` | Abschnitt 12, 3.7 | – |
| 0 | **C Stil** | `src/renderer/src/terminal-comfort-ui.css` (neu), `docs/design-system.md` | Abschnitt 11; in der Doku unter „Meldungen“ ein Absatz zu Suchleiste, Link-Hinweis, Aktivitäts-Ring und „An alle“ (ohne Bewegung) | – |
| 1 | **D Main** | `src/main/index.ts`, `src/main/app-settings.ts`, `src/main/app-settings.test.ts`, `src/main/window-ipc.ts`, `src/main/window-ipc.test.ts`, `src/preload/index.ts` | 3.5 Preload, 3.6 Katalog, 5.3, 8 | A, B |
| 1 | **E Renderer-Grundlagen** | `src/renderer/src/terminal-prefs.ts` (+`.test.ts`), `terminal-activity.ts` (+`.test.ts`), `terminal-broadcast.ts` (+`.test.ts`), `terminal-links.ts`, `session-registry.ts`, `App.tsx`, `SecondaryWindow.tsx` | 5.1, 7.1, 9.1, 10.1, 10.2 | A, B |
| 1 | **F Einstellungen** | `src/renderer/src/settings-sections.ts`, `settings-sections.test.ts`, `components/SettingsDialog.tsx`, `settings-ui.css` | 7.3, 7.4 | A, B |
| 1 | **G Suchleiste** | `src/renderer/src/components/TerminalSearchBar.tsx` (neu) | 4.1 | B, C |
| 2 | **H Terminal-Panel** | `src/renderer/src/components/TerminalPanel.tsx` | 4.2, 5.2, 7.2, 9.2, 10.3, CSS-Import | E, G |
| 2 | **I Bereiche und Tabs** | `src/renderer/src/components/SplitTerminalArea.tsx`, `components/TerminalTabs.tsx`, `components/ConnectionPicker.tsx`, `hooks/useShortcut.ts` | 6, 9.3, 10.4 | E |
| 3 | **K Demo** | `.claude/skills/run-app/sshd.mjs`, `screens.mjs`, `driver.mjs`, `fakes.test.mjs`, `SKILL.md` | Abschnitt 16 | H, I, D, F |
| 3 | **L Doku** | `CHANGELOG.md`, `CHANGELOG.en.md`, `docs/handbuch.md`, `docs/manual.md` | Eintrag 0.20.0; Handbuch beim Terminal-Absatz (`handbuch.md:74-77`) und bei den Einstellungen (`:83-121`) | alle aus Welle 2 |

Hinweis für die Prüfung: `i18n-catalog.test.ts` meldet die Keys aus B als verwaist, bis H, I und F sie benutzen; grün erst nach Welle 2. `npm run typecheck` ist nach jeder Welle grün, weil die Welle-0-Verträge nur optionale Felder und neue Dateien bringen, außer `ConnectionCatalog.terminal` (Pflichtfeld, D liefert es in derselben Welle wie der erste Leser E).

## 16. Demo-Stack (run-app)

- `sshd.mjs` `outputs` (`:25-30`) ergänzen: `'cat ~/LIESMICH'`: `'Handbuch: https://intranet.demo/handbuch\r\nStatus:   https://status.intranet.demo/'`. In `serveShell` (`:120`) vor der `outputs`-Zeile: `if (command === 'sleep 3; echo fertig') { setTimeout(() => { stream.write(`fertig\r\n${prompt}`); }, 3000); continue; }` (die Zeile bekommt den Prompt erst nach der Ausgabe).
- `driver.mjs`: Route `move`: `?x=&y=` → `page.mouse.move(x, y)`.
- `screens.mjs`, neue Blöcke und Bilder (alle auf `web-01`):
  - `terminal-search`: verbinden, `uptime` + Enter, `key('Control+Shift+F')`, `type('load')`, warten auf `.terminal-search`, Bild **`terminal-search`**.
  - `terminal-link`: `cat ~/LIESMICH` + Enter, per `eval` das Rechteck des `span` mit `https://intranet.demo` in `.xterm-rows` holen, `move` auf die Mitte, warten auf `.terminal-link-hint`, Bild **`terminal-link`**.
  - `settings-terminal`: Einstellungen öffnen, Abschnitt „Terminal“ per `scrollIntoView`, Bild **`settings-terminal`**.
  - `tab-activity`: zwei Tabs `web-01` im selben Bereich; im ersten `sleep 3; echo fertig` + Enter, sofort den zweiten Tab wählen, warten auf `.terminal-tab[data-activity]`, Bild **`tab-activity`**.
  - `broadcast`: Bereich nebeneinander teilen, in beiden `web-01`, Layout-Menü → „Eingabe an alle Bereiche senden“, `uptime` + Enter, warten auf zwei `.broadcast-chip` und `load average` in beiden Panels, Bild **`broadcast`**.
- `fakes.test.mjs`: ein Test für die verzögerte Ausgabe und `cat ~/LIESMICH`, `SKILL.md`: Blockliste.
