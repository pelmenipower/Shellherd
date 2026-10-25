# Start-UI: zuletzt benutzte Vaults, Darstellung hell/dunkel/System, Workflows im Handbuch – Design

> Übernommen aus dem Konzept (Opus, `.superpowers/sdd/start-ui-research.md`). Bindend geht `2026-10-25-start-ui-validation.md` vor.


Branch `claude/feature/start-ui`, gestapelt auf 0.21.0, Ziel **0.22.0**. Drei Teile: (A) zuletzt benutzte Vault-Dateien auf dem Startbildschirm, (B) helles Theme und „System“, (C) Workflows im Handbuch. Umsetzer sind Haiku-Modelle: alle Signaturen, Texte und Fehlercodes unten sind verbindlich und wörtlich zu übernehmen.

---

## 0. Bestand (mit Fundstellen)

### A – „Zuletzt geöffnet“ heute
- `src/main/vault/last-vault.ts:4-22`: `LastVaultFile` merkt sich **einen** Pfad in `userData/last-vault.json` (`{"filePath": "…"}`). `get()` liefert ihn nur, wenn die Datei existiert (`stat().isFile()`).
- `src/main/vault/ipc.ts:64-65`: Kanal `vault:last-file` → `lastVault.get()`. Geschrieben wird an drei Stellen: nach `saveVault` (Neuer Vault, `:119`), nach `unlockVault` (`:187`), nach `saveCurrentVault` (`:216`, Datei kann umbenannt worden sein). `selectVaultFile` startet im Ordner des letzten Vaults (`:139`).
- `src/renderer/src/App.tsx:241-249`: Beim Start gewinnt eine Datei aus dem Explorer; sonst springt die App mit dem letzten Vault direkt auf `open`. `:252-257`: der Öffnen-Bildschirm wählt den letzten Vault vor, wenn noch nichts gewählt ist. `:1097-1165`: Öffnen-Formular (Knopf „Andere Vault-Datei auswählen“, schreibgeschütztes Feld „Ausgewählte Datei“, Passwort).
- **Pfade liegen schon heute im Renderer**: `lastVaultFile()` und `selectVaultFile()` liefern den Pfad, `unlockVault({ filePath, password })` (`ipc.ts:166-197`) nimmt einen beliebigen Pfad an. Explorer-Start (`vaultLaunchFile`, `second-instance`) und Drag-and-drop (`pathForFile`, `App.tsx:274`) laufen ebenfalls über einen Pfad aus dem Renderer.
- `src/main/user-data.ts:6`: `last-vault.json` gehört zu den Dateien, die einmalig aus `%APPDATA%\Terminus` übernommen werden.
- `UI_UX_PLAN.md:131` nennt die Liste als späteres Inkrement.
- **Lücke:** nur ein Eintrag, kein Entfernen, keine Markierung fehlender Dateien. Fehlt die letzte Datei, gibt es gar nichts.

### B – Theme heute
- `src/shared/vault/schema.ts:239` und `types.ts:289`: `settings.theme: 'dark' | 'light' | 'system'`. Geschrieben wird nur `'dark'` (`App.tsx:104`, `example.ts:58`), gelesen wird es nirgends. `docs/superpowers/specs/2026-10-19-settings-design.md:21` hat es ausdrücklich ausgeklammert („kein helles Thema“).
- `src/renderer/src/tokens.css:3`: `color-scheme: dark`, ein einziger Farbsatz (33 `--color-*`-Tokens, `:5-46`), dazu `--shadow-overlay` (`:83`).
- `src/renderer/src/terminal-theme.ts`: xterm bekommt `background`, `foreground`, `cursor`, `selectionBackground` aus Tokens, gelesen **einmal beim Anlegen** (`TerminalPanel.tsx:104-107`). Die ANSI-Palette ist der xterm-Standard. Es gibt nur eine Stelle mit `new Terminal` (`TerminalPanel.tsx:105`), auch für Nebenfenster und Docks. Live-Änderungen gibt es schon für Schrift und Cursor (`TerminalPanel.tsx:292-297`).
- `terminal-theme.test.ts`: Die Fallbacks müssen dem **ersten** Vorkommen des Tokens in `tokens.css` entsprechen. Der dunkle `:root`-Block muss deshalb oben stehen bleiben.
- `src/main/index.ts:103`: `backgroundColor: '#0b1120'` hart. `nativeTheme` wird nirgends benutzt.
- Sprache als Vorbild: `src/main/app-settings.ts` (`settings.json`, Feld für Feld validiert), `src/main/locale.ts`, IPC `app:get-language`/`app:set-language` in `index.ts:244-253`, UI `components/LanguageSetting.tsx`, platziert in `SettingsDialog.tsx:130` (Allgemein, auch vor dem Entsperren sichtbar).
- Feste Farben außerhalb des CSS: `native/Shellherd.RdpHost/NativeSurface.cs:36` (`BackColor` 7,11,20), `src/main/drag-ghost.ts:16-19` (eigenes Inline-CSS), `ConnectionForm.tsx:164` (Startwert des Farbwählers).
- Nutzer der Bühne `--color-bg-stage`: Terminal (`styles.css:79`, `terminal-ui.css:3,28`), aktiver Terminal-Tab (`terminal-ui.css:9`), RDP (`terminal-ui.css:77`), Manifest (`kubernetes-ui.css:115`), Assistent-Befehl (`assistant-ui.css:20`), Workflow-Vorschau (`workflows-ui.css:26`), Verbindungsdetails (`connection-ui.css:29`).
- Produktionskennzeichen: `navigation-ui.css:8` (Inset in `--color-danger`), `.kube-chip-bad` und `.kube-banner` (`kubernetes-ui.css:20,63`). Sie hängen nur an den Gefahr-Tokens.

### C – Workflows heute
- Palette `components/WorkflowPalette.tsx`, Logik `workflows.ts` (Platzhalter-Regex `:5`, Suche `:20-28`), Eintippen `terminal-input.ts:11-21`, Ziel-Shell `terminal-tabs.ts:57-63`, Editor `components/WorkflowsDialog.tsx`, Schema `schema.ts:264-271`, Kürzel `App.tsx:137` und `SecondaryWindow.tsx:121`, Kopf-Knopf `App.tsx:856`, „Als Workflow“ `AssistantPanel.tsx:220` → `App.tsx:949`.
- `docs/handbuch.md:95` und `docs/manual.md:96` nennen nur das Kürzel. Ein Kapitel fehlt.

---

## 1. Empfehlungen

| # | Fläche / Funktion | Wert | Aufwand |
|---|---|---|---|
| A1 | Liste „Zuletzt benutzt“ (8 Einträge) auf dem Öffnen-Bildschirm, Auswahl per Klick | ★★★ | kleine Main-Änderung |
| A2 | Eintrag entfernen (×), fehlende Datei markieren | ★★★ | kleine Main-Änderung |
| A3 | `LastVaultFile` durch `RecentVaults` ersetzen, `last-vault.json` nur noch einmal als Startwert lesen | ★★ | kleine Main-Änderung |
| A4 | `unlockVault` nur noch für freigegebene Pfade | ★ | nicht jetzt (siehe R-A3) |
| A5 | Liste abschaltbar, „Liste leeren“ | ★ | nicht jetzt |
| B1 | Einstellung `Darstellung` (System/Dunkel/Hell) in `settings.json`, angewendet über `nativeTheme.themeSource` | ★★★ | kleine Main-Änderung |
| B2 | Heller Token-Satz in `tokens.css` unter `@media (prefers-color-scheme: light)` | ★★★ | nur Renderer |
| B3 | xterm folgt live, im hellen Theme `minimumContrastRatio: 4.5` | ★★★ | nur Renderer |
| B4 | Fensterhintergrund (`backgroundColor`) passend zum Theme | ★★ | kleine Main-Änderung |
| B5 | Eigene helle ANSI-Palette, Rand des nativen RDP-Hosts, Drag-Ghost im hellen Theme | ★ | nicht jetzt |
| B6 | README-Bilder im hellen Theme | ★ | nicht jetzt (siehe R-B8) |
| C1 | Kapitel „Workflows“ in `handbuch.md` und `manual.md` | ★★★ | nur Doku |

---

## 2. Rulings (Entscheidungen mit Begründung)

### A – Zuletzt benutzte Vaults
- **R-A1 Anzahl 8**, die neueste oben. Gleicher Pfad wird zusammengefasst; unter Windows wird ohne Rücksicht auf Groß- und Kleinschreibung verglichen (`resolve(p).toLowerCase()`).
- **R-A2 Speicher:** Schlüssel `recentVaults` in `settings.json` (`userData`), validiert in `app-settings.ts`. Gespeichert werden nur `filePath` und `openedAt`, nie etwas aus dem Vault. Die Liste wird nur in Main verändert: bei erfolgreichem `unlockVault`, bei neuem Vault (`saveVault`) und bei `saveCurrentVault`. Der Renderer kann nur Einträge **entfernen**, und zwar per `id`. Einen Kanal zum Hinzufügen eines Pfads gibt es nicht.
- **R-A3 Sicherheit, Abweichung vom Auftragstext:** Gefordert war „Renderer darf zum Öffnen nur einen Listeneintrag (Id) oder den Datei-Dialog schicken“. `unlockVault({ filePath })` nimmt schon heute jeden Pfad an, denn Explorer-Start, `second-instance`, Drag-and-drop und Sperrbildschirm brauchen ihn. Ein zusätzlicher `unlockVault({ recentId })` würde deshalb nichts absichern. **Entscheidung:** Die neuen Kanäle nehmen ausschließlich eine `id` (Hash), `unlockVault` bleibt unverändert. Ein Main-seitiger Satz freigegebener Pfade (Dialog, Launch-Datei, Liste, Drop über Preload) ist ein eigenes Härtungs-Feature (A4). Es schützt unter anderem vor UNC-Pfaden, die bei einer XSS einen NTLM-Hash abfließen lassen könnten. Das wird im Ruling-Abschnitt der Spec genannt.
- **R-A4 Der vorhandene Mechanismus** geht in der Liste auf. `vault:last-file` bleibt mit unveränderter Signatur und liefert jetzt „neuester Eintrag, dessen Datei existiert“. Damit bleiben Startsprung (`App.tsx:241-249`), Vorauswahl (`:252-257`) und `defaultPath` im Dialog unverändert. `last-vault.ts` und `last-vault.test.ts` werden gelöscht. `last-vault.json` wird nur noch gelesen, und zwar einmal als Startwert, wenn `settings.json` keinen Schlüssel `recentVaults` hat. Geschrieben wird es nie mehr. `LEGACY_USER_DATA_FILES` bleibt unverändert, denn die Terminus-Übernahme speist so weiter den Startwert.
- **R-A5 Fehlende Dateien** bleiben in der Liste und werden markiert („Datei nicht gefunden“, Auswahlknopf `disabled`), bis man sie entfernt. Netzlaufwerke und USB-Sticks sind oft nur vorübergehend weg, deshalb wird nichts automatisch gelöscht.
- **R-A6 Überschrift „Zuletzt benutzt“ statt „Zuletzt geöffnet“**, weil auch ein Speichern den Zeitpunkt aktualisiert (der Pfad kann sich dabei ändern, `ipc.ts:215`). Die zweite Zeile zeigt nur das Datum über `formatDateTime(openedAt, 'short')`, ohne Präfix.
- **R-A7 Platzierung:** nur auf dem Bildschirm `open`, zwischen der Beschreibung und dem Knopf „Andere Vault-Datei auswählen“. Bei leerer Liste wird nichts gezeigt. Der Startbildschirm `home` bleibt unverändert, denn mit einer vorhandenen Datei springt die App ohnehin auf `open`. Das Feld „Ausgewählte Datei“ bleibt (kleinster Eingriff).
- **R-A8 Datenschutz:** Pfade enthalten den Windows-Benutzernamen. Der Startbildschirm kommt **nicht ins README**. Der Screenshot-Block `recent` legt nur synthetische Pfade unter `RUN_DIR\vaults` an, bricht bei `--readme` ab und warnt, wenn `RUN_DIR` im Benutzerprofil liegt. `crop=status` hilft hier nicht.

### B – Theme
- **R-B1 Ort der Einstellung: `settings.json` (userData), nicht im Vault.** Begründung: Start-, Öffnen- und Sperrbildschirm sowie Einstellungen vor dem Entsperren müssen das Theme kennen, und der Vault ist dann verschlüsselt. Eine Gerätevorliebe gehört zum Gerät, wie die Sprache. **Das Vault-Feld `settings.theme` wird ignoriert:** keine Migration, keine Schema-Änderung, `App.tsx:104` schreibt weiter `'dark'`. Jeder vorhandene Vault enthält ohnehin nur `'dark'`, weil es nie eine Oberfläche dafür gab.
- **R-B2 Standard `'dark'`** (nicht `'system'` wie bei der Sprache). Nach dem Update sieht niemand ungefragt ein anderes Bild, und der Rote Faden („dichtes, dunkles Ops-Werkzeug“) bleibt der Normalfall.
- **R-B3 Mechanismus: nur `nativeTheme.themeSource`, kein `data-theme`-Attribut, kein Broadcast.** Main setzt `nativeTheme.themeSource = setting` (Electron kennt genau `'system' | 'light' | 'dark'`). Damit gilt `prefers-color-scheme` in **allen** Renderern sofort und live (Hauptfenster, Nebenfenster, Sperrbildschirm). Fensterrahmen, Kontextmenüs und Datei-Dialoge folgen ebenfalls, und unter `'system'` folgt das Theme dem Windows-App-Modus. `tokens.css` schaltet per `@media (prefers-color-scheme: light) { :root { … } }`. Weil die Media-Query schon beim ersten Frame stimmt, gibt es kein Aufblitzen und keine Preload-Argumente.
- **R-B4 Die Bühne wird im hellen Theme auch hell** (Terminal, Manifest, Code). Gegenposition „Bühne bleibt dunkel“ wurde verworfen: Sie bräuchte Sonderregeln für den aktiven Terminal-Tab (`terminal-ui.css:9`: dunkler Grund mit dunklem Text), für den Cursor (der Akzent wird hell dunkler) und für jede Karte im Terminal. Für die ANSI-Lesbarkeit setzt xterm im hellen Theme `minimumContrastRatio: 4.5`. Das hebt **jede** Vordergrundfarbe zellweise auf AA gegen ihren Hintergrund, auch 256-Farben und Truecolor, die eine eigene Palette nicht erreichen würde. VS Code macht es standardmäßig genauso. Im dunklen Theme bleibt es bei `1` (unverändert). Eine eigene helle ANSI-Palette ist ein Extra (B5).
- **R-B5 xterm folgt live:** `TerminalPanel` hört auf `matchMedia('(prefers-color-scheme: light)')` und setzt `term.options.theme` und `term.options.minimumContrastRatio` neu. Das ist Neuzeichnen, keine Bewegung.
- **R-B6 Keine Bewegung beim Umschalten.** Farbübergänge sind ohnehin verboten. Neuer Eintrag im Motion-Gate: „Theme-Wechsel | selten | nicht | …“.
- **R-B7 Nicht angefasst:** `NativeSurface.cs` (das RDP-Bild ist fremder Inhalt, der dunkle Grund ist nur vor dem ersten Bild zu sehen), `drag-ghost.ts` und der Startwert des Farbwählers. Vom Nutzer gewählte Verbindungsfarben bleiben Daten.
- **R-B8 README:** keine hellen Bilder in Stufe 1 (doppelte Pflege, und der Rote Faden ist dunkel). `settings.png` zeigt die neue Zeile „Darstellung“ automatisch beim nächsten `--readme`-Lauf. Ein Neuaufnehmen ist optional.

### C – Doku
- **R-C1** Ein neues Kapitel `## Workflows` direkt vor `## Split-Ansichten und Workspaces` (`handbuch.md:176`, `manual.md:175`). Die Texte stehen in §6 und sind am Code geprüft.

---

## 3. Verträge (wörtlich)

### 3.1 `src/shared/theme.ts` (neu)
```ts
/** App colour scheme, stored in settings.json; main applies it via nativeTheme.themeSource. */
export const THEME_SETTINGS = ['system', 'dark', 'light'] as const;
export type ThemeSetting = typeof THEME_SETTINGS[number];
```

### 3.2 `src/main/app-settings.ts` (erweitern)
```ts
import { isAbsolute } from 'node:path';
import { THEME_SETTINGS } from '../shared/theme';
import type { ThemeSetting } from '../shared/theme';

/** Newest first; at most MAX_RECENT_VAULTS. Only path and time, never vault content. */
export interface RecentVaultEntry { filePath: string; /** ms since epoch */ openedAt: number }
export const MAX_RECENT_VAULTS = 8;
export interface AppSettings { language: LanguageSetting; theme: ThemeSetting; mainWindow?: MainWindowState; update: UpdateSettings; /** absent = never written (legacy seed allowed) */ recentVaults?: RecentVaultEntry[] }
export const DEFAULT_APP_SETTINGS: AppSettings = { language: 'system', theme: 'dark', update: { enabled: true } };
```
- `theme`: `z.enum(THEME_SETTINGS).safeParse(raw.theme)`, ungültig → `'dark'`.
- `recentVaults`: Ist `raw.recentVaults` kein Array, fehlt das Feld (`undefined`). Sonst wird jedes Element mit `z.object({ filePath: z.string().min(1).max(4096).refine(isAbsolute), openedAt: z.number().int().min(0) })` geprüft, ungültige fallen weg, danach `.slice(0, MAX_RECENT_VAULTS)`. Ein leeres Array bleibt `[]` (wichtig für den Startwert, siehe 3.3).
- Rückgabeobjekt: `{ language, theme, ...(mainWindow), update, ...(recentVaults !== undefined ? { recentVaults } : {}) }`.
- `writeAppSettings` bleibt unverändert.
- Tests in `app-settings.test.ts`: Alle vorhandenen `toEqual`-Erwartungen bekommen `theme: 'dark'`. Neu: `theme` gültig/ungültig; `recentVaults` fehlt → `undefined`, `[]` → `[]`, relative Pfade und negative Zeiten fallen weg, mehr als 8 → 8.

### 3.3 `src/main/vault/recent-vaults.ts` (neu, ersetzt `last-vault.ts`)
```ts
import type { RecentVault } from '../../shared/ipc';

/** Dedup key: resolved path, case-insensitive on Windows. */
export function recentKey(filePath: string, platform: NodeJS.Platform = process.platform): string;
/** Stable id for the renderer: first 16 hex chars of sha256(recentKey(filePath)). */
export function recentId(filePath: string, platform?: NodeJS.Platform): string;

export class RecentVaults {
  constructor(settingsFile: string, legacyFile: string, now?: () => number /* default Date.now */);
  /** Newest first. missing = stat fails or is not a file. Never throws (unreadable settings → []). */
  list(): Promise<RecentVault[]>;
  /** filePath of the first entry that is not missing, or null. Replaces LastVaultFile.get(). */
  latest(): Promise<string | null>;
  /** Moves/inserts filePath at the top with openedAt = now(), dedups by recentKey, keeps 8. Best effort: never throws. */
  touch(filePath: string): Promise<void>;
  /** Removes the entry with this id. Unknown id or non-string → AppError('core.invalidRequest'); write fails → AppError('core.settingsWriteFailed'). Returns list(). */
  remove(id: unknown): Promise<RecentVault[]>;
}
```
- Gespeichert wird über `readAppSettings`/`writeAppSettings(file, { recentVaults })`.
- Startwert: Ist `readAppSettings(settingsFile).recentVaults === undefined` und enthält `legacyFile` JSON mit einem nicht leeren String `filePath`, ist die Liste `[{ filePath, openedAt: <mtimeMs der legacyFile, gerundet> }]`. Sonst ist sie `[]`. Geschrieben wird erst beim nächsten `touch`/`remove`.
- `RecentVault.name = basename(filePath)`, `folder = dirname(filePath)`.
- `stat` aller Einträge parallel (`Promise.all`).
- Tests `recent-vaults.test.ts` (Temp-Ordner): Reihenfolge und Duplikate. `recentKey('C:\\A\\x.term','win32') === recentKey('c:\\a\\X.TERM','win32')`, unter `'linux'` ungleich. Höchstens 8. `missing` mit echter und fehlender Datei. `latest()` überspringt fehlende. `remove` mit unbekannter Id → `core.invalidRequest`. Startwert aus `legacyFile`, aber nicht, wenn `recentVaults: []` schon gesetzt ist. `touch` wirft nicht, wenn `settingsFile` in einem nicht vorhandenen Ordner liegt.

### 3.4 `src/shared/ipc.ts` und `src/preload/index.ts`
```ts
// IPC_CHANNELS (neben lastVaultFile bzw. appSetLanguage einfügen)
recentVaults: 'vault:recent-list',
removeRecentVault: 'vault:recent-remove',
appGetTheme: 'app:get-theme',
appSetTheme: 'app:set-theme',

/** One entry of the open screen list. filePath is for display and for the existing unlockVault; the list itself only changes in main. */
export interface RecentVault { id: string; filePath: string; name: string; folder: string; openedAt: number; missing: boolean }

// DesktopApi
/** Newest first, at most 8. Main window only. */
recentVaults: () => Promise<RecentVault[]>;
/** Removes one entry by id and returns the new list; the file itself is untouched. */
removeRecentVault: (id: string) => Promise<RecentVault[]>;
/** Stored colour scheme (default 'dark'). Main window only. */
getTheme: () => Promise<ThemeSetting>;
/** Persists first, then applies to all windows; throws core.settingsWriteFailed. */
setTheme: (setting: ThemeSetting) => Promise<ThemeSetting>;
```
Preload: `recentVaults: () => ipcRenderer.invoke('vault:recent-list')`, `removeRecentVault: id => ipcRenderer.invoke('vault:recent-remove', id)`, `getTheme: () => ipcRenderer.invoke('app:get-theme')`, `setTheme: setting => ipcRenderer.invoke('app:set-theme', setting)`. Bestehende Signaturen, auch `lastVaultFile`, bleiben unverändert.

### 3.5 `src/main/vault/ipc.ts`
- `const recent = new RecentVaults(join(app.getPath('userData'), 'settings.json'), join(app.getPath('userData'), 'last-vault.json'));`
- `lastVaultFile` → `recent.latest()`. `selectVaultFile` `defaultPath` → `recent.latest()`. Die drei `lastVault.set(x)` → `recent.touch(x)`.
- Neu: `handle(IPC_CHANNELS.recentVaults, () => recent.list());` und `handle(IPC_CHANNELS.removeRecentVault, (_event, id: unknown) => recent.remove(id));`. Beide laufen über den vorhandenen `guard` (nur Hauptfenster). `toVaultAppError` reicht `AppError` unverändert durch (`ipc-error.ts:5`, geprüft).

### 3.6 `src/main/index.ts`
- Direkt nach `setMainLocale(languageState.effective);`: `nativeTheme.themeSource = readAppSettings(settingsFile).theme;`
- `createWindow`: `backgroundColor: windowBackground(),` mit `const windowBackground = (): string => nativeTheme.shouldUseDarkColors ? '#0b1120' : '#f1eee9';` (Kommentar: `// Shown before the first paint; matches --color-bg-app of the active scheme.`)
- `nativeTheme.on('updated', () => { for (const target of [windowRegistry.main(), ...windowRegistry.secondaries()]) if (target && !target.isDestroyed()) target.setBackgroundColor(windowBackground()); });` Nur registrierte Fenster, nie das transparente Drag-Ghost-Fenster.
- IPC (neben der Sprache):
```ts
ipcMain.handle(IPC_CHANNELS.appGetTheme, event => { windowRegistry.requireMain(event); return readAppSettings(settingsFile).theme; });
ipcMain.handle(IPC_CHANNELS.appSetTheme, (event, value: unknown) => {
  windowRegistry.requireMain(event);
  const parsed = z.enum(THEME_SETTINGS).safeParse(value);
  if (!parsed.success) throw new AppError('core.invalidRequest');
  if (!writeAppSettings(settingsFile, { theme: parsed.data })) throw new AppError('core.settingsWriteFailed');
  nativeTheme.themeSource = parsed.data;
  return parsed.data;
});
```

### 3.7 `src/renderer/src/terminal-theme.ts` und `TerminalPanel.tsx`
```ts
export const LIGHT_SCHEME_QUERY = '(prefers-color-scheme: light)';
/** Light stage: xterm lifts every foreground to WCAG AA against its cell background; dark keeps xterm's palette as is. */
export function xtermContrast(light: boolean): number { return light ? 4.5 : 1; }
```
- In `TerminalPanel.tsx` beim Anlegen zusätzlich: `minimumContrastRatio: xtermContrast(window.matchMedia(LIGHT_SCHEME_QUERY).matches)`.
- Neuer Effekt, direkt nach dem `terminalPrefs`-Effekt (`:291-297`):
```ts
// The colour scheme can change at runtime (setting or Windows); xterm keeps its own copy of the colours.
useEffect(() => {
  const query = window.matchMedia(LIGHT_SCHEME_QUERY);
  const apply = (): void => {
    const term = terminal.current;
    if (!term) return;
    const styles = getComputedStyle(document.documentElement);
    term.options.theme = xtermTheme(name => styles.getPropertyValue(name));
    term.options.minimumContrastRatio = xtermContrast(query.matches);
  };
  query.addEventListener('change', apply);
  return () => query.removeEventListener('change', apply);
}, []);
```
- Test (`terminal-theme.test.ts`): `xtermContrast(true) === 4.5`, `xtermContrast(false) === 1`. Die vorhandenen Fallback-Tests bleiben (der dunkle Block steht zuerst).

### 3.8 `src/renderer/src/components/ThemeSetting.tsx` (neu) und `SettingsDialog.tsx`
```tsx
/** Colour scheme: dark, light or like Windows. Main window only; main applies it to every window. */
export function ThemeSetting(): JSX.Element | null
```
Aufbau wie `LanguageSetting.tsx`: `getTheme()` beim Mounten; bei Änderung `setTheme(value).then(v => { setFailure(null); setSetting(v); }).catch(error => setFailure(errorText(error)))`. Markup:
```tsx
<label className="file-type-setting language-setting">
  <span>{t('app:theme.label')}</span>
  <select aria-label={t('app:theme.aria')} value={setting} onChange={…}>
    {THEME_SETTINGS.map(value => <option key={value} value={value}>{t(THEME_LABELS[value])}</option>)}
  </select>
  {failure && <small className="field-error" role="alert">{failure}</small>}
</label>
```
`const THEME_LABELS = { system: 'app:theme.system', dark: 'app:theme.dark', light: 'app:theme.light' } as const;` (volle Literale, keine zusammengesetzten Keys). Kein neues CSS.
`SettingsDialog.tsx:130`: `<div className="settings-stack"><LanguageSetting /><ThemeSetting /><FileTypeSetting /></div>`.

### 3.9 `src/renderer/src/components/RecentVaults.tsx` (neu), `App.tsx`, `styles.css`
```tsx
interface RecentVaultsProps {
  selectedPath: string;
  disabled: boolean;
  onSelect: (filePath: string) => void;
  /** After a successful removal, with the removed entry's path. */
  onRemoved: (filePath: string) => void;
}
/** Open screen: vault files used last. Selecting only fills the file; unlocking stays an explicit action. */
export function RecentVaults(props: RecentVaultsProps): JSX.Element | null
```
- `recentVaults()` beim Mounten. Ist der Fehler da oder die Liste leer, gibt die Komponente `null` zurück.
- Markup:
```tsx
<section className="recent-vaults" aria-labelledby={`${id}-title`}>
  <h3 id={`${id}-title`}>{t('app:recent.title')}</h3>
  <ul>
    {entries.map(entry => <li key={entry.id}>
      <button type="button" className="recent-vault-open" aria-pressed={entry.filePath === selectedPath}
        disabled={disabled || entry.missing} title={entry.filePath} onClick={() => onSelect(entry.filePath)}>
        <strong>{entry.name}</strong>
        <small>{entry.missing ? t('app:recent.missing') : formatDateTime(entry.openedAt, 'short')}</small>
        <small>{entry.folder}</small>
      </button>
      <button type="button" className="icon-button" disabled={disabled}
        aria-label={t('app:recent.removeAria', { name: entry.name })} title={t('app:recent.removeAria', { name: entry.name })}
        onClick={…removeRecentVault(entry.id) → setEntries(next); onRemoved(entry.filePath); Fehler → setFailure(errorText(error))}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>
      </button>
    </li>)}
  </ul>
  {failure && <p className="field-error" role="alert">{failure}</p>}
</section>
```
- `App.tsx`, Formular `screen === 'open'`, direkt nach `<p className="form-description">…</p>`:
```tsx
<RecentVaults selectedPath={selectedVaultPath} disabled={busy}
  onSelect={filePath => { setFormError(null); setSelectedVaultPath(filePath); requestAnimationFrame(() => passwordInputRef.current?.focus()); }}
  onRemoved={filePath => { if (filePath === selectedVaultPath) setSelectedVaultPath(''); }} />
```
`const passwordInputRef = useRef<HTMLInputElement>(null);` kommt an das Passwortfeld des Öffnen-Formulars (`ref={passwordInputRef}`). Wird der gewählte Eintrag entfernt, wählt der vorhandene Effekt `:252-257` den neuesten vorhandenen vor. Das ist gewollt.
- `styles.css` (bei `.welcome-list`, nur Tokens):
```css
.recent-vaults { display: grid; gap: var(--space-6); margin: var(--space-12) 0; }
.recent-vaults h3 { margin: 0; color: var(--color-text-muted); font-size: var(--fs-sm); font-weight: 600; }
.recent-vaults ul { display: grid; gap: var(--space-4); margin: 0; padding: 0; list-style: none; }
.recent-vaults li { display: flex; align-items: center; gap: var(--space-4); }
.recent-vault-open { display: grid; flex: 1; min-width: 0; gap: var(--space-2); padding: var(--space-6) var(--space-10); text-align: left; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-panel); color: var(--color-text); }
.recent-vault-open:hover:not(:disabled) { border-color: var(--color-border-strong); background: var(--color-bg-raised); }
.recent-vault-open[aria-pressed='true'] { border-color: var(--color-accent); background: var(--color-bg-selected); }
.recent-vault-open strong, .recent-vault-open small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-vault-open strong { font-size: var(--fs-md); font-weight: 600; }
.recent-vault-open small { color: var(--color-text-muted); font-size: var(--fs-sm); }
```
Die Regel für das Druck-Feedback (`styles.css:145`) nimmt `.recent-vault-open` in ihre `:not()`-Liste auf (flache Listenfläche). Keine Bewegung.

### 3.10 Texte (`src/shared/locales/*/app.json`, neue Keys)
| Key | de-DE | en-US |
|---|---|---|
| `app:recent.title` | `Zuletzt benutzt` | `Recently used` |
| `app:recent.missing` | `Datei nicht gefunden` | `File not found` |
| `app:recent.removeAria` | `„{{name}}“ aus der Liste entfernen` | `Remove “{{name}}” from the list` |
| `app:theme.label` | `Darstellung` | `Appearance` |
| `app:theme.aria` | `Farbschema der Oberfläche` | `Interface color scheme` |
| `app:theme.system` | `System` | `System` |
| `app:theme.dark` | `Dunkel` | `Dark` |
| `app:theme.light` | `Hell` | `Light` |

Die Anführungszeichen folgen `app:openVaultFile.title` (de „…“, en “…”). Neue Fehlercodes gibt es nicht. Verwendet werden `core.invalidRequest` und `core.settingsWriteFailed` (beide vorhanden).

---

## 4. Heller Token-Satz (vollständig)

In `tokens.css` **nach** dem `:root`-Block und vor `@keyframes`:
```css
/* Light scheme: main sets nativeTheme.themeSource from settings.json, so this query follows "Darstellung" in every window. Colours only; roles stay the same. */
@media (prefers-color-scheme: light) {
  :root { color-scheme: light; /* every --color-* below */ --shadow-overlay: 0 10px 28px rgb(40 30 20 / 18%); }
}
```
Kontraste sind nach WCAG 2.x berechnet, gemischte Tönungen über `--color-bg-panel`. AA heißt 4,5:1 für Text und 3:1 für Punkte, Fokusring und Ränder von Controls.

| Token | dunkel | **hell** | Begründung / Kontrast hell |
|---|---|---|---|
| `--color-bg-stage` | `#0b1018` | `#ffffff` | Bühne hell (R-B4); Code-Text 16,6, Text 17,5 |
| `--color-bg-app` | `#0e141e` | `#f1eee9` | warmes Grau, Basis; Text 15,1, gedämpft 6,5 |
| `--color-bg-panel` | `#151d2a` | `#f8f6f3` | Leisten/Dialoge heben sich hell vom App-Grund ab; Text 16,2, gedämpft 7,0, Akzent 6,2 |
| `--color-bg-raised` | `#1c2635` | `#ebe7e1` | Controls/Zeilen-Hover eine Stufe dunkler als Panel; Text 14,2, gedämpft 6,2, Akzent/ok/warn/Gefahr ≥ 5,3 |
| `--color-bg-hover` | `#253043` | `#e4dfd8` | Hover und „an“-Chips; Text 13,2, gedämpft 5,7, Akzenttext 5,0, ok/warn/Gefahr ≥ 4,96 |
| `--color-bg-input` | `#0f1520` | `#ffffff` | Eingaben weiß wie die Bühne; Text 17,5 |
| `--color-bg-selected` | `#2e2620` | `#f5dfcc` | ein opakes helles Kupfer; Text 13,6, gedämpft 5,9, Akzent 5,2 |
| `--color-bg-active` | `rgb(232 147 90 / 14%)` | `rgb(148 70 26 / 12%)` | Tönung aus hellem Akzent, auf Panel ≈ `#ece1d9`; Text 13,6, Akzent 5,2 |
| `--color-bg-drop` | `rgb(232 147 90 / 22%)` | `rgb(148 70 26 / 20%)` | ≈ `#e4d3c8`; Text 12,0, Akzent 4,6 |
| `--color-bg-tint` | `rgb(232 147 90 / 6%)` | `rgb(148 70 26 / 6%)` | ≈ `#f2ebe6`; Text 16,0 |
| `--color-overlay` | `rgb(255 255 255 / 8%)` | `rgb(0 0 0 / 5%)` | neutraler Hover nach dunkel statt nach hell; Text 14,6, gedämpft 6,3 |
| `--color-backdrop` | `rgb(5 8 13 / 72%)` | `rgb(29 25 21 / 40%)` | dimmt, ohne den Dialog zu erschlagen; Sperrbildschirm nutzt opakes `--color-bg-app` (unberührt) |
| `--color-border` | `#2e3a4c` | `#d6cfc6` | Haarlinie, Kontrast 1,43 auf Panel wie dunkel (1,47): Rolle „Linie“, kein alleiniger Control-Rand |
| `--color-border-strong` | `#4d5b70` | `#8a7f73` | Hover-Rand/aktiver Tab; 3,6 auf Panel, 3,2 auf erhöht (≥ 3:1, besser als dunkel 2,45) |
| `--color-text` | `#ebe7e2` | `#1d1915` | warmes Fast-Schwarz; ≥ 12,0 auf jeder Fläche |
| `--color-text-muted` | `#aeb3bc` | `#5a534b` | ≥ 5,7 auf jeder Fläche einschließlich Hover |
| `--color-text-code` | `#e6e2dc` | `#221e1a` | 16,6 auf Bühne |
| `--color-accent` | `#e8935a` | `#94461a` | Berner Kupfer, abgedunkelt: `#e8935a` hätte auf Weiß nur 2,4. Ton bleibt Kupfer (≈ 22°); Link/Text ≥ 5,0 auf allen Flächen, Fokusring ≥ 3 überall |
| `--color-accent-hover` | `#f0a673` | `#7a3a12` | hell wird Hover dunkler (mehr Gewicht); 8,0 auf Panel |
| `--color-on-accent` | `#2a1406` | `#ffffff` | Text auf Primärknopf: 6,7 auf Akzent, 8,6 auf Akzent-Hover |
| `--color-selection-bg` | `#3f2e22` | `#f2cfb3` | Textauswahl und xterm-Auswahl, helles Kupfer |
| `--color-selection-text` | `#fbf5ef` | `#1d1915` | 11,9 auf Auswahl |
| `--color-ok` | `#4ade80` | `#116b34` | Text und Punkt; 6,1 Panel, 5,4 erhöht, 5,0 Hover |
| `--color-warn` | `#facc15` | `#765c00` | Oliv-Gelb (≈ 47°), bewusst weg vom Kupfer, damit „Gelb ist nie Akzent“ erkennbar bleibt; 5,9 Panel, 4,8 Hover, 5,7 auf Warn-Fläche |
| `--color-warn-border` | `#6b5a12` | `#d4b34a` | Rand einer Warnung, dekorativ wie dunkel |
| `--color-warn-bg` | `#2a2614` | `#fbf3d5` | Warn-Fläche; Text 15,7 |
| `--color-ok-bg` | `#16261f` | `#e3f3e8` | Erfolgs-Fläche; Text 15,2, ok 5,75 |
| `--color-danger` | `#fda4af` | `#b42318` | Gefahr-Text und Produktionslinie; 6,1 Panel, 5,3 erhöht, 5,75 auf Gefahr-Fläche |
| `--color-danger-strong` | `#fb7185` | `#d92d20` | Punkte und Icons (3:1 genügt): 4,5 Panel, 3,65 Hover |
| `--color-danger-text` | `#fecdd3` | `#7a1a12` | Text auf Gefahr-Fläche 9,3, auf Hover 8,1 |
| `--color-danger-bg` | `#341c25` | `#fdeceb` | Gefahr-Fläche (Banner, Produktions-Chip); Text 15,3 |
| `--color-danger-bg-hover` | `#512333` | `#fadad7` | Gefahr-Knopf beim Hover |
| `--color-danger-border` | `#713442` | `#e59a93` | Gefahr-Rand, dekorativ wie dunkel |
| `--shadow-overlay` | `0 10px 28px rgb(0 0 0 / 45%)` | `0 10px 28px rgb(40 30 20 / 18%)` | 45 % Schwarz wäre auf Hell ein Fleck |

Folgen: Der **Kubernetes-Produktionsrahmen** (Inset `--color-danger`, `.kube-chip-bad`, `.kube-banner`) und alle **Statuspunkte** laufen nur über die Tokens oben und erfüllen AA. Der **RDP-Rand** `.rdp-surface` wird hell, das RDP-Bild bleibt, wie es ist (R-B7). Im **Terminal** sorgt `minimumContrastRatio 4.5` dafür, dass auch Gelb, Weiß und die hellen Bright-Farben der xterm-Standardpalette auf Weiß lesbar bleiben.

**Lint-Ergänzung** (`design-tokens.test.ts`, neuer Test): Der Block unter `@media (prefers-color-scheme: light)` in `tokens.css` deklariert **jedes** Token aus `COLORS` und dazu nur `color-scheme` und `--shadow-overlay`. Ein `--color-*` ohne hellen Wert ist damit ein Fehler. R9 und R17 bleiben grün, weil der helle Block keine gesperrten Tokens enthält.

---

## 5. Regeln und Risiken (was ausdrücklich nicht getan wird)
1. Kein Kanal, mit dem der Renderer einen Pfad in die Liste schreibt. `removeRecentVault` prüft die Id gegen die Liste in Main. Unbekannte Werte → `core.invalidRequest`.
2. `unlockVault` und `vault:last-file` behalten ihre Signaturen (R-A3, R-A4).
3. Keine Vault-Schema-Änderung, keine Migration von `settings.theme` (R-B1).
4. Kein `data-theme`, kein Theme-Broadcast, kein neues Preload-Argument (R-B3).
5. Keine Transition oder Animation beim Theme-Wechsel und keine auf `.recent-vault-open` (Motion-Gate). Neue Gate-Zeilen: „Theme-Wechsel | selten, Einstellung oder Windows | nicht | Farbwechsel ist Zustand, kein Ereignis | – | –“ und „Liste ‚Zuletzt benutzt‘ (`.recent-vaults`) | beim Öffnen | nicht | Liste, Tastatur | – | –“.
6. Keine harten Farben außerhalb von `tokens.css`. Einzige neue Literale sind die zwei Hex-Werte für `backgroundColor` in `index.ts` (Main, vor dem ersten Frame, wie bisher `#0b1120`).
7. Bleiben unangetastet: `NativeSurface.cs`, `drag-ghost.ts`, `ConnectionForm.tsx:164`, `last-vault.json` in `LEGACY_USER_DATA_FILES`.
8. **Risiko:** `stat` auf einen nicht erreichbaren UNC-Pfad kann die Liste einige Sekunden aufhalten. Das gilt heute schon für den einen letzten Vault. Hingenommen; der Rest des Formulars bleibt bedienbar.
9. **Risiko:** In `settings.json` stehen jetzt bis zu acht Pfade statt einem. Das steht so im Handbuch.
10. **Risiko:** `minimumContrastRatio` verändert im hellen Theme absichtlich die Farben fremder Programme. Wer genaue Farben will, nutzt Dunkel.
11. Zwischen den Wellen meldet `i18n-catalog.test.ts` die neuen Keys als verwaist, solange Welle 2 sie noch nicht nutzt. Erwartet; am Ende muss alles grün sein.

---

## 6. Doku-Texte (wörtlich)

### 6.1 `docs/handbuch.md`
**a) Nach dem Absatz „Sperren trennt nicht …“ (Ende von `## Aktueller Stand`, vor `### Sperren und Willkommens-Tab`) neu:**
```
### Zuletzt benutzte Vaults

`Vault öffnen` zeigt unter `Zuletzt benutzt` bis zu acht Vault-Dateien, die du zuletzt geöffnet, angelegt oder gespeichert hast, die neueste oben, mit Datum und Ordner. Ein Klick wählt die Datei aus, danach fehlt nur das Passwort. Beim Start ist die neueste vorhandene Datei vorausgewählt. Ist eine Datei nicht mehr da (verschoben, gelöscht oder Netzlaufwerk getrennt), steht `Datei nicht gefunden` darunter, und der Eintrag lässt sich nicht wählen; er bleibt, bis du ihn entfernst. Das `×` neben einem Eintrag nimmt ihn nur aus der Liste, die Datei bleibt unberührt. Die Liste enthält nur Pfade und Zeitpunkte, nie Passwörter oder Inhalte, und liegt in `settings.json` im Benutzerdatenordner. Die Pfade zeigen den Ordner und damit oft deinen Windows-Benutzernamen; denk daran, bevor du einen Screenshot des Startbildschirms teilst.
```
**b) Nach `### Sprache` neu:**
```
### Darstellung

`Darstellung` unter Einstellungen → Allgemein bietet `System`, `Dunkel` und `Hell`; Standard ist `Dunkel`. `System` folgt dem Windows-Farbmodus für Apps und wechselt mit, wenn du ihn umstellst. Der Wechsel gilt sofort in allen Fenstern, ohne Neustart; offene Sitzungen laufen weiter. Fensterrahmen und Windows-Dialoge folgen ebenfalls. Im hellen Modus sind auch Terminal, Manifeste und Code hell; zu blasse Terminalfarben hebt Shellherd dort auf mindestens 4,5:1 Kontrast an. Das Bild einer Remotedesktop-Sitzung bleibt unverändert. Die Wahl liegt wie die Sprache in `settings.json` im Benutzerdatenordner, nicht im Vault, damit sie schon vor dem Entsperren gilt.
```
Außerdem in `## Einstellungen` den Satz „Nebenfenster haben keine eigenen Einstellungen; Sprache und Vault-Einstellung gelten dort trotzdem.“ ersetzen durch „Nebenfenster haben keine eigenen Einstellungen; Sprache, Darstellung und Vault-Einstellung gelten dort trotzdem.“

**c) Vor `## Split-Ansichten und Workspaces` neu:**
```
## Workflows

Workflows sind gespeicherte Befehle, die Shellherd für dich in ein Terminal tippt. Sie liegen verschlüsselt im Vault (höchstens 1.000) und stehen in allen Fenstern bereit.

### Palette

`Strg+Umschalt+Leertaste` oder der Knopf `Workflows` in der Kopfzeile öffnet die Palette, dasselbe Kürzel schließt sie wieder. Sie geht nur bei entsperrtem Vault, auch im Nebenfenster. Die Überschrift nennt den Ziel-Tab (`Workflows → web-01`) oder `kein Terminal ausgewählt`.

Die Suche prüft Name, Tags, Beschreibung und Befehl ohne Rücksicht auf Groß- und Kleinschreibung; bei mehreren Wörtern muss jedes vorkommen. Workflows für die Shell des aktiven Tabs und für alle Shells stehen oben, alphabetisch; Workflows für eine andere Shell folgen blasser und bleiben wählbar. `↑` und `↓` wählen, `Enter` oder ein Klick nimmt den Workflow, `Esc` oder ein Klick neben die Palette schließt sie.

Ohne Platzhalter tippt Shellherd den Befehl sofort ein und schließt die Palette. Ausgeführt wird nichts: `Enter` drückst du selbst. Workflows nehmen nur verbundene SSH-, PowerShell- und CMD-Tabs sowie die Shell eines Pods an; Dateiansicht, Container- und Cluster-Ansicht, Remotedesktop und Willkommensseite nicht. Ist das Terminal getrennt oder läuft darin ein Vollbildprogramm wie `vim`, `less` oder `top`, bleibt die Palette offen und nennt den Grund. `Eingabe an alle` gilt für Workflows nicht; sie gehen immer nur in den aktiven Tab.

### Platzhalter

`{{name}}` im Befehl ist ein Platzhalter. Erlaubt sind Buchstaben, Ziffern, Leerzeichen, `_`, `.` und `-`, höchstens 40 Zeichen. Hat ein Workflow Platzhalter, fragt die Palette jeden Namen einmal ab, in der Reihenfolge des ersten Vorkommens; derselbe Name an mehreren Stellen bekommt denselben Wert. Darunter zeigt eine Vorschau den fertigen Befehl. Zeilenumbrüche und Steuerzeichen in den Werten entfernt Shellherd, ein leeres Feld bleibt eine leere Stelle. `Eintippen` (oder `Enter`) tippt den Befehl ein, `Kopieren` legt ihn in die Zwischenablage und schließt die Palette, `Zurück` oder `Esc` führt zur Liste zurück.

### Workflows verwalten

`Workflows verwalten` unten in der Palette öffnet die Liste, nur im Hauptfenster. `Neuer Workflow` legt einen an, `Bearbeiten` ändert ihn, `Löschen` entfernt ihn sofort und ohne Rückfrage. `Fertig` schließt die Liste. Jede Änderung wird gleich verschlüsselt im Vault gespeichert.

| Feld | Regel |
|---|---|
| `Name` | Pflicht, höchstens 120 Zeichen |
| `Befehl (eine Zeile)` | Pflicht, eine Zeile, höchstens 4.000 Zeichen; mehrere Befehle verbindest du mit `&&` oder `;` |
| `Beschreibung (optional)` | höchstens 2.000 Zeichen, steht in der Palette unter dem Befehl |
| `Tags (durch Komma getrennt)` | höchstens 20 Tags mit je bis zu 40 Zeichen; doppelte fallen weg |
| `Für Shell` | `Alle`, `SSH`, `PowerShell` oder `CMD`; ordnet die Palette, sperrt aber nichts |

Unter dem Befehlsfeld nennt das Formular die erkannten Platzhalter.

### Aus dem Assistenten

Schlägt der KI-Assistent einen Befehl vor, öffnet `Als Workflow` das Formular mit diesem Befehl. Name und übrige Felder ergänzt du; `Speichern` legt den Workflow an, `Abbrechen` verwirft ihn.
```
Außerdem in `### Eingabe an alle` steht „Workflows und der Assistent schreiben weiter nur in einen Tab.“ Das bleibt so.

### 6.2 `docs/manual.md` (gleiche Stellen: nach „Locking does not disconnect …“-Absatz, nach `### Language`, vor `## Split views and workspaces`)
```
### Recently used vaults

`Open vault` lists up to eight vault files under `Recently used` that you opened, created or saved last, newest first, with date and folder. A click selects the file; only the password is left. At start the newest file that still exists is preselected. If a file is gone (moved, deleted or network drive disconnected), it shows `File not found` and cannot be selected; it stays until you remove it. The `×` next to an entry only takes it off the list, the file stays untouched. The list holds paths and times only, never passwords or contents, and lives in `settings.json` in the user data folder. Paths show the folder and therefore often your Windows user name; keep that in mind before you share a screenshot of the start screen.
```
```
### Appearance

`Appearance` under Settings → General offers `System`, `Dark` and `Light`; the default is `Dark`. `System` follows the Windows app color mode and changes along when you switch it. The change applies to all windows at once, without a restart; open sessions keep running. Window frames and Windows dialogs follow too. In light mode the terminal, manifests and code are light as well; Shellherd lifts terminal colors that are too faint to at least 4.5:1 contrast. The picture of a Remote Desktop session stays unchanged. Like the language, the choice is stored in `settings.json` in the user data folder, not in the vault, so it applies before unlocking.
```
In `## Settings`: „Secondary windows have no settings of their own; language and vault settings still apply there.“ (bzw. der vorhandene Satz) erhält „language, appearance and vault settings“.
```
## Workflows

Workflows are saved commands that Shellherd types into a terminal for you. They are stored encrypted in the vault (at most 1,000) and are available in every window.

### Palette

`Ctrl+Shift+Space` or the `Workflows` button in the header opens the palette; the same shortcut closes it. It only works while the vault is unlocked, in secondary windows too. The title names the target tab (`Workflows → web-01`) or `no terminal selected`.

The search looks at name, tags, description and command, ignoring case; with several words, each must match. Workflows for the shell of the active tab and for all shells come first, alphabetically; workflows for another shell follow dimmed and can still be chosen. `↑` and `↓` select, `Enter` or a click takes the workflow, `Esc` or a click outside the palette closes it.

Without placeholders Shellherd types the command at once and closes the palette. Nothing runs: you press `Enter` yourself. Workflows go only into connected SSH, PowerShell and CMD tabs and pod shells; not into the file view, container and cluster views, Remote Desktop or the welcome page. If the terminal is disconnected or runs a full-screen program such as `vim`, `less` or `top`, the palette stays open and tells you why. `Send input to all panes` does not apply to workflows; they always go into the active tab only.

### Placeholders

`{{name}}` in a command is a placeholder. Letters, digits, spaces, `_`, `.` and `-` are allowed, up to 40 characters. If a workflow has placeholders, the palette asks for each name once, in order of first use; the same name in several places gets the same value. A preview below shows the finished command. Shellherd removes line breaks and control characters from the values; an empty field stays an empty spot. `Type in` (or `Enter`) types the command, `Copy` puts it on the clipboard and closes the palette, `Back` or `Esc` returns to the list.

### Managing workflows

`Manage workflows` at the bottom of the palette opens the list, in the main window only. `New workflow` adds one, `Edit` changes it, `Delete` removes it at once without asking. `Done` closes the list. Every change is saved encrypted in the vault right away.

| Field | Rule |
|---|---|
| `Name` | required, at most 120 characters |
| `Command (single line)` | required, one line, at most 4,000 characters; join several commands with `&&` or `;` |
| `Description (optional)` | at most 2,000 characters, shown in the palette below the command |
| `Tags (comma-separated)` | at most 20 tags of up to 40 characters each; duplicates are dropped |
| `For shell` | `All`, `SSH`, `PowerShell` or `CMD`; orders the palette but blocks nothing |

Below the command field the form lists the placeholders it found.

### From the assistant

When the AI assistant suggests a command, `As workflow` opens the form with that command. Fill in the name and the other fields; `Save` adds the workflow, `Cancel` discards it.
```
(`manual.md` schreibt amerikanisch „color“; geprüft.)

### 6.3 `docs/design-system.md`
- Roter Faden, nach dem fettgedruckten Satz: „Dunkel ist der Standard. Das helle Theme tauscht nur Werte, nie Rollen: dieselben Tokens, dieselben Regeln.“
- Unter `### Farben` neue Unterüberschrift `### Helles Theme` mit Mechanismus (`nativeTheme.themeSource` → `prefers-color-scheme` → `@media`-Block in `tokens.css`) und der Tabelle aus §4 (Spalten: Name, hell, Kontrast).
- Motion-Gate: die zwei Zeilen aus §5.5.
- Ausnahmeliste Druck-Feedback: `.recent-vault-open` ergänzen.
- Prüfung: neuer Punkt **R19:** „Der helle Block in `tokens.css` deklariert jedes `--color-*` aus R9, dazu nur `color-scheme` und `--shadow-overlay`.“
- Erlaubte Farbausnahmen: „`src/main/index.ts`: `backgroundColor` des Fensters vor dem ersten Frame (`#0b1120` dunkel, `#f1eee9` hell).“

### 6.4 Release 0.22.0
- `package.json` und `package-lock.json` (beide `version`-Stellen) → `0.22.0`.
- `CHANGELOG.md` neuer Abschnitt `## [0.22.0] – 2026-10-25`:
  - „Neu: `Vault öffnen` zeigt die bis zu acht zuletzt benutzten Vault-Dateien mit Datum und Ordner. Ein Klick wählt eine Datei aus; fehlende Dateien sind markiert und lassen sich mit `×` aus der Liste nehmen. Gespeichert werden nur Pfade und Zeitpunkte in `settings.json`, nie Inhalte.“
  - „Neu: Helles Theme. Einstellungen → Allgemein → `Darstellung` bietet `System`, `Dunkel` und `Hell`, Standard bleibt `Dunkel`. Der Wechsel gilt sofort in allen Fenstern, auch für Fensterrahmen und Windows-Dialoge; im hellen Terminal hebt Shellherd zu blasse Farben auf lesbaren Kontrast an.“
  - „Doku: Kapitel „Workflows“ im Handbuch (Palette, Platzhalter, Verwalten, Übernahme aus dem Assistenten).“
- `CHANGELOG.en.md` entsprechend auf Englisch, gleiche Überschrift.
- `README.md`, Feature „Settings in one place“: hinter „language,“ → „language, light or dark appearance,“.

---

## 7. Zerlegung in Tasks (exklusive Dateien, Wellen)

**Welle 1** (keine Abhängigkeiten untereinander):
| Task | Dateien (exklusiv) | Inhalt |
|---|---|---|
| T1 Settings-Felder | `src/main/app-settings.ts`, `src/main/app-settings.test.ts`, `src/shared/theme.ts` (neu) | §3.1, §3.2 |
| T2 Vertrag | `src/shared/ipc.ts`, `src/preload/index.ts` | §3.4 (importiert `ThemeSetting` aus `../shared/theme` bzw. `./theme`; legt `src/shared/theme.ts` **nicht** an, T1 tut das, Typecheck erst nach Welle 1) |
| T3 Texte | `src/shared/locales/de-DE/app.json`, `src/shared/locales/en-US/app.json` | §3.10 |
| T4 Tokens | `src/renderer/src/tokens.css`, `src/renderer/src/design-tokens.test.ts` | §4 inkl. Lint-Test R19 |
| T5 xterm | `src/renderer/src/terminal-theme.ts`, `src/renderer/src/terminal-theme.test.ts`, `src/renderer/src/components/TerminalPanel.tsx` | §3.7 |
| T6 Handbuch | `docs/handbuch.md` | §6.1 |
| T7 Manual | `docs/manual.md` | §6.2 |
| T8 Designsystem | `docs/design-system.md` | §6.3 |
| T9 Release | `package.json`, `package-lock.json`, `CHANGELOG.md`, `CHANGELOG.en.md`, `README.md` | §6.4 |

**Welle 2** (braucht T1 und T2; T12/T13 zusätzlich T3):
| Task | Dateien (exklusiv) | Inhalt |
|---|---|---|
| T10 Recent Main | `src/main/vault/recent-vaults.ts` (neu), `src/main/vault/recent-vaults.test.ts` (neu), `src/main/vault/ipc.ts`; löscht `src/main/vault/last-vault.ts` und `last-vault.test.ts` | §3.3, §3.5 |
| T11 Theme Main | `src/main/index.ts` | §3.6 |
| T12 Theme UI | `src/renderer/src/components/ThemeSetting.tsx` (neu), `src/renderer/src/components/SettingsDialog.tsx` | §3.8 |
| T13 Recent UI | `src/renderer/src/components/RecentVaults.tsx` (neu), `src/renderer/src/App.tsx`, `src/renderer/src/styles.css` | §3.9 |

**Welle 3** (alles davor):
| Task | Dateien (exklusiv) | Inhalt |
|---|---|---|
| T14 Demo und Abnahme | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Neue Blöcke **`recent`**: Vault sperren → „Andere Vault-Datei“ → Öffnen-Bildschirm. Vorher wird `recentVaults` in `profile\Shellherd\settings.json` gesetzt: `demo.term`, `RUN_DIR\vaults\team-ops.term` (als leere Datei angelegt), `RUN_DIR\vaults\archiv-2025.term` (fehlt). Shot `start-recent.png`. Danach `demo.term` aus der Liste wählen und entsperren. Bricht bei `--readme` ab und warnt, wenn `RUN_DIR` unter `os.homedir()` liegt. **`theme-light`**: `/eval window.desktopApi.setTheme('light')`, prüft `matchMedia('(prefers-color-scheme: light)').matches`. Shots `light-terminal.png` (web-01 verbunden, `ls --color` oder `cat ~/LIESMICH`), `light-sftp.png`, `light-kubernetes.png` (Produktionsrahmen), `light-settings.png` (Allgemein mit `Darstellung`). `finally`: `setTheme('dark')`. Alle mit `crop=status`, nicht in `README_SHOTS`. SKILL.md: Blöcke und Dateinamen nachtragen. Danach `npm run typecheck`, `npx vitest run`, Screenshots ansehen. |

Abhängigkeiten auf einen Blick: T10 ← T1, T2 · T11 ← T1, T2 · T12 ← T2, T3 · T13 ← T2, T3 · T14 ← alle. T4 und T5 sind unabhängig, weil der Renderer nur auf die Media-Query reagiert.

---

## 8. Erste Stufe gegenüber Extras

**Stufe 1 (diese Version 0.22.0):** T1–T14 wie oben: Liste mit 8 Einträgen, Entfernen, Markierung fehlender Dateien; Darstellung System/Dunkel/Hell über `nativeTheme` und einen Token-Block; xterm mit AA-Kontrastanhebung; Workflows-Kapitel.

**Extras (benannt, nicht jetzt):**
- A4: Main-seitige Freigabeliste für `unlockVault`-Pfade (Härtung gegen UNC/NTLM bei XSS). Eigenes Sicherheits-Feature.
- A5: Liste abschalten oder leeren, Liste auch auf `home`.
- B5: eigene helle ANSI-Palette (16 Farben als Tokens), nativer RDP-Host und Drag-Ghost im hellen Theme, `forced-colors`/Hoher Kontrast.
- B6: README-Bilder im hellen Theme (etwa ein Vorher/Nachher-Paar).
- Nur das Terminal dunkel lassen als eigene Option „Terminal immer dunkel“.

Nicht geprüft: Die Kontrastwerte stammen aus einer WCAG-Rechnung, nicht aus einer Messung im Bild; T14 sieht sie sich in den hellen Screenshots an. Ob `nativeTheme.themeSource` unter Playwright `prefers-color-scheme` umschaltet, prüft der `theme-light`-Block per Assertion.
