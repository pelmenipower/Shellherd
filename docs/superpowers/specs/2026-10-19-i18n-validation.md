# Internationalisierung de-DE / en-US – Validierung (bindender Anhang)

Stand: 2026-10-19 · Branch `claude/feature/i18n` (HEAD b4720db) · Prüfer: Stufe 3 der Feature-Pipeline.
Geprüft: `docs/superpowers/specs/2026-10-19-i18n-design.md` (Spec), `docs/superpowers/plans/2026-10-19-i18n.md` (Plan), `.superpowers/sdd/i18n-research.md` (Konzept), Ledger `.superpowers/sdd/2026-10-19-i18n/progress.md`, gegen den echten Code.

**Dieser Anhang ist bindend und geht Spec und Plan vor.** Wo er schweigt, gelten Spec und Plan.

**Urteil: ready after corrections.** 15 Blocker (alle mit Fix in diesem Anhang), 24 Korrekturen, 16 Entscheidungen.

## 0. Prüfgrundlage

- `npm view i18next version` → **26.5.2** (latest). `npm view react-i18next version` → **17.1.0**, Peers `i18next >= 26.2.0`, `react >= 16.8.0`, `typescript ^5 || ^6 || ^7`. Installiert: TypeScript 5.9.3, Vitest 5.0.1, zod 4.6.5, Electron ^44.4.2, electron-builder 26.17.0.
- Probe (Scratchpad, nicht im Repo) mit i18next 26.5.2, react-i18next 17.1.0, TS 5.9.3, beiden tsconfig-Varianten des Projekts, JSON-Importen, `as const` und `CustomTypeOptions` wie in Spec 3.1. Verifiziert:
  - `CustomTypeOptions { defaultNS: 'common'; resources: (typeof resources)['de-DE']; returnNull: false }` funktioniert in v26 unverändert. JSON-Werte sind `string` (nicht literal), Keys sind trotzdem typisiert. `t('common:cancl')`, `t('errors:ssh.keyFil')` sind Typfehler.
  - `initImmediate` existiert in v26 nicht mehr. `init({ initImmediate: false })` ist ein TS-Fehler (Excess Property). Die Option heißt `initAsync`.
  - Globales `i18next.t('ns:key')` akzeptiert alle Namespaces mit Präfix. `useTranslation()` **ohne** Argument akzeptiert nur Keys des `defaultNS` ohne Präfix (`t('errors:ssh.timeout')` → TS2345). `useTranslation(NAMESPACES)` akzeptiert alle präfixierten Keys.
  - Plural: `t('common:sessions', { count })` ist typkorrekt bei `sessions_one/_other`.
  - Template-Keys `` t(`errors:${code}`, params) `` sind typkorrekt, wenn `code` ein Union-Typ ist, nicht bei `string`.
  - `resolveJsonModule` ist bei `moduleResolution: "Bundler"` in TS 5.9 implizit `true` (`--showConfig`), auch in `tsconfig.node.json`. Explizit setzen schadet nicht.
  - Typecheck-Last: 13 Namespaces × 360 Keys, 800 `t()`-Aufrufe → 1,5 s Check, 228 MB. Keine Rekursionsgrenze erreicht.
  - Laufzeit: Member-Funktionen der Instanz sind gebunden, `export const t = i18next.t` bleibt nach `init`/`changeLanguage` gültig. `getFixedT(null, 'main')` folgt späteren `changeLanguage`-Aufrufen. Mit Ressourcen ist `init` synchron.
  - Standard-Escaping macht aus `a/b+c` → `a&#x2F;b+c`. Das bricht den SHA-256-Fingerprint im Host-Key-Dialog (Base64 enthält `/`).
- Baseline laut Ledger: 88 Testdateien (87 unter `src/**/*.test.ts` plus `scripts/icons/ico.test.mjs`), 1248 Tests.

---

## 1. Vertrag (zwingend für alle Umsetzer)

### 1.1 Abhängigkeiten und Konfiguration (Task G)

- `package.json` `dependencies`: `"i18next": "26.5.2"`, `"react-i18next": "17.1.0"`. Die Versionen sind exakt gepinnt, weil die Typen über Minor-Versionen variieren. Installiert wird mit `npm install --save-exact i18next@26.5.2 react-i18next@17.1.0`, die Lock-Datei kommt mit.
- `tsconfig.node.json` `compilerOptions`: `"resolveJsonModule": true` ergänzen. `tsconfig.web.json` hat es schon (Zeile 14) und bleibt unverändert.
- `vitest.config.ts` (neu):
  ```ts
  import { defineConfig } from 'vitest/config';

  export default defineConfig({
    test: {
      include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
      setupFiles: ['src/test/setup.ts'],
    },
  });
  ```
  Nach G zeigt `npx vitest run` weiterhin **88 Testdateien**.
- `src/test/setup.ts`:
  - G-Fassung: initialisiert eine eigene i18next-Instanz aus `resources` auf `de-DE`, ruft aber noch keinen Renderer-Code auf.
  - F1-Fassung (endgültig):
    ```ts
    import { i18n } from '../renderer/src/i18n';
    import { setFormatLocale } from '../shared/format';

    await i18n.changeLanguage('de-DE');
    setFormatLocale('de-DE');
    ```
  - Die Datei liegt in keinem tsconfig-`include`. Das ist gewollt.

### 1.2 Kataloge, Index, Typen (Task G; danach unveränderlich)

- Dateien: `src/shared/locales/{de-DE,en-US}/{common,app,vault,connection,terminal,kubernetes,kubeActions,containers,files,assistant,workflows,main}.json` (2 × 12) und `src/shared/locales/{de-DE,en-US}/errors/{ssh,containers,kubernetes,files,ai,core}.json` (2 × 6).
- Skelette:
  - Namespace-Dateien: `{}`.
  - `errors/<area>.json`: `{ "<area>": {} }`.
  - Ausnahmen mit Vorbefüllung (Texte wörtlich in Abschnitt 4): `common.json` (E1) und die Seeds in `errors/core.json`, `errors/containers.json`, `errors/kubernetes.json` (E2).
- `src/shared/locales/index.ts`, wörtliche Form:
  ```ts
  import commonDe from './de-DE/common.json';
  // … one default import per file, names <namespace>De / <namespace>En, errors files as errors<Area>De/En
  export const NAMESPACES = ['common', 'app', 'vault', 'connection', 'terminal', 'kubernetes', 'kubeActions',
    'containers', 'files', 'assistant', 'workflows', 'errors', 'main'] as const;
  export type Namespace = typeof NAMESPACES[number];
  export const resources = {
    'de-DE': { common: commonDe, app: appDe, vault: vaultDe, connection: connectionDe, terminal: terminalDe,
      kubernetes: kubernetesDe, kubeActions: kubeActionsDe, containers: containersDe, files: filesDe,
      assistant: assistantDe, workflows: workflowsDe,
      errors: { ...errorsSshDe, ...errorsContainersDe, ...errorsKubernetesDe, ...errorsFilesDe, ...errorsAiDe, ...errorsCoreDe },
      main: mainDe },
    'en-US': { /* identical shape with …En */ },
  } as const;
  ```
- `src/shared/i18n.d.ts`, wörtlich wie Spec 3.1, mit `import type`:
  ```ts
  import type { resources } from './locales';
  declare module 'i18next' {
    interface CustomTypeOptions { defaultNS: 'common'; resources: (typeof resources)['de-DE']; returnNull: false }
  }
  ```
- Katalog-Regeln:
  - **K-1** Jede Datei ist ein JSON-Objekt aus verschachtelten Objekten mit String-Blättern. Keine Arrays, keine Zahlen, kein `null`.
  - **K-2** `errors/<area>.json` hat genau einen Top-Level-Schlüssel `<area>` und darunter **nur flache Blätter** (`{ "ssh": { "keyFileUnreadable": "…" } }`). Keine Verschachtelung und keine Plural-Keys in `errors`. Wird eine Zahl gebraucht, kommt sie als Parameter in eine neutrale Formulierung.
  - **K-3** Plural nur als `<key>_one` / `<key>_other`, beide Sprachen gleich, `{{count}}` in beiden Formen.
  - **K-4** Wer eine Datei besitzt (Tabelle in Abschnitt 5), schreibt beide Sprachen im selben Task. Andere Dateien fasst er nicht an.

### 1.3 `src/shared/locale.ts` (Task G, + `locale.test.ts`)

```ts
export const SUPPORTED_LOCALES = ['de-DE', 'en-US'] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];
export type LanguageSetting = 'system' | Locale;
export const LANGUAGE_SETTINGS = ['system', 'de-DE', 'en-US'] as const;
export interface LanguageState { setting: LanguageSetting; effective: Locale; system: Locale }
/** Endonyms; never translated. */
export const LOCALE_NAMES: Record<Locale, string> = { 'de-DE': 'Deutsch', 'en-US': 'English' };
export const LOCALE_ARG = '--shellherd-locale=';
export function isLocale(value: unknown): value is Locale;
/** First entry whose base language is supported wins (`de-*` → de-DE, `en-*` → en-US); none → en-US. */
export function systemLocale(preferred: readonly string[]): Locale;
export function resolveLocale(setting: LanguageSetting, preferred: readonly string[]): Locale;
```

Tests:

| Eingabe | Ergebnis |
|---|---|
| `['de-AT','en']` | de-DE |
| `['en']` | en-US |
| `['fr-FR']` | en-US |
| `['fr-FR','de-DE']` | de-DE |
| `[]` | en-US |
| `'de-DE'` fest bei System Englisch | de-DE |
| `isLocale('de')` | `false` |

### 1.4 IPC und `DesktopApi` (Task G: `src/shared/ipc.ts`, `src/preload/index.ts`)

- `IPC_CHANNELS` bekommt: `appGetLanguage: 'app:get-language'`, `appSetLanguage: 'app:set-language'`, `appLocaleChanged: 'app:locale-changed'`.
- `DesktopApi` bekommt (Typen nur über `import type` aus `./locale`):
  ```ts
  /** Effective UI language when the window was created (`--shellherd-locale=`); synchronous for the first frame. */
  initialLocale: Locale;
  /** Any Shellherd window. */
  getLanguage: () => Promise<LanguageState>;
  /** Main window only. */
  setLanguage: (setting: LanguageSetting) => Promise<LanguageState>;
  onLocaleChanged: (listener: (state: LanguageState) => void) => () => void;
  ```
- Preload, im bestehenden Stil mit literalen Kanalnamen und ohne Wert-Import aus `shared`:
  ```ts
  const localeArg = process.argv.find(arg => arg.startsWith('--shellherd-locale='))?.slice('--shellherd-locale='.length);
  // in desktopApi:
  initialLocale: localeArg === 'en-US' ? 'en-US' : 'de-DE',
  getLanguage: () => ipcRenderer.invoke('app:get-language'),
  setLanguage: setting => ipcRenderer.invoke('app:set-language', setting),
  onLocaleChanged: listener => subscribe('app:locale-changed', listener),
  ```

### 1.5 Main: Einstellungen, LocaleStore, Main-i18n (Task F2)

`src/main/app-settings.ts` (kein Electron-Import, + Test):

```ts
export interface AppSettings { language: LanguageSetting }
export const DEFAULT_APP_SETTINGS: AppSettings = { language: 'system' };
/** Sync. Missing, unreadable or non-object file → defaults; an invalid field → its default. */
export function readAppSettings(file: string): AppSettings;
/** Sync, best effort, never throws. Keeps unknown keys; writes `${file}.tmp` then renames. */
export function writeAppSettings(file: string, patch: Partial<AppSettings>): void;
```

- Validiert wird mit zod 4: `z.enum(LANGUAGE_SETTINGS)`.
- Tests: kaputte Datei, fehlende Datei, unbekannte Schlüssel bleiben erhalten, ungültige Sprache → `'system'`.

`src/main/locale.ts` (kein Electron-Import, + Test):

```ts
export interface LocaleStoreOptions { settingsFile: string; systemLanguages: () => readonly string[] }
export class LocaleStore {
  /** Reads settings.json and the system languages once. */
  init(options: LocaleStoreOptions): LanguageState;
  /** Before init: { setting: 'system', effective: 'de-DE', system: 'de-DE' }. */
  get(): LanguageState;
  /** Persists (best effort); notifies only if setting or effective changed. */
  set(setting: LanguageSetting): LanguageState;
  subscribe(listener: (state: LanguageState) => void): () => void;
}
export const localeStore = new LocaleStore();
```

`src/main/i18n.ts` (kein Electron-Import, + Test „mainT folgt setMainLocale“, „Fingerprint mit `/` bleibt unverändert“):

```ts
import { createInstance } from 'i18next';
import mainDe from '../shared/locales/de-DE/main.json';
import mainEn from '../shared/locales/en-US/main.json';
const instance = createInstance();
void instance.init({ resources: { 'de-DE': { main: mainDe }, 'en-US': { main: mainEn } }, lng: 'de-DE',
  fallbackLng: 'de-DE', ns: ['main'], defaultNS: 'main', initAsync: false, load: 'currentOnly',
  interpolation: { escapeValue: false }, returnNull: false });
/** Follows setMainLocale; keys without prefix, e.g. mainT('dialogs.closeApp.title'). */
export const mainT = instance.getFixedT(null, 'main');
export const mainTFor = (locale: Locale) => instance.getFixedT(locale, 'main');
export function setMainLocale(locale: Locale): void;
```

- Main nutzt **nie** die Default-Instanz `i18next`. Renderer und Main laufen in Vitest im selben Prozess.
- Main importiert nie `shared/locales/index.ts` als Wert.

`src/main/index.ts` (F2):

- In `whenReady`, nach `migrateUserData` und vor dem ersten `createWindow`:
  1. `localeStore.init({ settingsFile: join(app.getPath('userData'), 'settings.json'), systemLanguages: () => app.getPreferredSystemLanguages() })`.
  2. `setMainLocale(state.effective)`.
- `createWindow`:
  - `title: mainT(role === 'main' ? 'window.main' : 'window.secondary')`.
  - `webPreferences.additionalArguments: [\`--shellherd-locale=${localeStore.get().effective}\`]`.
  - **neu** `window.on('page-title-updated', event => event.preventDefault())` (Blocker B6).
- Schließen-Dialoge (`index.ts:115-117`, `:145-148`) lesen `mainT('dialogs.…')` beim Öffnen.
- Handler `app:get-language`:
  - Zulässig nur, wenn `windowRegistry.roleOf(event.sender.id)` gesetzt ist und `event.senderFrame === event.sender.mainFrame`. Sonst `throw new AppError('core.invalidRequest')`.
  - Liefert `localeStore.get()`.
- Handler `app:set-language`:
  - Erst `windowRegistry.requireMain(event)`.
  - Dann `z.enum(LANGUAGE_SETTINGS).safeParse(value)`, bei Fehler `throw new AppError('core.invalidRequest')`.
  - Liefert `localeStore.set(parsed)`.
- `localeStore.subscribe(state => …)`:
  - `setMainLocale(state.effective)`.
  - Dann **nur** für `windowRegistry.main()` und `windowRegistry.secondaries()` (nicht `BrowserWindow.getAllWindows()`, das enthält das Drag-Ghost-Fenster): `setTitle(mainT(…))` und `webContents.send(IPC_CHANNELS.appLocaleChanged, state)`, jeweils mit `isDestroyed()`-Prüfung.

### 1.6 Renderer-Kern (Task F1)

`src/renderer/src/i18n.ts`:

```ts
import i18next from 'i18next';
import { initReactI18next, useTranslation, Trans } from 'react-i18next';
import { NAMESPACES, resources } from '../../shared/locales';
import { isLocale, type Locale } from '../../shared/locale';
import { setFormatLocale } from '../../shared/format';

function initialLocale(): Locale {
  const value = typeof window === 'undefined' ? undefined : window.desktopApi?.initialLocale;
  return isLocale(value) ? value : 'de-DE';
}
function applyLocale(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  setFormatLocale(locale);
}
void i18next.use(initReactI18next).init({ resources, lng: initialLocale(), fallbackLng: 'de-DE', load: 'currentOnly',
  defaultNS: 'common', ns: NAMESPACES, initAsync: false, interpolation: { escapeValue: false }, returnNull: false,
  react: { useSuspense: false } });
applyLocale(currentLocale());
i18next.on('languageChanged', language => applyLocale(isLocale(language) ? language : 'de-DE'));

export const i18n = i18next;
/** For logic modules; call inside functions, never at module level. */
export const t = i18next.t;
export function currentLocale(): Locale { return isLocale(i18next.language) ? i18next.language : 'de-DE'; }
/** The only hook components use; allows every `ns:key`. */
export function useT() { return useTranslation(NAMESPACES); }
export { Trans };
```

- **Komponenten nutzen ausschließlich `useT()`**, nie `useTranslation()` direkt (Blocker B2). Logik-Module nutzen `t` aus `./i18n`.
- `main.tsx`:
  - `import { i18n } from './i18n';` ist der erste Projektimport, vor `./App`.
  - Danach `window.desktopApi.onLocaleChanged(state => { void i18n.changeLanguage(state.effective); })`.
  - Zur Selbstheilung nach einem Reload mit veraltetem argv: `void window.desktopApi.getLanguage().then(state => { if (state.effective !== i18n.language) void i18n.changeLanguage(state.effective); }).catch(() => {});`
- `App` und `SecondaryWindow` rufen `useT()` an der Wurzel. Das macht R1 in Welle 3.
- `src/renderer/index.html`: `lang="de"` entfällt (F1, nicht R1). `<title>Shellherd</title>` bleibt.

### 1.7 Fehlercodes `src/shared/errors.ts` (Task F1, + `errors.test.ts`)

```ts
import type { resources } from './locales';

type ErrorCatalog = (typeof resources)['de-DE']['errors'];
export type ErrorArea = keyof ErrorCatalog & string;
/** Exactly `<area>.<key>`; no recursion (catalog rule K-2). */
export type ErrorCode = { [A in ErrorArea]: `${A}.${keyof ErrorCatalog[A] & string}` }[ErrorArea];
export type ErrorParams = Record<string, string | number>;
export interface CodedError { code: ErrorCode; params?: ErrorParams; detail?: string }

export const ERROR_MARK = '§';
export const MAX_DETAIL = 500;
export function truncateDetail(text: string): string;            // > 500 → first 499 chars + '…'
/** `§<code>` or `§<code> {"params":{…},"detail":"…"}`; detail truncated. */
export function encodeError(code: ErrorCode, params?: ErrorParams, detail?: string): string;
/** Accepts an optional `Error invoking remote method '…': ` and an optional `<Name>Error: ` prefix. Foreign text → null. */
export function decodeError(message: string): CodedError | null;
export function isCodedError(value: unknown): value is CodedError;
/** AppError → toCoded(); CodedError → itself; Error/string with decodable message → decoded; else { code: fallback } (never raw text as detail). */
export function codedFrom(error: unknown, fallback: ErrorCode): CodedError;

export class AppError extends Error {
  readonly code: ErrorCode; readonly params?: ErrorParams; readonly detail?: string;
  constructor(code: ErrorCode, params?: ErrorParams, detail?: string);  // super(encodeError(code, params, detail))
  toCoded(): CodedError;
  static from(error: CodedError): AppError;
}
```

- Decode-Regex (verbindlich): `/^(?:Error invoking remote method '[^']*': )?(?:[A-Za-z]*Error: )?§([a-z][A-Za-z0-9]*\.[A-Za-z0-9]+)(?: (\{[\s\S]*\}))?$/`.
- Ungültiges JSON gibt den Code ohne Parameter zurück. Parameterwerte, die nicht `string` oder `number` sind, werden verworfen.
- `AppError` setzt `name` **nicht**. `errors.ts` importiert `locales` **nur** mit `import type`, im Main-Bundle landet kein Katalog.
- Codes sind nicht gegen den Katalog geprüft (Shared hat ihn zur Laufzeit nicht). Das prüft `errorText`.
- Tests:
  - Roundtrip mit und ohne Parameter und Detail.
  - Mit Electron-Präfix und mit `HostAccessError: `-Präfix.
  - Fremdtext → `null`.
  - Detail wird auf 500 Zeichen gekürzt.
  - `codedFrom` mit Fremdfehler → nur `fallback`, kein Detail.

### 1.8 `src/renderer/src/error-text.ts` (Task F1, + Test)

```ts
/** Display text for anything caught or received: CodedError, AppError, IPC-wrapped AppError, foreign Error, string. */
export function errorText(error: unknown, fallback?: string): string;
```

1. Ist `error` ein `CodedError` oder dekodierbar (aus `Error.message` oder String):
   - Text = `i18n.exists(\`errors:${code}\`) ? t(\`errors:${code}\`, params) : t('errors:core.unknown')`.
   - Mit `detail`: `t('common:errorWithDetail', { message: Text, detail })`.
2. `Error` mit nicht dekodierbarer Meldung: Präfix `/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/` entfernen und trimmen. Leer → `fallback ?? t('errors:core.unknown')`, sonst `truncateDetail(Rest)`.
3. Alles andere → `fallback ?? t('errors:core.unknown')`.

`fallback` ist **fertiger Text** (Korrektur zu Spec 3.2 „fallbackKey“). In Welle 2 bleibt dort das vorhandene deutsche Literal stehen, Welle 3 ersetzt es durch `t(…)`.

Die neun Regex-Kopien (`AiSettingsDialog.tsx:17`, `AssistantPanel.tsx:112`, `ClusterForm.tsx:45`, `ConnectionForm.tsx:71`, `TerminalPanel.tsx:164`, `container-tree.ts:86`, `file-browser.ts:101`, `useClusterSession.ts:80`, `useTabTransfer.ts:24`) entfallen in Welle 2. `ipcMessage` (`container-tree.ts:85`) und `ipcErrorText` (`file-browser.ts:100`) behalten ihre Signatur und delegieren an `errorText`.

### 1.9 `src/shared/format.ts` (Task F1, + `format.test.ts`)

```ts
export type DateTimeStyle = 'short' | 'long' | 'time';
export function setFormatLocale(locale: Locale): void;
export function formatLocale(): Locale;                                      // default 'de-DE'
/** short = dateStyle short + timeStyle short; long = dateStyle long; time = timeStyle medium. Invalid → ''. */
export function formatDateTime(value: Date | number | string, style: DateTimeStyle): string;
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
/** Intl.Collator(locale, { numeric: true, sensitivity: 'base' }). */
export function compareText(a: string, b: string): number;
export function foldCase(text: string): string;                              // toLocaleLowerCase(locale)
```

- Die Instanzen werden je Locale (und je Optionen-JSON) gecacht.
- `format.ts` importiert nur `type Locale`.
- Tests für en-US: Node-ICU setzt vor „AM/PM“ ein U+202F. Die Tests vergleichen mit `/\d{1,2}:\d{2}\s?[AP]M/u` oder normalisieren ` ` → Leerzeichen. Sie vergleichen nie mit einer Ausgabe derselben Intl-Instanz.

### 1.10 Main-Fehlerbasis über Bereichsgrenzen (Welle 2, Verträge zwischen M-Tasks)

Diese Signaturen gelten ab Wellenbeginn. Jeder Task stellt seine Aufrufer danach um, auch wenn der Besitzer parallel arbeitet. Das Gate zählt erst am Wellenende.

| Export | Besitzer | Neue Form | Aufrufer in fremden Bereichen |
|---|---|---|---|
| `publicError(error: unknown)` (`main/ssh/session.ts:113`) | M1 | `: CodedError`. `AppError` → `toCoded()`, sonst Abbildung auf `ssh.*`-Codes. Nie Bibliothekstext. | M5 `connection-test.ts:10,99,100,122,127`, M2 `containers/discovery.ts:4`, M4 `files/sftp-session.ts:12`, M3 `kubernetes/access.ts:9,110`, M3 `kubernetes/ipc.ts:12` |
| `SUDO_REJECTED`, `SUDO_NOT_CACHED` (`containers/parsers.ts:49,51`) | M2 | `export const SUDO_REJECTED = 'containers.sudoRejected' as const satisfies ErrorCode;` analog `'containers.sudoNotCached'` (Seeds E2) | M1 `ssh/session.ts:19,232,257,274,306`, M3 `kubernetes/access.ts:3,33` |
| `ContainerInputError` (`containers/commands.ts:6`), `HostAccessError` (`containers/runner.ts:12`) | M2 | `class … extends AppError {}`, Konstruktor `(code, params?, detail?)` geerbt | M1 `ssh/session.ts:17,114,232,257`; M3 `kubernetes/access.ts:2,5,49-73,101,110`, `kubernetes/session.ts:7,76` |
| `KubeInputError` (`kubernetes/kubeconfig.ts:3`) | M3 | `extends AppError` | M3 intern |
| `KubeApiError` (`kubernetes/api.ts:14`) | M3 | **unverändert** `extends Error` mit HTTP-`code?: number`. `message` ist Servertext und darf nur als `detail` weitergereicht werden. | M1 `ssh/session.ts:24,385` → `new LocalShellError('ssh.podTerminalFailed', undefined, error instanceof KubeApiError ? error.message : undefined)` |
| `HostKeyError` (`ssh/known-hosts.ts:17`), `LocalShellError` (`ssh/session.ts:111`) | M1 | `extends AppError` | – |
| `FileError` (`files/file-system.ts:29`), `fileErrorText` | M4 | `FileError extends AppError`; `fileErrorText` → `fileError(error): CodedError` | M4 intern |
| `AiError` (`ai/providers.ts:11`) | M6 | `extends AppError` | M6 intern |
| `parseRequest` (`ssh/validation.ts:12`), `requireSshSender` (`ssh/ipc.ts`), `findConnection` | M1 | Signatur unverändert, wirft `AppError` | M2, M3, M4, M5, M6 nur Aufruf |
| `vaultSessionManager.getSnapshot()` | M5 | wirft `new AppError('core.vaultLocked')` (Seed) | alle |
| `windowRegistry.requireMain` / `whenReady` | M5 | wirft `AppError('core.mainWindowOnly')` (Seed) bzw. eigene `core.*` | alle |

- Fremde Bereichs-Codes dürfen nur über diese Exporte oder die G-Seeds (E2) verwendet werden. Alle übrigen Codes eines Tasks liegen in seiner eigenen `errors/<area>.json`.
- `ipcMain.handle`-Wrapper, die heute Fehler zu `new Error(text)` umbauen (`files/ipc.ts:56`, `ai/ipc.ts:22,27`, `window-ipc.ts:55`, `rdp/ipc.ts:22`, `containers/ipc.ts`), werfen `AppError` unverändert weiter. Fremdfehler werfen sie als `AppError('<area>.…')` ohne Bibliothekstext.

### 1.11 Ereignis- und Ergebnis-Typen (Welle 2)

| Datei (Besitzer) | Alt | Neu |
|---|---|---|
| `shared/ssh.ts:15` (M1) | `message?: string` | `error?: CodedError` |
| `shared/sftp.ts:65` (M4) | Status `message?: string` | `error?: CodedError` |
| `shared/sftp.ts:33,42` `TransferJob` (M4) | `label` (bei mehreren „N Einträge“, `sftp-session.ts:174`), `message?` | `label: string` = Name des ersten Eintrags, **neu** `entryCount: number`, `error?: CodedError` |
| `shared/sftp.ts:61` `EditedFile` (M4) | `message?: string` | `error?: CodedError` |
| `shared/rdp.ts:18` (M5) | `message?: string` | `error?: CodedError`; Text des nativen Helfers nur als `detail` (Entscheidung E14) |
| `shared/kubernetes.ts:111` `KubeProblem` (M3) | `message: string` | `error: CodedError` (Pflicht) |
| `shared/kubernetes.ts:121` `ClusterStatus` (M3) | `message?: string` | `error?: CodedError` |
| `shared/kubernetes.ts:138` `trouble` (M3) | `message?: string` | `error?: CodedError` („fehlt = Störung vorbei“) |
| `shared/ai.ts:22` (M6) | `message: string` | `error: CodedError` |
| `shared/containers.ts:18,73` (M2) | `problems: Partial<Record<…, string>>` | `Partial<Record<…, CodedError>>` |
| `shared/connection-test.ts` (M5) | `{ label; ok; detail? }` | siehe unten |

```ts
export type ConnectionTestStepId = 'clusterTest' | 'startFolder' | 'command' | 'toolFound' | 'programFound' | 'hostGiven'
  | 'nameResolved' | 'portReachable' | 'login' | 'userGiven' | 'hostKey' | 'credentials' | 'sftp';
export interface ConnectionTestStep {
  step: ConnectionTestStepId;
  /** toolFound: { tool } (brand name), portReachable: { port }. */
  params?: Record<string, string | number>;
  ok: boolean;
  /** Raw data only: path, `host → address`, program file. Never prose. */
  detail?: string;
  /** Explanation or failure reason, e.g. core.testNotInstalled { install }, ssh.* from publicError. */
  note?: CodedError;
}
```

Im Renderer: Schrittname `t(STEP_LABEL_KEYS[step.step], step.params)` mit `STEP_LABEL_KEYS: Record<ConnectionTestStepId, 'connection:test.steps.<id>'>`. Darunter `note` über `errorText(step.note)` und `detail` roh.

**Regel W2-Text:** In Welle 2 werden Ereignisse und Ausnahmen **an der Eingangsstelle** in den Renderer-Zustand mit `errorText(…)` zu Text. Der Zustand bleibt `string`, wo er heute `string` ist (z. B. `kube-view.ts` `trouble: string | null`). Offene Meldungen behalten beim Sprachwechsel ihre Sprache, das ist akzeptiert (Konzept 3).

### 1.12 Schlüsselzugriff und Guard

- **Präfix immer:** `t('files:rename.prompt')`. Nie `t('cancel')`.
- **Dynamische Keys** nur über eine Map mit vollen Literalen, z. B. `const GROUP_LABEL_KEYS = { navigation: 'common:commandGroups.navigation', view: 'common:commandGroups.view', actions: 'common:commandGroups.actions' } as const satisfies Record<CommandGroup, string>;` und `t(GROUP_LABEL_KEYS[group])`. Template-Strings mit `${…}` im Key gibt es nur für `` `errors:${code}` `` in `error-text.ts`.
- **`<Trans>`:** `values` tragen nur Zahlen und Texte aus Katalogen, **nie** Nutzer- oder Remote-Daten (Vault-Namen, Pfade, Hostnamen, Servertext). Trans parst den interpolierten String als Markup. Solche Daten stehen außerhalb von `<Trans>` oder in normalem `t()`.
- Guard `src/shared/locales/i18n-catalog.test.ts` (F1), präzisiert:
  - (a) Key-Parität je Namespace über abgeflachte Pfade.
  - (b) Platzhalter-Parität: Die Menge `{{x}}` ist je Key exakt gleich.
  - (c) Keine leeren Strings.
  - (d) Keine verwaisten Keys. Bis zum Sweep `it.skip`. Ein Key gilt als benutzt, wenn in `src/**` (ohne `*.test.ts`, `src/shared/locales/**`, `src/test/**`) als Literal in `'…'`, `"…"` oder `` `…` `` ohne `${` vorkommt:
    - für Namespaces außer `errors` und `main`: `<ns>:<pfad>`, bei Plural `<ns>:<basis>`;
    - für `errors`: `<area>.<key>` (Code) oder `errors:<area>.<key>`;
    - für `main`: `<pfad>` in `src/main/**` oder `main:<pfad>`.
    - Die Blattnamen-Heuristik der Spec entfällt (zu schwach: `title` träfe alles).
  - (e) `errors/<area>.json` hat genau den Schlüssel `<area>` und nur flache String-Blätter.
  - (f) Kein `...`. Kein Wert beginnt mit `Bitte ` bzw. `Please ` (Groß/klein egal). en-US enthält kein `„`, de-DE kein `“` am Wortanfang.
  - (g) Ab dem Sweep scharf, vorher `it.skip`. Geprüft werden Zeilen in `src/{renderer,main,shared}/**/*.{ts,tsx}` ohne `*.test.ts`, `src/shared/locales/**`, `src/test/**`, `src/shared/vault/example.ts` (Testdaten). Kommentarzeilen sind ausgenommen: getrimmt beginnend mit `//`, `*`, `/*`, `{/*`. Treffer:
    - `[äöüÄÖÜß]`;
    - in `.tsx` ein JSX-Textknoten `>\s*[A-Za-zÄÖÜäöüß][^<>{}]*\s[A-Za-zÄÖÜäöüß][^<>{}]*<`.
    - Ausnahme: Die Zeile enthält `i18n-ignore` (`// i18n-ignore` oder `{/* i18n-ignore */}`).

---

## 2. Blocker (mit Fix)

| # | Befund | Beleg | Fix (bindend) |
|---|---|---|---|
| B1 | `initImmediate` gibt es in i18next 26 nicht, die Option heißt `initAsync`. Spec 3.2 und Konzept 2.1 brechen den Typecheck. | Probe: `@ts-expect-error` auf `init({ initImmediate: false })` erfüllt; `node_modules/i18next/typescript/options.d.ts:757` `initAsync?: boolean` | Überall `initAsync: false` (1.5, 1.6) |
| B2 | `useTranslation()` ohne Namespace typisiert nur `defaultNS` ohne Präfix. Regel R5 (immer Präfix) wäre in jeder Komponente ein Typfehler. | Probe TS2345 für `t('errors:ssh.timeout')` und `t('common:sessions')` | `useT()` = `useTranslation(NAMESPACES)` aus `i18n.ts`, Komponenten nutzen nur `useT()` (1.6) |
| B3 | `window.desktopApi?.initialLocale` wirft in Vitest (Node) `ReferenceError: window is not defined`, weil `?.` nur das Objekt absichert, nicht den Bezeichner. `document.documentElement` ebenso. Der Setup lädt `i18n.ts` für alle 88 Testdateien. | Vitest läuft ohne DOM (Konzept 1.2) | `typeof window`/`typeof document`-Prüfung (1.6) |
| B4 | `include: ['src/**/*.test.ts']` (Spec 9) wirft `scripts/icons/ico.test.mjs` aus dem Lauf (88 → 87 Dateien). | Ledger-Baseline 88 Dateien; `find` ergibt 87 unter `src` plus `scripts/icons/ico.test.mjs` | `include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs']` (1.1) |
| B5 | Die Main-Instanz escapt Interpolationen HTML-artig, aus dem SHA-256-Fingerprint im Host-Key-Dialog wird `&#x2F;`. Sicherheitsrelevant: Der Nutzer vergleicht den Fingerprint. | Probe `a/b+c` → `a&#x2F;b+c`; `ssh/ipc.ts:29` | `interpolation: { escapeValue: false }` in `src/main/i18n.ts` und ein Test dazu (1.5) |
| B6 | `<title>Shellherd</title>` (`src/renderer/index.html:6`) überschreibt beim Laden den `BrowserWindow`-Titel (`page-title-updated`). Lokalisierte Fenstertitel wären nie sichtbar. Schon heute zeigt das Nebenfenster „Shellherd“ statt „Shellherd – Sitzungen“ (`index.ts:67`). Abnahme 1 und 2 („Titel richtig“) wären nicht erfüllbar. | kein `page-title-updated`-Handler im Code | F2: `window.on('page-title-updated', e => e.preventDefault())` in `createWindow` (1.5) |
| B7 | Die Typänderungen aus Welle 2 brechen den Typecheck bzw. zeigen `§code` roh in Dateien, die keinem Welle-2-Task gehören. | Typbruch: `kube-view.ts:298` (`event.message`), `kube-menus.ts:457` (`problem.message`), Fixtures `kube-view.test.ts:51-52,376`, `kube-menus.test.ts:33`, `container-tree.test.ts:6,79`, `container-view.test.ts:281`, Anzeige `ContainerTable.tsx:107`, `ContainerView.tsx:243`. Roh-Anzeige von `caught.message` ohne Strip: `ConfirmAction.tsx:56`, `DetailDock.tsx:79`, `App.tsx:391,564,620,724`, `SecondaryWindow.tsx:74`. | Zuordnung in Abschnitt 5, Welle 2 |
| B8 | Bereichsübergreifende Main-Helfer und Fehlerklassen werden von einem Task geändert und von anderen genutzt. Ohne festen Vertrag raten fünf Tasks. | `publicError` in 5 Bereichen, `SUDO_REJECTED` in 3, `HostAccessError`/`ContainerInputError` in 3 (Grep der Main-Importe) | Vertrag 1.10 und Seed-Codes E2 |
| B9 | Plan Welle 1.0: `common.json` bekommt „Bitte warten …“ als `wait`. Das verletzt Guard (f), damit ist das Gate ab Welle 1.1 rot. | Plan Z. 11, Spec 5 (f) | Text „Einen Moment …“ (E1) |
| B10 | Welle 3: Shared-Konstanten wechseln von Label auf Id, ihre Konsumenten liegen in fremden R-Tasks. Ohne Besitzregel schreiben zwei parallele Tasks eine Datei oder einer bricht den anderen. | Konsumenten per Grep: `PROTOCOLS` (`cluster-form.ts`, `connection-form.ts`, `ConnectionForm.tsx:124,162`, `vault-search.ts:10`), `NEW_CONNECTION_KINDS` (`App.tsx:797-798`, `WelcomePage.tsx:3,42`, `VaultTree.tsx:136-137`), `connectionAddress` (`App.tsx`, `ConnectionPicker.tsx`, `TerminalTabs.tsx`, `VaultTree.tsx`, `terminal-layout.ts`, `terminal-tabs.ts`, `vault-search.ts`), `disabledNotice`/`skippedNotice` (`App.tsx`, `SecondaryWindow.tsx`), `KIND_COLUMNS.label` (`kube-copy.ts:7,13`), `ChipDef.label` (`kube-menus.ts:394`), `KUBE_COMMANDS.description` (`HelpOverlay.tsx:29,77`), `CommandGroup` (`container-commands.ts:2,52-59`, `HelpOverlay.tsx:9`, `ContainerHelp.tsx:3,9`), `LOCAL_HOST_NAME` (`App.tsx:666,678`, `LocalContainers.tsx:17`), `READ_ONLY_MESSAGE`/`NOT_CONNECTED_MESSAGE` (`DetailDock.tsx`, `kube-commands.ts`, `kube-menus.ts`, `kube-menus.test.ts:2,182-188`), `aiCliLabel` (`connections.ts:65`) | Konsumenten-Matrix in Abschnitt 5, Welle 3 |
| B11 | Abhängigkeit innerhalb von Welle 1.1: F1 (`main.tsx`, `i18n.ts`) braucht `DesktopApi.initialLocale`/`onLocaleChanged` und `isLocale` von F2. | Plan Z. 23 | `shared/locale.ts`, `shared/ipc.ts`, `preload/index.ts` gehen nach **G** (1.3, 1.4). F1 und F2 sind dann unabhängig. |
| B12 | Guard (g) `[äöüÄÖÜß]` trifft deutsche Kommentare und Testdaten und würde beim Scharfschalten Code-fremde Arbeit erzwingen. | `shared/vault/file-format.ts:9-46`, `shared/vault/types.ts:221-222`, `main/vault/crypto.ts:44-178`, `main/vault/session.ts:50-51`, `shared/vault/example.ts:8-47` | Kommentarzeilen und `example.ts` ausgenommen (1.12 g) |
| B13 | `describe.ts` ist nicht englisch wie kubectl (S11), sondern enthält deutsche Feldnamen. Mit „ohne `describe.ts`“ (Plan M3) bleibt `'Schlüssel:'` (`:164`) und bricht Guard (g). | `describe.ts:91,92,99,130,131,145,158,164` (`Bereit:`, `Neustarts:`, `Umgebung:`, `Art:`, `Erstellt:`, `Typ:`, `Strategie:`, `Schlüssel:`, `ja`/`nein`) | M3 stellt auf kubectl-Englisch um (E15) und passt `describe.test.ts` an |
| B14 | Der Main erzeugt Anzeigetext, der kein Fehler ist. Welle 2 braucht dafür Typen und Renderer-Keys, die Kataloge gehören aber Welle-3-Tasks. | `sftp-session.ts:174` (`${n} Einträge`), `connection-test.ts:48-127` (Schrittnamen), `ai/assistant.ts:99` (`'(leere Antwort)'`), `AiSettingsDialog.tsx:107` | Typen 1.11. Seed-Regel: M4 schreibt nur `files.json` Abschnitt `transfer`, M5 nur `connection.json` Abschnitt `test`, M6 nur `assistant.json` Abschnitt `test` (Texte E5–E7). R8, R3 und R9 übernehmen die Dateien in Welle 3 und behalten diese Keys unverändert. |
| B15 | R10 (Renderer-Tests unverändert) widerspricht Guard (f) und R6 bei Texten, die heute mit „Bitte “ beginnen und in Tests stehen. | `cluster-form.test.ts:43` (`'Bitte gib ei…'`). 38 Literale mit führendem „Bitte “ im Code (Grep), u. a. `connection-form.ts` 8×, `App.tsx` 5× | Diese Texte werden umformuliert („Bitte gib den Namen an.“ → „Gib den Namen an.“). Assertions dürfen genau dafür angepasst werden, mit Nennung im Report. Sonst bleiben alle übernommenen deutschen Texte **zeichengleich** zum heutigen Literal, außer `...` → `…`. |

---

## 3. Korrekturen an Spec und Plan

| # | Stelle | Korrektur |
|---|---|---|
| K1 | Spec 3.2 | `errorText(error, fallback?: string)`. `fallback` ist fertiger Text, kein Key (1.8). |
| K2 | Spec 3.4 | `ErrorCode` ist zweistufig ohne Rekursion (1.7), Kataloge flach (K-2). Kein `Paths<>`-Typ. |
| K3 | Spec 3.4 | Drahtformat-JSON wörtlich `{"params":{…},"detail":"…"}`, Decode-Regex wie in 1.7. |
| K4 | Spec 3.4 | Zusätzlich `codedFrom`, `isCodedError`, `truncateDetail`, `AppError.from`, `toCoded()`. Fremdtext wird im Main **nie** automatisch zu `detail`. |
| K5 | Spec 3.3 | `onLocaleChanged` liefert `LanguageState`, `setLanguage` gibt `Promise<LanguageState>` zurück, `initialLocale: Locale` (1.4). |
| K6 | Spec 3.3 | `app:get-language` ist für jedes registrierte Fenster erlaubt (Selbstheilung im Nebenfenster), `set-language` nur fürs Hauptfenster. |
| K7 | Spec 3.3 | `resolveLocale` wertet die Liste der Reihe nach aus (1.3), nicht nur den ersten Eintrag. |
| K8 | Spec 3.3 | Broadcast nur an `windowRegistry.main()`/`secondaries()` (1.5). |
| K9 | Spec 3.3, Plan F2 | `LocaleStore` als Singleton `localeStore`, `init()` in `index.ts`. Damit kommt M6 ohne Eingriff in `index.ts` an die Sprache. |
| K10 | Spec 3.2 | `load: 'currentOnly'`, `react: { useSuspense: false }`, `currentLocale()`, `useT()`. `main.tsx` heilt sich per `getLanguage()` selbst (1.6). |
| K11 | Spec 3.2, Plan R1 | `index.html` (`lang` entfernen) geht an **F1**, nicht an R1. |
| K12 | Plan F1 | `src/renderer/src/global.d.ts` bleibt unverändert und fällt aus F1 heraus. F1 bekommt zusätzlich `src/renderer/src/i18n.test.ts` (Umschalten en-US, Fallback auf de-DE bei fehlendem Key, Plural `common:count.sessions` 1/2 in beiden Sprachen, `afterEach` stellt de-DE wieder her). |
| K13 | Plan G | G übernimmt zusätzlich `src/shared/locale.ts` + Test, `src/shared/ipc.ts` (nur Kanäle und `DesktopApi`), `src/preload/index.ts` (B11). F2 fasst diese drei Dateien nicht an. |
| K14 | Plan M4 | `hooks/useTabTransfer.ts` geht in Welle 2 an **M5** (Fehler aus `tabs:transfer` in `window-ipc.ts`), nicht an M4. |
| K15 | Plan M3 | M3 bekommt zusätzlich `kubernetes/describe.ts` + Test (B13), `shared/kubernetes-schema.ts:27` und die Konsumenten aus B7. `log-format.ts` bleibt unberührt. |
| K16 | Plan M5 | `shared/windows.ts` fällt heraus (kein Text). Dazu kommt `shared/vault/schema.ts:90`. Zod-`message`-Texte werden nie angezeigt (`connection-form.ts:151-152`, `index.ts:208-209` werfen eigene Texte), deshalb bekommen sie englische Bezeichner ohne Katalog: `'commandRequired'`, in M3 `'tooManyColumnFilters'`, in R7 `'invalidRef'`. |
| K17 | Plan M5 | Entschlüsselungsfehler (`main/vault/crypto.ts`, `vault/session.ts`) werfen `AppError('core.wrongPassword')`. Grund: `App.tsx:100-111` (`getErrorMessage`) erkennt heute nur `authenticate`/`Unsupported state` und entfällt. |
| K18 | Plan R9 → R2 | `shared/ai-cli.ts` geht an **R2**. Einziger Textkonsument ist `connectionAddress`. `AI_CLI_TOOLS.label` bleibt (Marken). `aiCliLabel` liefert `string \| null` (`null` = eigener Befehl ohne Text). |
| K19 | Plan R4 | `hooks/useTerminalLayout.ts:34` („Ansicht 1“) fehlte und geht an R4. |
| K20 | Plan R1/R2 | `vault-notices.ts` gehört **R1** (einziger Konsument), Keys `app:notices.*`. R2 löscht nur die Shared-Funktionen. |
| K21 | Plan, Verträge Welle 3 | `connection:kinds.<protocol>` (R3) entfällt. Protokoll-Labels kommen aus `vault:protocols.<id>.label|short` über `src/renderer/src/connection-labels.ts` (R2). `kubeActions:groups.*` und `containers:groups.*` entfallen zugunsten `common:commandGroups.*` (G). `containers:localHost` entfällt zugunsten `common:thisComputer` (G). |
| K22 | Spec 3.7 | `LanguageSetting` rendert `<label className="file-type-setting language-setting">` und nutzt so die vorhandene Regel (`styles.css:117`). R1 darf genau eine Regel `.language-setting select { width: auto; }` ergänzen, weil `select` sonst `width: 100%` erbt (`styles.css:15`). Weitere CSS-Werte und Tokens kommen nicht dazu. `design-tokens.test.ts` muss grün bleiben. |
| K23 | Spec 3.6, R8 | `compareText` ist numerisch mit `sensitivity: 'base'`. Das kann die Reihenfolge gegenüber nacktem `localeCompare` ändern (`kube-columns.ts:148,171,246`, `container-columns.ts:196,241`, `kube-view.ts:499`, `container-view.ts:315`). Bricht dadurch eine Sortier-Assertion, darf sie mit Begründung im Report angepasst werden. |
| K24 | Plan D1/R1 | `ReleaseNotes.tsx:7` (Datum) ersetzt D1 in Welle 4. R1 ändert dort nur Texte. |

---

## 4. Entscheidungen mit wörtlichen Texten

**E1 `common.json` (G).** de-DE / en-US:

| Key | de-DE | en-US |
|---|---|---|
| `actions.cancel` | Abbrechen | Cancel |
| `actions.close` | Schließen | Close |
| `actions.save` | Speichern | Save |
| `actions.delete` | Löschen | Delete |
| `actions.remove` | Entfernen | Remove |
| `actions.rename` | Umbenennen | Rename |
| `actions.copy` | Kopieren | Copy |
| `actions.connect` | Verbinden | Connect |
| `actions.disconnect` | Trennen | Disconnect |
| `actions.retry` | Erneut versuchen | Try again |
| `actions.open` | Öffnen | Open |
| `actions.edit` | Bearbeiten | Edit |
| `actions.reload` | Neu laden | Reload |
| `status.connecting` | Verbindet … | Connecting… |
| `status.connected` | Verbunden | Connected |
| `status.closed` | Verbindung beendet | Connection closed |
| `status.failed` | Verbindung fehlgeschlagen | Connection failed |
| `status.saving` | Speichert … | Saving… |
| `wait` | Einen Moment … | One moment… |
| `truncated` | (gekürzt) | (truncated) |
| `none` | keine | none |
| `planned` | geplant | planned |
| `thisComputer` | Dieser Computer | This computer |
| `errorWithDetail` | {{message}} Details: {{detail}} | {{message}} Details: {{detail}} |
| `count.sessions_one/_other` | {{count}} Sitzung / {{count}} Sitzungen | {{count}} session / {{count}} sessions |
| `count.tabs_one/_other` | {{count}} Tab / {{count}} Tabs | {{count}} tab / {{count}} tabs |
| `count.views_one/_other` | {{count}} Ansicht / {{count}} Ansichten | {{count}} view / {{count}} views |
| `count.connections_one/_other` | {{count}} Verbindung / {{count}} Verbindungen | {{count}} connection / {{count}} connections |
| `count.windows_one/_other` | {{count}} Fenster / {{count}} Fenster | {{count}} window / {{count}} windows |
| `keys.ctrl` | Strg | Ctrl |
| `keys.shift` | Umschalt | Shift |
| `keys.alt` | Alt | Alt |
| `keys.space` | Leertaste | Space |
| `keys.del` | Entf | Del |
| `shortcuts.palette` | Strg+Umschalt+Leertaste | Ctrl+Shift+Space |
| `shortcuts.assistant` | Strg+Umschalt+K | Ctrl+Shift+K |
| `commandGroups.navigation` | Navigation | Navigation |
| `commandGroups.view` | Ansicht | View |
| `commandGroups.actions` | Aktionen | Actions |

Typografie: de-DE schreibt Leerzeichen vor `…`, en-US nicht. Der Sweep entfernt am Ende Keys, die niemand nutzt (Guard d).

**E2 Seed-Codes (G).** Die Besitzer behalten die Texte zeichengleich:

| Code | de-DE | en-US |
|---|---|---|
| `core.unknown` | Ein unerwarteter Fehler ist aufgetreten. | An unexpected error occurred. |
| `core.invalidRequest` | Die Anfrage ist ungültig. | The request is invalid. |
| `core.vaultLocked` | Es ist kein Vault entsperrt. | No vault is unlocked. |
| `core.mainWindowOnly` | Diese Aktion ist nur im Hauptfenster erlaubt. | This action is only allowed in the main window. |
| `containers.sudoRejected` | Das sudo-Passwort wurde abgelehnt. | The sudo password was rejected. |
| `containers.sudoNotCached` | sudo speichert die Anmeldung nicht zwischen (timestamp_timeout=0). Richte NOPASSWD ein. | sudo does not cache the login (timestamp_timeout=0). Set up NOPASSWD. |
| `kubernetes.readOnly` | Dieser Cluster ist schreibgeschützt. | This cluster is read-only. |
| `kubernetes.notConnected` | Der Cluster ist gerade nicht verbunden. | The cluster is not connected right now. |

**E3 `main.json` (F2, ohne `assistant`).** Die Keys werden ohne Präfix über `mainT` gelesen:

| Key | de-DE | en-US |
|---|---|---|
| `window.main` | Shellherd | Shellherd |
| `window.secondary` | Shellherd – Sitzungen | Shellherd – Sessions |
| `dialogs.cancel` | Abbrechen | Cancel |
| `dialogs.closeApp.title` | Shellherd schließen | Quit Shellherd |
| `dialogs.closeApp.message` | Alle aktiven Verbindungen in allen Fenstern trennen und Shellherd schließen? | Disconnect all active connections in all windows and quit Shellherd? |
| `dialogs.closeApp.confirm` | Trennen und schließen | Disconnect and quit |
| `dialogs.closeWindow.title` | Fenster schließen | Close window |
| `dialogs.closeWindow.message` | Alle Verbindungen in diesem Fenster trennen und das Fenster schließen? | Disconnect all connections in this window and close it? |
| `dialogs.closeWindow.detail` | Tabs, die du behalten willst, ziehst du vorher in ein anderes Fenster. | Drag tabs you want to keep into another window first. |
| `dialogs.closeWindow.confirm` | Trennen und schließen | Disconnect and close |
| `dialogs.hostKey.title` | Unbekannter SSH-Server | Unknown SSH server |
| `dialogs.hostKey.message` | Server-Schlüssel für {{host}}:{{port}} prüfen | Check the server key for {{host}}:{{port}} |
| `dialogs.hostKey.detail` | SHA-256-Fingerprint:\n{{fingerprint}}\n\nVergleiche diesen Fingerprint mit einer vertrauenswürdigen Quelle. Bei Bestätigung wird dieser Server-Schlüssel für künftige Verbindungen gespeichert. | SHA-256 fingerprint:\n{{fingerprint}}\n\nCompare this fingerprint with a trusted source. If you confirm, this server key is saved for future connections. |
| `dialogs.hostKey.confirm` | Schlüssel vertrauen und speichern | Trust and save key |
| `dialogs.privateKey.title` | Privaten SSH-Schlüssel auswählen | Select private SSH key |
| `dialogs.vaultSave.title` | Shellherd-Vault speichern | Save Shellherd vault |
| `dialogs.vaultOpen.title` | Shellherd-Vault auswählen | Select Shellherd vault |
| `dialogs.vaultFilter` | Shellherd Vault | Shellherd Vault |

Die Verdrahtung macht M1 (`ssh/ipc.ts:24-31`) bzw. M5 (`vault/ipc.ts:54,75,79,120,126`).

**E4 `main.json` Abschnitt `assistant` (M6).**

- Keys `assistant.shells.{ssh,powershell,cmd}` und die Prompt-Zeilen `assistant.prompt.{intro,data,brevity,command,explain,goal,afterOutput,danger,question}`. Die Reihenfolge entspricht `assistant.ts:19-27`.
- `intro` mit `{{shell}}` und `{{target}}`. Gelesen wird in `systemPrompt(context, locale)` über `mainTFor(locale)` und eine `as const`-Liste der Zeilen-Keys.
- de-DE bleibt zeichengleich zum heutigen Prompt.
- en-US ist nativ formuliert. `brevity` lautet wörtlich: „Answer in English, as briefly as possible: usually one sentence plus a command, no introduction.“ `danger` lautet: „Deleting, overwriting, stopping, restarting: start with “Warning:” and the risk.“
- Verbindungstest: `assistant.test.system` = „Antworte nur mit dem Wort OK.“ / „Reply with the word OK only.“ und `assistant.test.user` = „Verbindungstest“ / „Connection test“.
- Die Sprache kommt aus `localeStore.get().effective`.
- `test()` gibt bei leerer Antwort `''` zurück, nicht mehr `'(leere Antwort)'`.

**E5 `files.json` Abschnitt `transfer` (M4):** `transfer.entries_one` = „{{count}} Eintrag“ / „{{count}} entry“, `transfer.entries_other` = „{{count}} Einträge“ / „{{count}} entries“.

**E6 `connection.json` Abschnitt `test.steps` (M5):**

| Schritt | de-DE | en-US |
|---|---|---|
| `clusterTest` | Verbindungstest | Connection test |
| `startFolder` | Startordner vorhanden | Start folder exists |
| `command` | Befehl | Command |
| `toolFound` | {{tool}} gefunden | {{tool}} found |
| `programFound` | Programm gefunden | Program found |
| `hostGiven` | Host angegeben | Host specified |
| `nameResolved` | Name aufgelöst | Name resolved |
| `portReachable` | Port {{port}} erreichbar | Port {{port}} reachable |
| `login` | Anmeldung | Sign-in |
| `userGiven` | Benutzer angegeben | User specified |
| `hostKey` | Server-Schlüssel geprüft | Server key verified |
| `credentials` | Anmeldedaten gelesen | Credentials read |
| `sftp` | SFTP verfügbar | SFTP available |

Die Erklärtexte (`connection-test.ts:38-41,48,52,54,57,65,73,76,107,110,120`) werden `core.test*`-Codes in `errors/core.json`. Führendes „Bitte “ entfällt (B15). Beispiel: „Bitte gib einen Host ein.“ → `core.testHostMissing` „Gib einen Host ein.“ / „Enter a host.“

**E7 `assistant.json` Abschnitt `test` (M6):** `test.ok` = „Verbindung steht. Antwort: {{answer}}“ / „Connected. Answer: {{answer}}“, `test.emptyAnswer` = „(leere Antwort)“ / „(empty answer)“.

**E8 Sprache-Einstellung (R1, `app.json`):**

| Key | de-DE | en-US |
|---|---|---|
| `language.label` | Sprache | Language |
| `language.aria` | Sprache der Oberfläche | Interface language |
| `language.system` | System ({{language}}) | System ({{language}}) |

`{{language}}` = `LOCALE_NAMES[state.system]`. Die Optionen `de-DE`/`en-US` zeigen `LOCALE_NAMES` direkt ohne `t()`. Die Komponente steht nur im Hauptfenster.

**E9 Neue Renderer-Module für Labels (Welle 3), feste Signaturen:**

- `src/renderer/src/connection-labels.ts` (R2, Keys `vault:protocols.<id>.label|short`, `vault:address.*`):
  - `protocolLabel(protocol: ConnectionProtocol | 'ftp'): string`
  - `protocolShort(protocol: ConnectionProtocol): string`
  - `connectionAddress(node: ConnectionNode): string` (Plural „Zugang/Zugänge“ über `_one/_other`)
- `src/renderer/src/vault-notices.ts` (R1, Keys `app:notices.*`): `disabledNotice(node: ConnectionNode): string`, `skippedNotice(count: number): string`, `sessionLimitNotice(): string`.
- `src/renderer/src/kube-labels.ts` (R5, Keys `kubernetes:columns.<key>`, `kubernetes:chips.<id>`): `columnLabel(key: string): string`, `chipLabel(id: string): string`. Unbekannte Werte geben den Rohwert zurück, über Maps nach 1.12.
- `kube-commands.ts` (R6): `export type CommandGroup = 'navigation' | 'view' | 'actions';`, `KubeCommand` verliert `description`, neu `export function commandDescription(command: KubeCommand): string` (Keys `kubeActions:commands.<id>`).

**E10 Unverändert bleiben (Marken, Kubernetes- und Laufzeitnamen):** `KIND_INFO.label` (`shared/kubernetes.ts:15-26`), `RUNTIME_LABEL` (`shared/containers.ts:123`), `containerViewTabName`/`CONTAINER_VIEW_SUFFIX` („Container“ gilt in beiden Sprachen), `AI_CLI_TOOLS.label`. Main-Code (`kubernetes/actions.ts`, `client-api.ts`, `rows.ts`) muss dafür nicht angefasst werden.

**E11 Anzeige-Konstanten mit Label verlieren das Feld:**

- `ProtocolInfo.label`/`.short`, `NEW_CONNECTION_KINDS[].label` (R2).
- `ColumnInfo.label`, `READ_ONLY_MESSAGE`, `NOT_CONNECTED_MESSAGE` (R5). Konsumenten schreiben `t('errors:kubernetes.readOnly')` bzw. `t('errors:kubernetes.notConnected')`.
- `ChipDef.label` (R5).
- `LOCAL_HOST_NAME` (R7). Konsumenten schreiben `t('common:thisComputer')`.
- `disabledNotice`/`skippedNotice`/`connectionAddress` in `shared/vault/connections.ts` (R2 löscht).

**E12 Namen, die zu Daten werden** (Tab- und Ansichtsnamen wie „Dieser Computer · Docker“, „Ansicht 1“), entstehen in der Sprache zum Zeitpunkt des Anlegens und werden beim Umschalten nicht umbenannt.

**E13 Shortcuts in Hilfe-Overlays** (`Shift+F10`, `Enter`, `Esc`, `⌫`, `1–9`) bleiben wie heute in beiden Sprachen. Nur die Wörter aus `common:keys.*` werden übersetzt.

**E14 Texte des nativen RDP-Helfers** (`native/Shellherd.RdpHost/*.cs`, deutsch) werden in v1 nicht übersetzt. Sie kommen nur als `detail` eines `core.rdp*`-Codes an. Der Ordner `native/` liegt außerhalb von Guard (g).

**E15 `describe.ts` wird kubectl-Englisch (M3):**

| Alt | Neu |
|---|---|
| `Bereit:` | `Ready:` |
| `Neustarts:` | `Restart Count:` |
| `Umgebung:` | `Environment:` |
| `Art:` | `Kind:` |
| `Erstellt:` | `Creation Timestamp:` |
| `Typ:` | `Type:` |
| `Strategie:` | `Strategy:` |
| `Schlüssel:` | `Keys:` |
| `ja`/`nein` | `True`/`False` |

Die Ausgabe ist in beiden UI-Sprachen gleich.

**E16 Version und Release:** 0.11.0 (S15) bleibt. `scripts/release-notes.mjs` gibt `## English\n\n<en>\n\n## Deutsch\n\n<de>\n` aus. `check-version.mjs` verlangt den neuesten Abschnitt in **beiden** Dateien. Die Meldungen des Skripts bleiben deutsch, weil `scripts/` außerhalb des Guards liegt.

---

## 5. Wellen final (Dateibesitz, keine Überschneidung innerhalb einer Welle)

Grundsätze:

- Jede Datei hat je Welle genau einen Besitzer. „+ Test“ heißt: die gleichnamige `*.test.ts` gehört dazu.
- Ein Task darf nur in seinen Dateien und Katalogen schreiben. Ändert sich der Vertrag einer fremden Datei, stellt er nur seine eigenen Aufrufer um, laut Vertrag dieses Anhangs. Typfehler in fremden Dateien während der Welle ignoriert er, das Gate zählt am Wellenende.
- Report je Task unter `.superpowers/sdd/2026-10-19-i18n/reports/<task>.md` mit: geänderten Dateien, geänderten Test-Assertions plus Grund (nur nach B15 oder K23 zulässig) und neuen Codes.

### Welle 1.0 – G (1 Task)

| Task | Dateien | Kataloge |
|---|---|---|
| G | `package.json`, `package-lock.json`, `tsconfig.node.json`, `vitest.config.ts` (neu), `src/test/setup.ts` (neu), `src/shared/locales/index.ts` (neu), `src/shared/i18n.d.ts` (neu), `src/shared/locale.ts` + Test (neu), `src/shared/ipc.ts`, `src/preload/index.ts` | alle 24 + 12 Dateien als Skelett; `common.json` (E1) und Seeds (E2) gefüllt |

### Welle 1.1 – Fundament (3 Tasks parallel)

| Task | Dateien | Kataloge |
|---|---|---|
| F1 | `src/renderer/src/i18n.ts` + `i18n.test.ts` (neu), `src/renderer/src/main.tsx`, `src/renderer/index.html`, `src/shared/format.ts` + Test, `src/shared/errors.ts` + Test, `src/renderer/src/error-text.ts` + Test, `src/shared/locales/i18n-catalog.test.ts` (a, b, c, e, f aktiv; d, g als `it.skip`), `src/test/setup.ts` | keine |
| F2 | `src/main/app-settings.ts` + Test, `src/main/locale.ts` + Test, `src/main/i18n.ts` + Test, `src/main/index.ts` | `main.json` ×2 (E3) |
| F3 | `electron-builder.yml` (`nsis.multiLanguageInstaller: true`, `installerLanguages: [de_DE, en_US]`, `displayLanguageSelector: false`; Optionen in `app-builder-lib/out/targets/nsis/nsisOptions.d.ts:209-221` vorhanden) | keine |

### Welle 2 – Main (6 Tasks parallel)

Jeder Task stellt seine `throw`-Stellen auf `AppError`/Unterklassen um und seine Ereignisse auf 1.11, passt seine Main-Tests auf `.code`/`toMatchObject({ code })` an und schreibt seine `errors/<area>.json` in beiden Sprachen. Deutsche Texte bleiben zeichengleich zum heutigen Literal (B15). In den Renderer-Dateien ändert er **nur** die genannten Stellen und lässt die deutschen Fallback-Literale stehen.

| Task | Main / Shared | Renderer (nur diese Stellen) | Kataloge |
|---|---|---|---|
| M1 SSH | `src/main/ssh/*.ts` + alle Tests in `src/main/ssh/`, `src/shared/ssh.ts` | `components/TerminalPanel.tsx:109,164` | `errors/ssh.json` ×2 |
| M2 Container | `src/main/containers/*.ts` + Tests, `src/shared/containers.ts` (nur `problems`-Typen und Kommentare `:17,:72`) | `container-tree.ts:61,85-87` + `container-tree.test.ts` (Fixtures `:6,:79`), `container-view.test.ts:281` (Fixture), `components/containers/ContainerTable.tsx:107`, `components/containers/ContainerView.tsx:243` | `errors/containers.json` ×2 |
| M3 Kubernetes | `src/main/kubernetes/*.ts` + Tests (inkl. `describe.ts` E15; `log-format.ts` unberührt), `src/shared/kubernetes.ts` (nur `KubeProblem`, `ClusterStatus`, `KubeEvent.trouble`), `src/shared/kubernetes-schema.ts:27` | `hooks/useClusterSession.ts:33-36,55-57,79-82` (`codedFrom(caught, 'kubernetes.viewOpenFailed')`), `components/kubernetes/ClusterView.tsx:301`, `ProblemBanner.tsx:22,36`, `ConfirmAction.tsx:56`, `DetailDock.tsx:79`, `kube-view.ts:298` + `kube-view.test.ts:51-52,376`, `kube-menus.ts:457` + `kube-menus.test.ts:33` | `errors/kubernetes.json` ×2 |
| M4 Dateien | `src/main/files/*.ts` + Tests, `src/shared/sftp.ts` | `file-browser.ts:99-102` (+ Test nur falls nötig), `components/FilesPanel.tsx:108,256,280` und die Anzeige von `job.label`/`entryCount` | `errors/files.json` ×2, `files.json` ×2 nur `transfer.*` (E5) |
| M5 Kern | `src/main/index.ts` (nur `:209,:220`), `window-ipc.ts`, `windows.ts`, `src/main/vault/*.ts` + Tests, `file-association.ts` + Test, `connection-test.ts` + Test, `src/main/rdp/*.ts`; `src/shared/rdp.ts`, `src/shared/connection-test.ts`, `src/shared/vault/{migrations,mutations,consistency,schema}.ts` + Tests | `App.tsx` (`getErrorMessage` `:100-111` entfällt; `:331,:368,:391,:459,:564,:620,:724` → `errorText`), `SecondaryWindow.tsx:74`, `hooks/useTabTransfer.ts:23-24`, `components/RdpPanel.tsx:65,89`, `components/ConnectionForm.tsx:71,198-199`, `components/ClusterForm.tsx:45` | `errors/core.json` ×2, `connection.json` ×2 nur `test.*` (E6) |
| M6 KI | `src/main/ai/*.ts` + Tests, `src/shared/ai.ts` (nur `AiEvent`) | `components/AssistantPanel.tsx:112,129`, `components/AiSettingsDialog.tsx:16-17,107-108` | `errors/ai.json` ×2, `main.json` ×2 nur `assistant.*` (E4), `assistant.json` ×2 nur `test.*` (E7) |

Überschneidungsprüfung Welle 2:

- Renderer-Dateien: `TerminalPanel` (M1), `container-tree`/`ContainerTable`/`ContainerView` (M2), `useClusterSession`/`ClusterView`/`ProblemBanner`/`ConfirmAction`/`DetailDock`/`kube-view`/`kube-menus` (M3), `file-browser`/`FilesPanel` (M4), `App`/`SecondaryWindow`/`useTabTransfer`/`RdpPanel`/`ConnectionForm`/`ClusterForm` (M5), `AssistantPanel`/`AiSettingsDialog` (M6). Alle disjunkt.
- Kataloge: `main.json` schreibt in Welle 2 nur M6. `connection.json`, `files.json` und `assistant.json` haben je einen Seeder.
- `main/index.ts` schreibt nur M5. F2 ist in Welle 1.1 fertig.

### Welle 3 – Renderer (10 Tasks parallel)

| Task | Dateien | Katalog |
|---|---|---|
| R1 App | `App.tsx`, `SecondaryWindow.tsx`, `components/WelcomePage.tsx`, `components/LanguageSetting.tsx` (neu), `components/Toast.tsx`, `components/ConfirmDialog.tsx`, `components/ContextMenu.tsx`, `components/ResizableSidebar.tsx`, `components/ConnectionIcon.tsx`, `components/ReleaseNotes.tsx` (nur Texte), `hooks/useTabTransfer.ts`, `vault-notices.ts` + Test (neu), `styles.css` (nur K22) | `app.json` |
| R2 Vault | `components/VaultTree.tsx`, `components/FolderEditor.tsx`, `components/WorkspaceControls.tsx`, `components/ConnectionPicker.tsx`, `vault-search.ts` + Test, `vault-selection.ts` + Test, `connection-labels.ts` + Test (neu), `src/shared/vault/connections.ts` + Test, `src/shared/ai-cli.ts` | `vault.json` |
| R3 Verbindung | `components/ConnectionForm.tsx`, `components/ClusterForm.tsx`, `connection-form.ts` + Test, `cluster-form.ts` + Test | `connection.json` (`test.*` bleibt) |
| R4 Terminal | `components/SplitTerminalArea.tsx`, `components/TerminalPanel.tsx`, `components/TerminalTabs.tsx`, `components/RdpPanel.tsx`, `rdp-sessions.ts`, `terminal-input.ts`, `terminal-layout.ts` + Test, `terminal-tabs.ts` + Test, `terminal-views.ts` + Test, `hooks/useViewControls.ts`, `hooks/useTerminalLayout.ts` | `terminal.json` |
| R5 Kube-Ansicht | `components/kubernetes/{ClusterView,DetailDock,HelpOverlay,NodeStrip,ProblemBanner,ResourceTable}.tsx`, `kube-view.ts` + Test, `kube-columns.ts` + Test, `kube-labels.ts` (neu, + Test), `hooks/useClusterSession.ts`, `src/shared/kubernetes.ts`, `src/shared/kube-status.ts` + Test, `src/shared/kube-filter.ts` + Test | `kubernetes.json` |
| R6 Kube-Aktionen | `kube-menus.ts` + Test, `kube-commands.ts` + Test, `confirm-action.ts` + Test, `components/kubernetes/ConfirmAction.tsx`, `kube-copy.ts` + Test, `kube-kubectl.ts` + Test, `kube-ssh.ts` + Test, `kube-menu-run.ts` + Test, `kube-menu-trigger.ts` + Test | `kubeActions.json` |
| R7 Container | `container-{columns,commands,confirm,menu-run,menus,status,tree,view}.ts` + Tests, `components/containers/{ContainerConfirm,ContainerDock,ContainerHelp,ContainerTable,ContainerView}.tsx`, `components/ContainerChildren.tsx`, `components/LocalContainers.tsx`, `hooks/useContainerDiscovery.ts`, `hooks/useContainerInventory.ts`, `inventory-scheduler.ts` + Test, `src/shared/containers.ts` + Test, `src/shared/containers-schema.ts` + Test | `containers.json` |
| R8 Dateien | `components/FilesPanel.tsx`, `components/FilePane.tsx`, `components/PermissionsDialog.tsx`, `file-browser.ts` + Test | `files.json` (`transfer.*` bleibt) |
| R9 Assistent | `components/AssistantPanel.tsx`, `components/AiSettingsDialog.tsx`, `assistant-chat.ts` + Test, `hooks/useAssistantToggle.ts`, `src/shared/ai.ts` | `assistant.json` (`test.*` bleibt) |
| R10 Workflows | `components/WorkflowsDialog.tsx`, `components/WorkflowPalette.tsx`, `workflows.ts` + Test | `workflows.json` |

Alle Pfade ohne Präfix liegen unter `src/renderer/src/`. Ohne Text und ohne Besitzer: `native-surface.ts`, `session-registry.ts`, `toast-state.ts`, `terminal-access.ts`, `terminal-theme.ts`, `hooks/useShortcut.ts`, `hooks/useTerminalTabs.ts`. `release-notes.ts` gehört D1.

**Konsumenten-Matrix Welle 3** (wer stellt welche fremde Konstante in **seiner** Datei um):

| Konstante (Besitzer) | Änderung | Umstellung durch Datei-Besitzer |
|---|---|---|
| `PROTOCOLS.label/.short` (R2) | entfallen → `protocolLabel`/`protocolShort` aus `connection-labels.ts` | R3: `ConnectionForm.tsx:124,162`; R2: `vault-search.ts:10` |
| `NEW_CONNECTION_KINDS[].label` (R2) | entfällt → `protocolLabel(kind.protocol)` | R1: `App.tsx:797-798`, `WelcomePage.tsx:42`; R2: `VaultTree.tsx:136-137` |
| `connectionAddress` (R2) | zieht von `shared/vault/connections.ts` nach `connection-labels.ts` | R1: `App.tsx`; R4: `TerminalTabs.tsx`, `terminal-layout.ts`, `terminal-tabs.ts` (nur Importpfad); R2: `ConnectionPicker.tsx`, `VaultTree.tsx`, `vault-search.ts` |
| `disabledNotice`/`skippedNotice` (R2 löscht) | neu in `vault-notices.ts` (R1) | R1: `App.tsx`, `SecondaryWindow.tsx` |
| `aiCliLabel` (R2) | liefert `string \| null` | nur R2 (`connection-labels.ts`) |
| `KIND_COLUMNS[].label` (R5) | entfällt → `columnLabel(key)` | R6: `kube-copy.ts:13`; R5: eigene Dateien |
| `ChipDef.label` (R5) | entfällt → `chipLabel(id)` | R6: `kube-menus.ts:394`; R5: eigene Dateien |
| `READ_ONLY_MESSAGE`/`NOT_CONNECTED_MESSAGE` (R5 löscht) | → `t('errors:kubernetes.readOnly'/'notConnected')` | R6: `kube-commands.ts`, `kube-menus.ts`, `kube-menus.test.ts:2,182-188`; R5: `DetailDock.tsx` |
| `KubeCommand.description` (R6) | entfällt → `commandDescription(command)` | R5: `HelpOverlay.tsx:29,77` |
| `CommandGroup` (R6) | Ids `navigation`/`view`/`actions`, Label `common:commandGroups.*` | R5: `HelpOverlay.tsx:9,70`; R7: `container-commands.ts:52-60` und folgende, `ContainerHelp.tsx:9` und Überschrift |
| `LOCAL_HOST_NAME` (R7 löscht) | → `t('common:thisComputer')` | R1: `App.tsx:666,678`; R7: `LocalContainers.tsx:17` |
| `AI_PROVIDER_KINDS` (R9) | `label`/`hint` → `assistant:providers.<kind>.label|hint` | nur R9 (`AiSettingsDialog.tsx`) |
| `workspaceSummary` (R4), `copiedMessage` (R6) u. a. Logik-Funktionen | Signatur bleibt, Text intern über `t()` | keine |

Keine zwei Tasks schreiben in Welle 3 dieselbe Datei. `HelpOverlay.tsx` gehört R5, `ContainerHelp.tsx` R7, `kube-commands.ts` R6.

### Welle 4 – Doku und Release-Notes (3 Tasks parallel)

| Task | Dateien |
|---|---|
| D1 | `CHANGELOG.en.md` (neu, alle Versionen inkl. 0.11.0), `scripts/release-notes.mjs`, `scripts/check-version.mjs`, `src/renderer/src/release-notes.ts` (`releasesFor(locale: Locale): ReleaseNotes[]`), `components/ReleaseNotes.tsx` (Datenquelle, `formatDateTime(…, 'long')`), `src/shared/version.ts` + Test (Parität: gleiche Versionen, Daten und Punktzahl je Version) |
| D2 | `docs/handbuch.md`, `README.md`, `CHANGELOG.md` (0.11.0), `package.json`/`package-lock.json` (`npm run version:minor`) |
| D3 | `docs/manual.md` (neu) |

Der Inhalt des 0.11.0-Eintrags steht wörtlich in beiden Aufträgen, je Sprache, mit gleicher Punktzahl.

### Welle 5 – Sweep (1 Task)

- Guard (d) und (g) scharf schalten.
- Restliterale beseitigen, auch die Fallback-Literale aus Welle 2, falls Welle 3 eines übersehen hat.
- `useMemo`/`useCallback` mit Text bekommen `i18n.language` in die Deps.
- Kein `localeCompare`, `toLocaleLowerCase()`, `new Intl.*` außerhalb von `format.ts`.
- Unbenutzte `common`-Keys entfernen.
- CLAUDE.md-Regel ergänzen.
- Dateien: `src/shared/locales/i18n-catalog.test.ts`, `CLAUDE.md`, beliebige Dateien mit Befunden.

---

## 6. Gate je Welle (`npm run typecheck` und `npx vitest run`)

| Welle | Realistisch grün? | Bedingungen |
|---|---|---|
| 1.0 | ja | 88 Testdateien (B4). Neue `DesktopApi`-Member sind im Preload implementiert, Handler fehlen noch (nur Laufzeit, kein Typfehler). Kataloge paritätisch. |
| 1.1 | ja | F1 und F2 unabhängig (B11). Guard (a, b, c, e, f) aktiv: G-Kataloge ohne „Bitte“ (B9) und mit Platzhalter-Parität (`{{count}}` in `_one` und `_other` beider Sprachen). Der Setup lädt `i18n.ts` ohne `window` (B3). |
| 2 | ja, wenn Abschnitt 5 eingehalten wird | Alle Konsumenten der geänderten Typen sind zugeordnet (B7). Main-Tests prüfen Codes. Renderer-Tests mit deutschem Text bleiben grün, weil Katalogtexte zeichengleich sind und `errorText` Fremdtext und Fallbacks roh durchreicht (z. B. `inventory-scheduler.test.ts:164,168`, `file-browser.test.ts:49`). Guard (d) ist `skip`. |
| 3 | ja | Setup de-DE hält 41 Testdateien mit deutschen Assertions grün. Ausnahmen nur nach B15 (`cluster-form.test.ts:43`) und K23. Cross-Task-Typfehler lösen sich am Wellenende, laut Matrix. |
| 4 | ja | `version.test.ts:9-13` braucht 0.11.0 in `CHANGELOG.md` **und** (Parität) in `CHANGELOG.en.md`. D1 und D2 landen zusammen. |
| 5 | ja, mit Restarbeit | (g) ist auf Kommentare und `example.ts` vorbereitet (B12). `describe.ts` ist schon englisch (B13). Erwartbare Restbefunde: JSX-Heuristik-Fehltreffer → `i18n-ignore`. |

## 7. Restrisiken (keine Blocker)

- **Live-Umschalten:** Ein Wurzel-Re-Render erreicht alle Kinder, weil es kein `React.memo` gibt (Grep ohne Treffer). Veralten können nur `useMemo`/`useCallback`-Ergebnisse. Das deckt der Sweep ab.
- **Rohtext aus Bibliotheken:** Der Main reicht ihn nicht automatisch als `detail` weiter (`codedFrom` ohne Detail). Jeder Task entscheidet bewusst, ob ein Servertext (z. B. `KubeApiError.message`, `stderr`) als `detail` sicher ist. Erlaubt sind höchstens 500 Zeichen, nie Stack, nie Schlüssel oder Passwörter (Spec 3.4).
- **Sicherheit unverändert:**
  - `set-language` nur Hauptfenster plus zod.
  - `get-language` nur registrierte Fenster mit Hauptframe.
  - `settings.json` enthält nur die Sprache.
  - `additionalArguments` trägt nur einen Enum-Wert.
  - Kein Exec und keine kubeconfig betroffen.
  - React escapt alle `t()`-Ausgaben. `<Trans>` nur mit Katalog- und Zahlwerten (1.12).
