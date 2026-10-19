# Menüpunkt „Einstellungen“ – Validierung (Stufe 3)

Stand: 2026-10-19 · Branch `claude/feature/i18n` (HEAD 7ee6b32) · geprüft gegen den Code in diesem Worktree. Basis ist grün: `npm run typecheck` sowie `npx vitest run` mit 112 Dateien und 1619 Tests.
Eingaben: [Spec](2026-10-19-settings-design.md), Konzept `.superpowers/sdd/settings-research.md`.

**Dieser Anhang ist bindend und geht Spec und Konzept vor.** Wo er schweigt, gelten die Spec und danach das Konzept.

**Urteil: ready after corrections.** 7 Blocker (alle mit Fix), 16 Korrekturen, 9 Entscheidungen.

---

## 1. TypeScript-Vertrag (wörtlich übernehmen)

Die Umsetzer von 1A, 1B und 1C arbeiten parallel im selben Arbeitsbaum. Namen, Feldnamen, Optionalität und Exportorte gelten wörtlich. Dazu kommen nur private Helfer.

### 1.1 `src/renderer/src/settings-sections.ts` (neu, Task 1A, Test `settings-sections.test.ts`)

```ts
import type { AiSettings, Vault, VaultSettings } from '../../shared/vault/types';
import { t } from './i18n';

export const SETTINGS_SECTIONS = ['general', 'vault', 'assistant'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** ['general'] without a vault, all three with one. */
export function settingsSections(vault: Vault | null): readonly SettingsSection[];

/** "Noch kein Anbieter eingerichtet." or "2 Anbieter, Standard: Azure"; the default falls back to the first provider. */
export function aiProviderSummary(ai: AiSettings | undefined): string;

/** New object; only confirmBeforeClosingSession changes. */
export function withConfirmBeforeClosing(settings: VaultSettings, value: boolean): VaultSettings;
```

So sieht `aiProviderSummary` aus, wörtlich: `const providers = ai?.providers ?? []`. Ist die Liste leer, folgt `t('app:settings.assistant.none')`. Sonst wird `standard = providers.find(item => item.id === ai?.defaultProviderId) ?? providers[0]` bestimmt und es folgt `t('app:settings.assistant.summary', { count: providers.length, name: standard.name })`. `t` wird nur innerhalb der Funktion aufgerufen, nie auf Modulebene.

### 1.2 `src/renderer/src/shortcut-match.ts` (neu, Task 1B, Test `shortcut-match.test.ts`)

```ts
export interface ShortcutKeys { ctrl: boolean; shift: boolean; code: string }
export type ShortcutEvent = Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'code'>;

/** ctrlKey === ctrl, shiftKey === shift, no Alt (AltGr is Ctrl+Alt), code equal. metaKey is ignored (as today). */
export function matchesShortcut(event: ShortcutEvent, keys: ShortcutKeys): boolean;

export type SettingsShortcutAction = 'open' | 'close' | 'ignore';
/**
 * Ctrl+, toggles only between "nothing open" and "settings open".
 * openDialogClasses: className of every `dialog[open]` in the document.
 *  - !settingsOpen: 'open' if openDialogClasses is empty, else 'ignore'.
 *  - settingsOpen:  'close' if !busy and exactly one open dialog whose classes contain 'settings-dialog', else 'ignore'.
 */
export function settingsShortcutAction(settingsOpen: boolean, busy: boolean, openDialogClasses: readonly string[]): SettingsShortcutAction;
```

### 1.3 `src/renderer/src/hooks/useShortcut.ts` (Task 1B)

```ts
/** Ctrl+Shift+<code>, capture phase; behaviour unchanged (also fires on repeat). */
export function useCtrlShiftShortcut(code: string, action: () => void): void;
/** Ctrl+<code> without Shift/Alt, capture phase. Always preventDefault + stopPropagation on a match; action only if !event.repeat. */
export function useCtrlShortcut(code: string, action: () => void): void;
```

Beide nutzen `matchesShortcut`. Die Aufrufer `useAssistantToggle.ts:17` und `SecondaryWindow.tsx:100` bleiben unverändert.

### 1.4 `src/renderer/src/components/SettingsDialog.tsx` (neu, Task 1A)

```ts
import type { Vault, VaultSettings } from '../../../shared/vault/types';
import '../settings-ui.css';

export interface SettingsDialogProps {
  /** null before unlocking (start card): only "Allgemein" and the locked hint. */
  vault: Vault | null;
  busy: boolean;
  /** Skip the open animation (Ctrl+, and the return from the AI providers). */
  instant?: boolean;
  /** Element focused after showModal(); 'manageAi' falls back to 'close' without a vault. Default 'close'. */
  initialFocus?: 'close' | 'manageAi';
  onClose: () => void;
  onManageAi: () => void;
  onSaveSettings: (settings: VaultSettings) => Promise<boolean>;
}
export function SettingsDialog(props: SettingsDialogProps): JSX.Element;
```

Der Aufbau ist bindend:

```tsx
<dialog ref={dialogRef} className="confirm-dialog settings-dialog" data-instant={instant ? '' : undefined}
  aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
  <h2 id={`${id}-title`}>{t('app:settings.title')}</h2>
  {settingsSections(vault).map(section => <section key={section} className="settings-section" aria-labelledby={`${id}-${section}`}>
    <h3 id={`${id}-${section}`}>{sectionTitle(section)}</h3>
    …
  </section>)}
  <div className="form-actions"><button ref={closeRef} type="button" className="primary-button" disabled={busy} onClick={onClose}>{t('common:actions.close')}</button></div>
</dialog>
```

- `sectionTitle` ist eine Map mit vollen Literalen nach dem Muster `kindLabel` (`AiSettingsDialog.tsx:21-26`): `({ general: t('app:settings.sections.general'), vault: t('app:settings.sections.vault'), assistant: t('app:settings.sections.assistant') })[section]`. **Keine** Template-Keys, siehe B1.
- **general** enthält `<div className="settings-stack"><LanguageSetting /><FileTypeSetting /></div>`. Ohne Vault folgt `<p className="settings-hint">{t('app:settings.locked')}</p>`.
- **vault** enthält `<label className="settings-check"><input type="checkbox" checked={vault.settings.confirmBeforeClosingSession} disabled={busy} aria-describedby={`${id}-confirm-hint`} onChange={event => void onSaveSettings(withConfirmBeforeClosing(vault.settings, event.target.checked))} />{t('app:settings.confirmClose.label')}</label>` und `<p className="settings-hint" id={`${id}-confirm-hint`}>{t('app:settings.confirmClose.hint')}</p>`. Einen eigenen Fehlertext gibt es nicht. Ein Fehler erscheint als Hinweis von `persistVault`, und dessen Rücksetzen auf den alten Vault (`App.tsx:459`) setzt den Haken zurück.
- **assistant** enthält `<p className="settings-summary">{aiProviderSummary(vault.ai)}</p>` und `<button ref={manageRef} type="button" className="secondary-button" disabled={busy} onClick={onManageAi}>{t('app:settings.assistant.manage')}</button>`.
- `useNativeSurfaceBlock(true)` als Hook-Aufruf im Rumpf; im Effekt (nur einmal, `[]`): `dialogRef.current?.showModal()` und `(initialFocus === 'manageAi' && manageRef.current ? manageRef.current : closeRef.current)?.focus()`. Siehe B7.

### 1.5 `src/renderer/src/components/FileTypeSetting.tsx` (neu, Task 1A)

Die Datei enthält `export function FileTypeSetting()`, den Code aus `WelcomePage.tsx:66-89` Zeichen für Zeichen, und die nötigen Importe (`useEffect`, `useState`, `useT` aus `'../i18n'`). `WelcomePage.tsx` exportiert `FileTypeSetting` danach **nicht** mehr.

### 1.6 `App.tsx` (Task 1B)

```ts
type AppDialog =
  | { kind: 'settings'; instant: boolean; focus: 'close' | 'manageAi' }
  | { kind: 'ai'; backToSettings: boolean };
const [appDialog, setAppDialog] = useState<AppDialog | null>(null);   // replaces showAiSettings (App.tsx:116)
const settingsReturnFocus = useRef<HTMLElement | null>(null);
```

- `openSettings(instant: boolean)` speichert `document.activeElement` (nur ein `HTMLElement`, sonst `null`) in `settingsReturnFocus` und setzt `{ kind: 'settings', instant, focus: 'close' }`.
- `closeDialogs()` setzt `null`. Danach wird `settingsReturnFocus` gelesen und geleert. Ist das Element gesetzt, folgt `requestAnimationFrame(() => { if (target.isConnected) target.focus(); })`.
- Das Zahnrad ruft `openSettings(false)` auf, der Fuß-Link `openSettings(false)`, `Strg+,` bei `'open'` ruft `openSettings(true)` auf und bei `'close'` `closeDialogs()`.
- Assistenten-Panel `onManageProviders` (`App.tsx:870`) → `setAppDialog({ kind: 'ai', backToSettings: false })`.
- Ein **einziges** Element `settingsDialog` wird vor `if (screen === 'vault' && vault)` (`App.tsx:761`) definiert und in **beiden** Returns gerendert (siehe B3):

```tsx
const settingsVault = screen === 'vault' ? vault : null;
const settingsDialog = appDialog?.kind === 'settings' && <SettingsDialog vault={settingsVault} busy={busy}
  instant={appDialog.instant} initialFocus={appDialog.focus} onClose={closeDialogs}
  onManageAi={() => { if (settingsVault) setAppDialog({ kind: 'ai', backToSettings: true }); }}
  onSaveSettings={settings => settingsVault ? persistVault({ ...settingsVault, settings }) : Promise.resolve(false)} />;
```

- KI-Dialog (`App.tsx:877-878`): `{appDialog?.kind === 'ai' && <AiSettingsDialog settings={vault.ai} busy={busy} onClose={() => appDialog.backToSettings ? setAppDialog({ kind: 'settings', instant: true, focus: 'manageAi' }) : closeDialogs()} onSave={settings => persistVault({ ...vault, ai: settings })} />}`.
- Kürzel, nach `screenRef` (`App.tsx:189`) aufgerufen, unbedingt (Hook-Regel):

```ts
useCtrlShortcut('Comma', () => {
  const open = [...document.querySelectorAll('dialog[open]')].map(item => item.className);
  const action = settingsShortcutAction(appDialog?.kind === 'settings', busy, open);
  if (action === 'open') openSettings(true); else if (action === 'close') closeDialogs();
});
```

### 1.7 Katalogeinträge (Task 1C, wörtlich, beide Sprachen gleichzeitig)

`src/shared/locales/de-DE/app.json`:

- in `header` nach `"lock"`: `"settings": "Einstellungen"`, `"settingsTitle": "Einstellungen ({{shortcut}})"`
- in `home` nach `"crypto"`: `"settings": "Einstellungen"`
- in `welcome.tips` nach `"files"`: `"settings": "Sprache, Dateiverknüpfung und KI-Anbieter stehen unter Einstellungen (Zahnrad oben rechts, {{shortcut}})."`
- neues Objekt auf oberster Ebene nach `"fileType"`:

```json
"settings": {
  "title": "Einstellungen",
  "sections": { "general": "Allgemein", "vault": "Vault", "assistant": "KI-Assistent" },
  "locked": "Vault-Einstellungen und KI-Anbieter erscheinen nach dem Entsperren.",
  "confirmClose": {
    "label": "Vor dem Trennen laufender Sitzungen nachfragen",
    "hint": "Gilt für diesen Vault und wird mit ihm gespeichert."
  },
  "assistant": {
    "none": "Noch kein Anbieter eingerichtet.",
    "summary_one": "{{count}} Anbieter, Standard: {{name}}",
    "summary_other": "{{count}} Anbieter, Standard: {{name}}",
    "manage": "Anbieter verwalten"
  }
}
```

`src/shared/locales/en-US/app.json` (gleiche Stellen):

- `header`: `"settings": "Settings"`, `"settingsTitle": "Settings ({{shortcut}})"`
- `home`: `"settings": "Settings"`
- `welcome.tips`: `"settings": "Language, file association and AI providers are in Settings (gear at the top right, {{shortcut}})."`

```json
"settings": {
  "title": "Settings",
  "sections": { "general": "General", "vault": "Vault", "assistant": "AI assistant" },
  "locked": "Vault settings and AI providers appear after unlocking.",
  "confirmClose": {
    "label": "Ask before disconnecting running sessions",
    "hint": "Applies to this vault and is saved with it."
  },
  "assistant": {
    "none": "No provider set up yet.",
    "summary_one": "{{count}} provider, default: {{name}}",
    "summary_other": "{{count}} providers, default: {{name}}",
    "manage": "Manage providers"
  }
}
```

`common.json`, in `shortcuts` nach `"assistant"`: de-DE `"settings": "Strg+,"`, en-US `"settings": "Ctrl+,"`.

Weitere Keys gibt es nicht. Insgesamt sind es 16 neue Blätter je Sprache: 15 in `app`, 1 in `common`. Jeder Key muss als volles Literal im Code stehen, so wie in der folgenden Tabelle.

| Key | Verwendet in |
|---|---|
| `app:header.settings` | `App.tsx`, `aria-label` des Zahnrads |
| `app:header.settingsTitle` | `App.tsx`, `title` des Zahnrads mit `{ shortcut: t('common:shortcuts.settings') }` |
| `app:home.settings` | `App.tsx`, Fuß-Link der Startkarte |
| `app:welcome.tips.settings` | `WelcomePage.tsx`, mit `{ shortcut: t('common:shortcuts.settings') }` |
| `app:settings.title`, `.sections.*`, `.locked`, `.confirmClose.*`, `.assistant.manage` | `SettingsDialog.tsx` |
| `app:settings.assistant.none`, `app:settings.assistant.summary` | `settings-sections.ts` |
| `common:shortcuts.settings` | `App.tsx`, `WelcomePage.tsx` |

---

## 2. Blocker (mit Fix)

**B1 – Guard (d) meldet Template-Keys als verwaist.** `i18n-catalog.test.ts:100-118` sucht jeden Key als Literal in Anführungszeichen (`'app:settings.sections.general'`). Schreibt jemand `t(\`app:settings.sections.${section}\`)`, schlägt der Guard mit drei verwaisten Keys fehl. Bei Pluralen sucht der Guard nur die Basis `app:settings.assistant.summary` (Zeile 108). **Fix:** Es gilt die Literal-Map aus 1.4 und der Aufruf mit Basis-Key aus 1.1. Das Entfernen von Welcome und Startkarte macht **keinen** Key verwaist. `app:language.*` und `app:fileType.*` bleiben über `LanguageSetting.tsx` und `FileTypeSetting.tsx` benutzt, `app:welcome.goodToKnow` bleibt in `WelcomePage.tsx` (geprüft).

**B2 – Typisierte Keys: Welle 1 ist nur als Ganzes grün.** `src/shared/i18n.d.ts` bindet `t()` an die de-DE-Ressourcen. Ein Key ohne Katalogeintrag ist deshalb ein Typfehler, ein Katalogeintrag ohne Benutzer ein Fehler in Guard (d). Eine Katalog-Welle vorab wäre also rot. **Fix:** 1A, 1B und 1C bleiben eine Welle. Während der Welle sind nur zwei Typfehler erlaubt: fehlende Keys aus 1C und fehlende Module oder Props aus 1A in `App.tsx`. Das Gate läuft erst, wenn alle drei Tasks fertig sind. Die Assertions in 1A (`settings-sections.test.ts`) brauchen die Texte aus 1C. 1A schreibt sie wörtlich nach 1.7 und führt den Test erst nach 1C aus.

**B3 – Die Startkarte ist ein eigener Return-Zweig.** `App.tsx:887-1079` hat eigenes `<main>`, keinen `vault`, kein `persistVault` und keinen KI-Dialog. Spec und Konzept sagen nicht, wo der Dialog dort hängt und welche Callbacks er bekommt. **Fix:** Es gilt das gemeinsame Element `settingsDialog` aus 1.6. Im Vault-Zweig steht es nach dem KI-Dialog (`App.tsx:878`), im Start-Zweig direkt nach `<ToastStack />` (`App.tsx:890`). `vault` ist `screen === 'vault' ? vault : null`. `onManageAi` und `onSaveSettings` laufen ohne Vault ins Leere (`Promise.resolve(false)`). Der Fuß (`App.tsx:1076`) lautet `<footer>Shellherd {version} · <button type="button" className="link-button" onClick={() => openSettings(false)}>{t('app:home.settings')}</button></footer>`. `.link-button` kommt global aus `navigation-ui.css:73`, statisch über `ContextMenu.tsx:3` importiert. Guard (g) ist geprüft: `Shellherd {version}` trifft die JSX-Regex nicht.

**B4 – Ein offener Dialog überlebt das Sperren.** Ein Beispiel: Die Einstellungen oder der KI-Dialog sind offen, dann öffnet Explorer eine `.term`-Datei (`App.tsx:193-194, 248-254`). Der Nutzer bestätigt, `lockVault()` läuft, und `appDialog` bleibt `{ kind: 'ai' }`. Nach dem nächsten Entsperren erscheint der KI-Dialog von selbst. `showAiSettings` hat diesen Fehler heute schon. **Fix:** Im `finally` von `lockVault` (`App.tsx:597-603`) stehen zusätzlich `setAppDialog(null); settingsReturnFocus.current = null;`.

**B5 – „Nur zwischen `null` und `'settings'`“ reicht nicht.** Viele Modale kennt `App` nicht, zum Beispiel `FilesPanel`, `PermissionsDialog`, `kubernetes/ConfirmAction`, `containers/ContainerConfirm`, `WorkflowPalette`, `ReleaseNotesDialog` und die `ConfirmDialog`s aus `pendingSshAction` und `pendingNavigation`. Mit `appDialog === null` würde `Strg+,` die Einstellungen über einer offenen Trenn-Bestätigung öffnen, also zwei gestapelte Modale. **Fix:** `settingsShortcutAction` aus 1.2 mit der DOM-Abfrage `dialog[open]` aus 1.6. Alle Modale der App sind `<dialog>` mit `showModal()` (geprüft per `grep showModal`). Bei `'ignore'` wird trotzdem `preventDefault` und `stopPropagation` aufgerufen, damit xterm das Kürzel nicht bekommt.

**B6 – Der Zustand aus der Spec kennt kein `instant`.** Spec §3 nennt `null | 'settings' | 'ai' | 'ai-from-settings'`, das Konzept §3.3 nennt `{ kind: 'ai'; back: true }`. Beide sagen nicht, woher `instant` und der Fokus nach dem Zurück kommen. **Fix:** Es gilt die Union `AppDialog` aus 1.6. Gleichzeitig wird `showAiSettings` und `setShowAiSettings` ersetzt (`App.tsx:116, 870, 877`), ohne Rest.

**B7 – Der erste Fokus läge auf dem Sprach-`<select>`.** `showModal()` fokussiert das erste fokussierbare Element, hier `LanguageSetting`. In Chromium unter Windows ändert ↑ oder ↓ auf einem geschlossenen Select den Wert sofort. Nach `Strg+,` würde eine Pfeiltaste die Sprache aller Fenster umschalten (`setLanguage` sendet einen Broadcast). **Fix:** Nach `showModal()` bekommt `closeRef` den Fokus, wie bei `ConfirmDialog.tsx:65-66`. Beim Zurück aus den KI-Anbietern bekommt ihn `manageRef` (`initialFocus: 'manageAi'`).

---

## 3. Geprüft, kein Blocker

- **`confirmBeforeClosingSession` wirkt überall.** `persistVault` setzt den Vault optimistisch (`App.tsx:451`), damit gilt der Wert für die vier Leser in `App.tsx` (524, 565, 583, 786) sofort. Main schreibt ihn in `session.ts:97` (`session.vault = …`) **vor** `onVaultChange()` (`vault/ipc.ts:207`). `index.ts:118, 148` lesen beim Schließen des Fensters den neuen Snapshot. `broadcastCatalog` (`index.ts:264`) bringt den Wert über `window-ipc.ts:72` in `SecondaryWindow.tsx:94`. Bei einem Fehler setzt `App.tsx:459` zurück. Main-Code ist nicht nötig.
- **`useNativeSurfaceBlock` beim Wechsel Einstellungen → KI → zurück.** Der Wechsel geschieht in **einem** `setAppDialog`. React führt Cleanup (−1) und Mount (+1) im selben Commit aus. `useSyncExternalStore` (`native-surface.ts:19`) liest danach `blockers > 0`, also kein Aufblitzen der RDP-Fläche. Bedingung ist K7.
- **`showModal` beim Wechsel.** Jeder Dialog wird neu gemountet und ruft `showModal()` genau einmal auf. Gestapelt wird nichts, weil immer nur einer gerendert ist (E5).
- **Capture-Kürzel gegen xterm.** Der Listener hängt in der Capture-Phase an `window` und läuft vor dem Listener der xterm-Textarea. `stopPropagation` hält die Taste von xterm fern (wie `useShortcut.ts:9`). Hat ein natives RDP-Fenster den Fokus, erreicht keine Taste das DOM. Das gilt für alle Kürzel und kommt als Satz in die Doku (K15).
- **`ui-text.test.ts`.** Die Regeln sind „…“ statt „...“ und kein `"Bitte "` am Textanfang. Spread wie `{ ...settingsVault, settings }` ist erlaubt (`DOTS`, Zeile 13). Neue Dateien werden automatisch gefunden. Kein Risiko, solange keine Literale entstehen.
- **`design-tokens.test.ts`.** `settings-ui.css` wird automatisch gefunden (Zeile 6). Die R0-Liste muss nicht erweitert werden. `@import` ist in der Datei verboten (R10). Bewegung gibt es keine, also auch keine R7-Pflicht. Alle Werte in K11 sind vorhandene Tokens.
- **Guard (f).** Alle Texte in 1.7 sind geprüft: kein „...“, kein „Bitte“/„Please“, kein „„“ in en-US und kein „““ nach einem Leerzeichen in de-DE.
- **`version.test.ts`.** Beide CHANGELOGs bekommen je einen Punkt dazu, die Parität bleibt also erhalten. Die Backticks sind gepaart.

---

## 4. Korrekturen an Spec und Konzept

- **K1 – Zeilennummern.** Die Startkarte hat `FileTypeSetting` und `LanguageSetting` in `App.tsx:927-928`, nicht 932-934. Der Fuß steht in `App.tsx:1076`, nicht 1079. `FileTypeSetting` steht in `WelcomePage.tsx:66-89`, eingebunden in 58-59. Die Importe in `App.tsx:52` werden zu `import { WelcomePage } from './components/WelcomePage';`, Zeile 66 (`LanguageSetting`) entfällt. `App` importiert weder `FileTypeSetting` noch `LanguageSetting`.
- **K2 – Signatur.** Das Konzept §5 nennt `withConfirmBeforeClosing(vault, value)`. Es gilt die Spec: `(settings: VaultSettings, value: boolean)`, siehe 1.1.
- **K3 – Abschnitt „Icons“.** `docs/design-system.md` hat keinen Abschnitt „Icons“. Die Abschnitte „Icons“ in `handbuch.md:32` und `manual.md:34` handeln vom Programmsymbol. Der Icon-Hinweis aus dem Konzept §5 **entfällt**. Das Zahnrad-SVG ist wörtlich vorgegeben (K12).
- **K4 – Assistenten-Abschnitt.** Das Handbuch hat keinen Assistenten-Abschnitt. „### KI-Anbieter“ steht für sich, mit dem Text aus §6.
- **K5 – Fokus zurückgeben.** Ohne Rückgabe landet der Fokus nach dem Schließen auf `body`. Nach `Strg+,` → `Strg+,` müsste man dann ins Terminal klicken. Den Fix enthalten `settingsReturnFocus`, `openSettings` und `closeDialogs` aus 1.6. Der Weg über die KI-Anbieter behält das gespeicherte Element.
- **K6 – Tastenwiederholung.** Wird `Strg+,` gehalten, darf der Dialog nicht flackern. `useCtrlShortcut` ignoriert `event.repeat` für die Aktion, nicht für `preventDefault`. `useCtrlShiftShortcut` bleibt unverändert.
- **K7 – Wechsel in einem Schritt.** Der Wechsel Einstellungen ↔ KI läuft immer über einen einzigen `setAppDialog`-Aufruf, nie über `null` mit späterem Öffnen. So bleiben Fokus und native Flächen stabil (§3).
- **K8 – Ort des Hooks.** `useCtrlShortcut('Comma', …)` steht nach der Deklaration von `screenRef` und `busy`, also nach `App.tsx:189`. Er nutzt `busy` und `appDialog` direkt. Die Hook-Ref in `useShortcut.ts:6` hält die Closure aktuell.
- **K9 – Tests in Node.** `settings-sections.test.ts` folgt `vault-notices.test.ts`: `import { i18n } from './i18n'`, `afterEach(async () => { await i18n.changeLanguage('de-DE'); })`. Die Fixtures bauen auf `exampleVault` aus `../../shared/vault/example` auf, zum Beispiel `{ ...exampleVault, ai: { providers: [...] } } satisfies Vault`. Die Testdateien sind Teil von `tsconfig.web.json`, deshalb müssen die Typen stimmen. Die Fälle sind Pflicht:
  - `settingsSections(null)` → `['general']`, mit Vault → `['general','vault','assistant']`.
  - `aiProviderSummary(undefined)` und `aiProviderSummary({ providers: [] })` ergeben „Noch kein Anbieter eingerichtet.“
  - Ein Anbieter „OpenAI“ ohne `defaultProviderId` ergibt „1 Anbieter, Standard: OpenAI“.
  - Zwei Anbieter mit Standard auf dem zweiten („Azure“) ergeben „2 Anbieter, Standard: Azure“.
  - Zeigt `defaultProviderId` ins Leere, ist der erste Anbieter der Standard.
  - en-US: „2 providers, default: Azure“ und „1 provider, default: OpenAI“.
  - `withConfirmBeforeClosing` liefert ein neues Objekt, die Eingabe bleibt unverändert und `theme` sowie `autoLockMinutes` bleiben gleich.
- **K10 – `shortcut-match.test.ts` (Pflichtfälle).**
  - `Ctrl+Comma` trifft `{ ctrl: true, shift: false, code: 'Comma' }`. `Ctrl+Shift+Comma`, `Ctrl+Alt+Comma` und `Comma` allein treffen nicht.
  - `Ctrl+Shift+Space` trifft `{ ctrl: true, shift: true, code: 'Space' }`.
  - `settingsShortcutAction(false, false, [])` → `'open'`.
  - `settingsShortcutAction(false, false, ['confirm-dialog compact-confirm'])` → `'ignore'`.
  - `settingsShortcutAction(true, false, ['confirm-dialog settings-dialog'])` → `'close'`.
  - `settingsShortcutAction(true, true, ['confirm-dialog settings-dialog'])` → `'ignore'`.
  - `settingsShortcutAction(true, false, ['confirm-dialog settings-dialog', 'confirm-dialog compact-confirm'])` → `'ignore'`.
  - `settingsShortcutAction(false, false, ['confirm-dialog ai-settings-dialog'])` → `'ignore'`.
- **K11 – `settings-ui.css` (nur diese Regeln, nur Tokens).** Die drei Regeln für `.file-type-setting`/`.language-setting` sind wörtlich aus `styles.css:117-120` übernommen. In `styles.css` entfallen die Zeilen 117-121, also auch `.welcome-card .file-type-setting`.

```css
/* Settings dialog. */
.settings-dialog { width: min(640px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); padding: var(--space-20); border-radius: var(--radius-lg); overflow: auto; }
.settings-dialog h2 { margin: 0 0 var(--space-12); font-size: var(--fs-xl); }
.settings-section + .settings-section { margin-top: var(--space-16); padding-top: var(--space-16); border-top: 1px solid var(--color-border); }
.settings-section h3 { margin: 0 0 var(--space-10); font-size: var(--fs-sm); font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--color-text-muted); }
.settings-stack { display: grid; gap: var(--space-8); }
.settings-check { display: flex; align-items: center; gap: var(--space-8); color: var(--color-text); font-size: var(--fs-md); }
.settings-hint { margin: var(--space-4) 0 0; font-size: var(--fs-sm); }
.settings-summary { margin: 0 0 var(--space-8); color: var(--color-text); font-size: var(--fs-md); }
.settings-dialog .form-actions { margin-top: var(--space-16); }
.file-type-setting, .language-setting { … wörtlich styles.css:117 … }
.file-type-setting small { flex-basis: 100%; color: var(--color-text); }
.language-setting select { width: auto; }
.language-setting .field-error { color: var(--color-danger); }
```

- **K12 – Zahnrad-Knopf (wörtlich).** Er steht in `App.tsx` direkt nach dem Sperren-Knopf (`App.tsx:788`, vor `</header>`). Eine CSS-Regel für `.settings-button` gibt es nicht. `.lock-button { margin-left: auto }` schiebt beide Knöpfe nach rechts.

```tsx
<button className="icon-button settings-button" type="button" aria-haspopup="dialog" aria-label={t('app:header.settings')}
  title={t('app:header.settingsTitle', { shortcut: t('common:shortcuts.settings') })} onClick={() => openSettings(false)}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>
</button>
```

- **K13 – WelcomePage.** Es entfallen `<FileTypeSetting />` und `<LanguageSetting />` (Zeilen 58-59), der Import von `LanguageSetting` (Zeile 8), die Funktion `FileTypeSetting` (Zeilen 65-89) und `useEffect`/`useState` aus Zeile 1. Neu ist ein fünfter Tipp nach `files`: `<li>{t('app:welcome.tips.settings', { shortcut: t('common:shortcuts.settings') })}</li>`. Die Props bleiben gleich.
- **K14 – run-app-Prüfung, ergänzt.**
  - (4a) Nach `GET /key?k=Control+Comma` führt `GET /key?k=ArrowDown` zu **keinem** Sprachwechsel (B7). Den Beleg liefert `POST /eval` mit `return document.activeElement?.textContent`, das Ergebnis ist „Schließen“.
  - (4b) Mit offener Trenn-Bestätigung (Tab mit laufender Sitzung schließen) bewirkt `Control+Comma` nichts (B5).
  - (4c) Nach `Control+Comma` → `Control+Comma` im Terminal liegt der Fokus wieder in `.xterm-helper-textarea` (K5).
  - (7) Einstellungen offen, Vault sperren über den Explorer-Weg ist im Treiber nicht nachstellbar. Der Fall ist durch B4 im Code abgedeckt und wird im Review gelesen.
- **K15 – Hinweis in der Doku.** Hat eine RDP-Sitzung den Fokus, gehen Kürzel an den entfernten Rechner. Das gilt auch für `Strg+,`. Der Satz steht im Handbuch und im Manual (§6).
- **K16 – Kein Main-, IPC- oder Preload-Code.** `AiSettingsDialog.tsx`, `LanguageSetting.tsx`, `SecondaryWindow.tsx` und `useAssistantToggle.ts` bleiben unverändert. Das prüft das Review per Diff.

---

## 5. Entscheidungen

| # | Entscheidung |
|---|---|
| D1 | `Strg+,` ist das einzige Kürzel ohne Animation. Zahnrad und Fuß-Link animieren, auch bei Enter oder Leertaste auf dem Knopf, wie bei allen anderen Dialogen über Knöpfe. Das Zurück aus den KI-Anbietern ist sofort da (`instant: true`), weil es ein Ersatz ist und kein neues Öffnen. |
| D2 | Der KI-Dialog animiert beim Öffnen aus den Einstellungen wie heute, denn `AiSettingsDialog` bleibt unverändert. |
| D3 | `Escape` im KI-Dialog, der aus den Einstellungen geöffnet wurde, führt wie „Fertig“ zurück in die Einstellungen, weil beide `onClose` aufrufen. |
| D4 | Im Nebenfenster gibt es kein `useCtrlShortcut('Comma')`. `Strg+,` geht dort an xterm. Das ist gewollt: ohne Wirkung und ohne Main-Änderung. |
| D5 | Das ⚙-Symbol im Assistenten-Panel (`AssistantPanel.tsx:192`, „KI-Anbieter verwalten“) bleibt. Die beiden Knöpfe unterscheiden sich durch Ort und `aria-label`. Akzeptiert, keine Änderung an `AssistantPanel.tsx`. |
| D6 | Hat der Nutzer den Dialog über `Strg+,` geöffnet, schließt `Strg+,` ihn auch wieder (Toggle), aber nur, wenn kein anderer Dialog darüber liegt und nichts speichert. |
| D7 | Der Dialog hat drei Fokusziele: „Schließen“ beim Öffnen, „Anbieter verwalten“ beim Zurück, danach das gespeicherte Element. |
| D8 | Der neue Key `app:settings.assistant.manage` („Anbieter verwalten“) steht neben `assistant:panel.manageProviders` („KI-Anbieter verwalten“). Der Abschnittstitel nennt „KI“ schon, die Texte dürfen sich also unterscheiden. |
| D9 | Die Version bleibt 0.12.0. Der erste Punkt des 0.12.0-Eintrags wird umformuliert, ein neuer Punkt kommt als **zweiter** Punkt dazu, in beiden Sprachen an derselben Stelle. |

---

## 6. Doku-Texte (Task 2A, wörtlich)

**`docs/handbuch.md`**: Die Zeilen 69-75 („## Sprache“ bis zum Ende des Abschnitts) werden ersetzt durch:

```markdown
## Einstellungen

Das Zahnrad rechts in der Kopfzeile öffnet die Einstellungen, ebenso `Strg+,`. Vor dem Entsperren führt der Link `Einstellungen` unten auf der Startkarte dorthin. Alle Werte gelten sofort, ein „Speichern“ gibt es nicht. Nebenfenster haben keine eigenen Einstellungen; Sprache und Vault-Einstellung gelten dort trotzdem. Hat eine RDP-Sitzung den Fokus, gehen Tastenkürzel an den entfernten Rechner, auch `Strg+,`.

### Sprache

Shellherd gibt es auf Deutsch und Englisch. Standard ist die Systemsprache: Bei deutscher Windows-Anzeigesprache startet Shellherd auf Deutsch, sonst auf Englisch.

Die Einstellung `Sprache` unter Einstellungen → Allgemein bietet `System`, `Deutsch` und `English`. Der Wechsel gilt sofort in allen Fenstern, ohne Neustart; offene Sitzungen laufen weiter. Die Wahl liegt in `settings.json` im Benutzerdatenordner (`%APPDATA%\Shellherd`).

Fehlermeldungen, Dialoge und Fenstertitel folgen der Sprache, ebenso Datum, Zahlen, Dateigrößen, Sortierung und Suche. Der KI-Assistent antwortet in der gewählten Sprache. Ausgaben im Stil von `kubectl` (etwa `Beschreiben` in der Cluster-Ansicht) und Rohstatus von Servern bleiben englisch. Der Installer folgt der Windows-Sprache.

### Dateiverknüpfung

`In Windows einbinden` unter Einstellungen → Allgemein verknüpft `.term`-Dateien mit Shellherd: Doppelklick im Explorer oder Rechtsklick → „Mit Shellherd öffnen“ öffnet den Vault. Die Verknüpfung gilt nur für den angemeldeten Benutzer (HKCU) und braucht keine Administratorrechte. `Verknüpfung entfernen` nimmt sie wieder heraus.

### Vault

`Vor dem Trennen laufender Sitzungen nachfragen` (Standard: an) fragt nach, bevor das Schließen eines Tabs oder Fensters, das Sperren oder ein Workspace-Wechsel laufende Sitzungen beendet. Die Einstellung gehört zum Vault und wird verschlüsselt mit ihm gespeichert; sie erscheint erst nach dem Entsperren.

### KI-Anbieter

Unter Einstellungen → KI-Assistent stehen Zahl und Standard der eingerichteten Anbieter. `Anbieter verwalten` öffnet die Anbieterliste, `Fertig` führt zurück in die Einstellungen. Dieselbe Liste öffnet auch das Zahnrad im Assistenten-Panel; die Schlüssel liegen verschlüsselt im Vault.
```

**`docs/manual.md`**: Die Zeilen 70-74 („## Language“ bis zum Ende des Abschnitts) werden ersetzt durch:

```markdown
## Settings

The gear on the right of the header opens the settings, as does `Ctrl+,`. Before unlocking, the `Settings` link at the bottom of the start card leads there. Every value applies immediately; there is no “Save”. Detached windows have no settings of their own; language and the vault setting still apply there. While an RDP session has the focus, shortcuts go to the remote computer, `Ctrl+,` included.

### Language

Shellherd follows the system language by default: German on a German Windows, English otherwise. The `Language` setting under Settings → General offers `System`, `Deutsch` and `English`. A change takes effect immediately in all windows, without a restart. The choice is stored in `settings.json` in the user data folder (`%APPDATA%\Shellherd\settings.json`), not in the vault.

The AI assistant answers in the selected language. kubectl-like output and raw status values stay in English. The installer follows the Windows language.

### File association

`Add to Windows` under Settings → General associates `.term` files with Shellherd: a double-click in Explorer or right-click → “Open with Shellherd” opens the vault. The association applies to the signed-in user only (HKCU) and needs no administrator rights. `Remove association` takes it out again.

### Vault

`Ask before disconnecting running sessions` (default: on) asks before closing a tab or window, locking or switching workspaces ends running sessions. The setting belongs to the vault and is saved encrypted with it; it appears only after unlocking.

### AI providers

Settings → AI assistant shows the number and the default of the configured providers. `Manage providers` opens the provider list, `Done` returns to the settings. The gear in the assistant panel opens the same list; keys are stored encrypted in the vault.
```

**`CHANGELOG.md` 0.12.0**: Der erste Punkt wird ersetzt, der neue Punkt steht an zweiter Stelle:

```markdown
- Shellherd gibt es jetzt auf Deutsch und Englisch. Standard ist die Windows-Anzeigesprache; unter Einstellungen (Zahnrad in der Kopfzeile, `Strg+,`, auch auf der Startkarte) stellt „Sprache“ auf System, Deutsch oder English um. Der Wechsel gilt sofort in allen Fenstern, offene Sitzungen laufen weiter.
- Neuer Dialog „Einstellungen“: Sprache, die Dateiverknüpfung mit `.term`, die Nachfrage vor dem Trennen laufender Sitzungen (pro Vault, bisher ohne Schalter) und der Einstieg zu den KI-Anbietern an einem Ort.
```

**`CHANGELOG.en.md` 0.12.0**, an denselben Stellen:

```markdown
- Shellherd is now available in German and English. It follows the Windows display language by default; “Language” in Settings (gear in the header, `Ctrl+,`, also on the start card) switches between System, Deutsch and English. The change applies to all windows at once, and open sessions keep running.
- New “Settings” dialog: the language, the `.term` file association, the question before disconnecting running sessions (per vault, previously without a switch) and the entry to the AI providers in one place.
```

**`docs/design-system.md`**: In der Gate-Tabelle kommt nach der Zeile „Bestätigungen, die eine Taste auslösen kann …“ (≈ Zeile 204) diese Zeile:

```markdown
| Einstellungen-Dialog (`.settings-dialog`) | gelegentlich, Klick oder `Strg+,` | per Klick animieren wie `.confirm-dialog`; per `Strg+,` und beim Zurück aus den KI-Anbietern sofort (`data-instant`) | harten Wechsel vermeiden, Tastatur bewegt nicht | keine eigene Regel: greift über `.confirm-dialog` und die Ausnahme `:not([data-instant])` in `styles.css` | nur `opacity` |
```

Einen Icon-Hinweis gibt es nicht (K3).

---

## 7. Wellen (final, Dateien disjunkt)

| Welle | Task | Dateien (abschließend) | Inhalt |
|---|---|---|---|
| 1 | **1A Dialog** | neu `src/renderer/src/components/SettingsDialog.tsx`, neu `src/renderer/src/components/FileTypeSetting.tsx`, neu `src/renderer/src/settings-ui.css`, neu `src/renderer/src/settings-sections.ts`, neu `src/renderer/src/settings-sections.test.ts`, `src/renderer/src/components/WelcomePage.tsx`, `src/renderer/src/styles.css` | 1.1, 1.4, 1.5, B1, B7, K9, K11, K13 |
| 1 | **1B App und Kürzel** | `src/renderer/src/App.tsx`, `src/renderer/src/hooks/useShortcut.ts`, neu `src/renderer/src/shortcut-match.ts`, neu `src/renderer/src/shortcut-match.test.ts` | 1.2, 1.3, 1.6, B3–B6, K1, K5–K8, K10, K12 |
| 1 | **1C Kataloge** | `src/shared/locales/de-DE/app.json`, `src/shared/locales/de-DE/common.json`, `src/shared/locales/en-US/app.json`, `src/shared/locales/en-US/common.json` | 1.7, genau 16 Blätter je Sprache (15 `app`, 1 `common`) |
| 2 | **2A Doku** | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `docs/design-system.md` | §6 wörtlich |

- **Überschneidungen:** keine. `styles.css` gehört nur zu 1A, `App.tsx` nur zu 1B. Die Kataloge fasst nur 1C an.
- **Fehlende Dateien:** keine. Es sind keine Änderungen nötig an `LanguageSetting.tsx`, `AiSettingsDialog.tsx`, `native-surface.ts`, `useAssistantToggle.ts`, `SecondaryWindow.tsx`, `tokens.css` (kein neuer Wert) und der R0-Liste in `design-tokens.test.ts`.
- **Schnittstellen zwischen den Tasks:** 1B importiert `SettingsDialog` aus `./components/SettingsDialog` (Props laut 1.4) und `settingsShortcutAction` aus `./shortcut-match`. 1A importiert `FileTypeSetting` aus `./FileTypeSetting` und keine App-Typen. Beide verwenden nur die Keys aus 1.7.
- **Gate:** nach Welle 1 als Ganzes (B2) und nach Welle 2 jeweils `npm run typecheck` und `npx vitest run`. Parallel zu Welle 2 läuft die run-app-Prüfung nach Konzept §5 mit den Ergänzungen aus K14.

## 8. Gate realistisch grün?

**Ja, wenn B1, B2 und K9 eingehalten werden.**

- **Typecheck:** Alle neuen Keys stehen in 1.7. Die Props sind fest vereinbart, die Union `AppDialog` wird in Callbacks über `const` eingeengt.
- **Guard (a), (b) und (c):** Die Paare in 1.7 haben dieselben Keys und Platzhalter (`shortcut`, `count`/`name`).
- **Guard (d):** Jeder Key hat einen Literal-Benutzer (Tabelle in 1.7).
- **Guard (f) und (g):** Die Texte sind geprüft, im Code stehen keine Literale.
- **`design-tokens.test.ts`:** K11 verwendet nur vorhandene Tokens. `px` steht nur in `width`, `max-height` und `border`, so wie in `assistant-ui.css:10`.
- **`version.test.ts`:** Die Parität bleibt durch je einen Punkt mehr erhalten.

Das größte Restrisiko sind Template-Keys in 1A, die Guard (d) rot färben. Das schließen 1.4 und B1 aus.
