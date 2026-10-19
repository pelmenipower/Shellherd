# Rebranding Terminus → Shellherd – Validierung (Stufe 3)

Stand: 2026-10-19 · Branch `claude/feature/shellherd-rebrand` (HEAD `5507999`) · Prüfer: Opus
Geprüft: Spec `2026-10-19-shellherd-rebrand-design.md` (R1–R9), Plan `docs/superpowers/plans/2026-10-19-shellherd-rebrand.md`, Code, gelieferte Icons (entpackt im Scratchpad).

**Dieser Anhang ist bindend und geht Spec und Plan vor.**

## Urteil

**ready after corrections**: 3 Blocker (mit Fix), 14 Korrekturen, 6 Entscheidungen.

Die Fundstellen sind vollständig: `git grep -in terminus` über `src`, `scripts`, `native`, `package*.json`, `README.md`, `CHANGELOG.md` und `docs/design-system.md` ergibt keinen Treffer, den der Plan nicht einordnet. Das Vault-Format bleibt unberührt (R1 korrekt, alle Formatkennungen sind aufgelistet). Die Migrationsreihenfolge stimmt: Außer `createKnownHosts()` (`src/main/ssh/ipc.ts:23`) und `registerVaultIpcHandlers` (`src/main/vault/ipc.ts:48`) liest kein Code `userData`, und beide laufen im `whenReady`-Handler nach der Stelle, an der die Migration eingehängt wird. Nachbesserungsbedarf gibt es bei der Icon-Pipeline (Vormultiplikation, Prüftest, gelieferte Kleinvarianten) und bei der Wellenplanung (Typecheck nach Welle 1).

Ausgangslage: `npm run typecheck` grün. `npx vitest run` 1229/1230 grün; `src/main/files/sftp-loopback.test.ts` ist unter Volllast schon heute flaky und läuft einzeln grün (5/5). Das liegt nicht an diesem Feature, siehe K14.

## Messungen (Belege)

Gemessen mit Electron 44.4.2 (`node_modules/.bin/electron`), die Skripte lagen im Scratchpad:

| Messung | Ergebnis | Folge |
|---|---|---|
| `createFromBitmap` mit Bytes `[255,0,0,255]` → `toPNG` | PNG-Pixel RGBA `0,0,255` | Byte-Reihenfolge ist **BGRA** (Plan korrekt). |
| `createFromBitmap` mit Grau 128 bei Alpha 128 → `toPNG` | PNG-Pixel `255,255,255,128` | Der Puffer wird als **vormultipliziert** gelesen. Wer nur das Alpha setzt, erzeugt helle Säume. → **B2** |
| `toPNG` eines voll deckenden Bildes | IHDR-Farbtyp 6 | Farbtyp 6 beweist kein Alpha. Der geplante Artefakttest greift nicht. → **B3** |
| `electron <pfad>/x.mjs` | läuft als ESM-Einstieg | Plan korrekt. |
| ICO aus PNG-Einträgen 16–256 → `nativeImage.createFromPath`, `new BrowserWindow({ icon })` | nicht leer, 256×256, Fenster ok | Plan korrekt. |
| Bounding-Box (Luminanz < 200) | Master 662²: x 0–660, y 8–651, linke Spalte angeschnitten · `16-source` 178×176: x 0–176, y 0–173, oben/links angeschnitten · `32-source` 266×234: x 26–264, y 0–230, oben angeschnitten | Das Quadrat mit Seite `min(w,h)` liegt genau auf der Antialiasing-Kante. → **K2** |
| Prototyp mit K2+B2 (Einzug 3 px, Radius 0,20·s, vormultipliziert) | Kantenhelligkeit (unvormultipliziert, Alpha ≥ 64) max. 31 bei Master 256/64, 75–118 bei den Kleinvarianten (Motiv), Eckpixel Alpha 0 (256/64/32), 1 (24), 7 (16) | Kein weißer Saum. Grenzwert für den Test: Eck-Alpha < 16. |
| `README.txt` im ZIP | „App-Icon und vier Varianten … Exporte 256, 64, 32, 16“; `16-source`/`32-source` zeigen eine **vereinfachte Variante ohne Prompt**, Gesicht formatfüllend | Das Kleinformat-Motiv ist bereits gestaltet. Plan §9 „braucht Gestaltung“ ist falsch. → **K3** |
| `%APPDATA%\Terminus` | enthält `known-hosts.json`, `last-vault.json` und das Chromium-Profil | Der Pfad hängt am Namen, Plan korrekt. |

## Blocker

| # | Problem | Fix (bindend) |
|---|---|---|
| B1 | **Typecheck nach Welle 1 rot.** T2 ändert den Konstruktor `FileAssociation` auf drei Pflichtparameter, der Aufruf in `src/main/index.ts:167` (T1) folgt aber erst in Welle 2. | Der dritte Parameter ist **optional** mit Rückfall auf die Exe: `constructor(execPath: string, appPath: string \| null, iconPath?: string)`. Daraus wird `DefaultIcon = iconValue(this.iconPath ?? this.execPath)`. T1 übergibt in Welle 2 `brandIconPath()`. |
| B2 | **Halbtransparente Kanten falsch kodiert.** `createFromBitmap` erwartet vormultipliziertes BGRA (gemessen). Plan §3.2 Schritt 3 nullt nur außerhalb der Maske, an der 1-px-Kante bleibt RGB unskaliert. Dadurch entsteht ein heller Saum, weil der helle Hintergrund `#f8f8fa` beim Entmultiplizieren auf 255 klemmt. | Pro Pixel **alle vier Kanäle** mit der Abdeckung multiplizieren: `px[c] = Math.round(px[c] * coverage)` für c = B, G, R, A. Die Pixel innen (coverage 1) bleiben unverändert. |
| B3 | **Artefakttest beweist kein Alpha.** `toPNG` schreibt immer Farbtyp 6, auch bei voll deckenden Bildern. Der Test „IHDR Farbtyp 6“ lässt also genau die Variante ohne Alpha durch, die er verhindern soll. | Der Test liest zusätzlich das **Alpha des Pixels (0,0)**. Für Pixel (0,0) ist der Rohwert bei jedem PNG-Filtertyp gleich dem dekodierten Wert, weil links und oben null sind. Ablauf: IDAT-Chunks verketten, `zlib.inflateSync`, dann Byte `[1 + 3]` (Filterbyte + RGB) prüfen. Die Bedingung lautet **< 16** für `icon.png`, `mark-64.png` und jeden ICO-Eintrag. Zusätzlich gilt: Bittiefe 8, Interlace 0. |

## Korrekturen

| # | Stelle | Korrektur (bindend) |
|---|---|---|
| K1 | Plan §3.3 „`assets.d.ts` neu“ | `src/renderer/src/assets.d.ts` **existiert schon** (`*.md?raw`). Die `*.png`-Deklaration wird **angehängt**, nicht neu angelegt. Wortlaut siehe Vertrag. |
| K2 | Plan §3.2 Schritt 2 | Das Quadrat wird um **3 px je Seite eingezogen**: `s = min(bw, bh) - 6`, `x = x0 + floor((bw - s) / 2)`, `y = y0 + floor((bh - s) / 2)`. Die Funktion `nativeImage.crop` schneidet zu, danach folgt die Maske auf dem Ausschnitt mit `r = 0.2 * s`. Diese Werte gelten für jede Quelle. Plausibilitätsprüfung im Skript: Ist `s < 0.85 * min(w, h)` des Bildes, bricht das Skript mit Fehler ab (Exit 1) und schreibt nichts. |
| K3 | Plan §3.1/§9 „16-px-Glyph später“ | Die gelieferten Kleinvarianten werden genutzt. Es gibt drei versionierte Quellen: `resources/brand/shellherd-master.png` (= `shellherd-app-icon.png`), `resources/brand/shellherd-small-32.png` (= `shellherd-32-source.png`) und `resources/brand/shellherd-small-16.png` (= `shellherd-16-source.png`). Zuordnung: ICO 16 ← small-16, ICO 24 und 32 ← small-32, ICO 48, 64, 256 sowie `icon.png` (256) und `mark-64.png` ← Master. Die übrigen gelieferten PNGs und das ZIP bleiben unversioniert. |
| K4 | Plan §2.1 Migration | Vertrag `migrateUserData(source, target, files)` gilt wie unten. Quelle ist `join(app.getPath('appData'), 'Terminus')`, Ziel ist **`app.getPath('userData')`** (nicht `appData/'Shellherd'`, damit `--user-data-dir` und künftige Namen stimmen). Weitere Regeln: kein Kopieren bei gleichem Pfad (Vergleich ohne Groß-/Kleinschreibung nach `resolve`). Kopiert wird über eine Temp-Datei `<ziel>.<uuid>.migrating` und `renameSync`. Ist das Ziel inzwischen vorhanden, wird die Temp-Datei gelöscht. Hintergrund: Eine halb kopierte `known-hosts.json` würde jede SSH-Verbindung dauerhaft mit „Die gespeicherten Server-Schlüssel konnten nicht gelesen werden.“ blockieren, weil die Migration nie erneut läuft. Dateinamen müssen `basename(name) === name` erfüllen, sonst werden sie übersprungen. Die Quelle muss eine reguläre Datei sein. Nichts wirft. Aufruf in `index.ts` **direkt nach** `if (!singleInstance) return;` und vor allem anderen im `whenReady`-Handler. |
| K5 | Plan §3.3 `brandIconPath` | Rückgabe `string \| undefined`. Fehlt die Datei (`existsSync`), kommt `undefined` zurück. Gepackt heißt das heute immer `undefined`, weil es keinen Installer und kein `extraResources` gibt. `BrowserWindow` bekommt dann kein `icon`, und `FileAssociation` fällt auf die Exe zurück (B1). So zeigt die Registry nie auf eine fehlende Datei. |
| K6 | Plan §2.5 AUMID | Nur unter Windows: `if (process.platform === 'win32') app.setAppUserModelId('com.pelmenipower.shellherd');`, auf Modulebene direkt vor `requestSingleInstanceLock()`. |
| K7 | Plan §1.2 `register()`/`unregister()` | Bei `register()` laufen zuerst alle `add`-Aufrufe. Schlägt einer fehl, kommt die bestehende Fehlermeldung, und es wird **nichts gelöscht**. Erst danach folgen die Aufrufe aus `legacyRegistryDeletes()`, jeder einzeln mit `.catch(() => {})`. Ein Fehler beim Abräumen lässt `register()` nie scheitern. `unregister()` löscht beide ProgIDs und je Endung beide `OpenWithProgids`-Werte. Der Standardwert von `.term` wird nur entfernt, wenn `pointsToVaultProgId(queryAusgabe)` zutrifft. Nicht angefasst werden `…\Explorer\FileExts\…\UserChoice` (hashgeschützt, gehört Windows), der Standardwert von `.terminus` (wurde laut Git-Historie nie gesetzt) und fremde ProgIDs. Registry-Zugriff gibt es weiterhin **nur auf Klick** (IPC mit `requireMain`), nie beim Start. |
| K8 | Plan §3.2 Schritt „Skript“ | `make-icons.mjs` ermittelt den Repo-Stamm über `fileURLToPath(new URL('../../', import.meta.url))`, **nicht** über `app.getAppPath()`, denn beim Datei-Einstieg zeigt der auf `default_app`. Es schreibt nur die vier Ausgabedateien und gibt Größen und Bounding-Boxen auf der Konsole aus. Am Ende steht `app.exit(0)`, bei Fehlern `app.exit(1)`. |
| K9 | Plan §3.2 ICO-Test | Zusätzlich zu B3 wird geprüft: Die Größen stehen in den Verzeichniseinträgen aufsteigend als `[16, 24, 32, 48, 64, 256]`. Breite und Höhe im Eintrag (0 = 256) stimmen mit dem IHDR des eingebetteten PNG überein. Die Offsets laufen lückenlos ab `6 + 16·n`. Die Dateilänge ist gleich letzter Offset plus letzte Länge. Der Test importiert kein `electron`. |
| K10 | Plan §8 manuelle Abnahme 1 | Electron übernimmt beim Laden den `<title>` der Seite (`page-title-updated`). Das Zweitfenster zeigt deshalb nach dem Laden „Shellherd“, genau wie heute „Terminus“. Akzeptiert sind „Shellherd – Sitzungen“ und „Shellherd“. Das ist keine Regression und kein Task. |
| K11 | Plan §8 manuelle Abnahme 5 | `.terminus` hat nur `OpenWithProgids` und keinen Standard. Ein Doppelklick kann deshalb „Öffnen mit“ zeigen, dort steht dann Shellherd. Das war schon vorher so. Der Explorer-Symbol-Cache aktualisiert sich eventuell erst nach Ab- und Anmelden. Ein zuvor per „Immer diese App“ gewähltes `UserChoice` auf `Terminus.Vault` lässt Windows einmal nachfragen. Beides akzeptiert, keine automatische Behebung (kein `ie4uinit`, kein `SHChangeNotify`). |
| K12 | Plan §1.7 README | Zeile 3 wird wörtlich: „Lokaler Verbindungsmanager für SSH, RDP, Container und Kubernetes mit verschlüsselten, portablen Vault-Dateien (`.term`).“ Im Abschnitt „Server-Schlüssel“ wird „eigene Terminus-Vertrauensdatei“ zu „eigene Shellherd-Vertrauensdatei“. Ergänzt wird der Satz: „Sie liegt unter `%APPDATA%\Shellherd\known-hosts.json`; beim ersten Start übernimmt Shellherd sie einmalig aus `%APPDATA%\Terminus`.“ |
| K13 | Plan §4 Absatz „Marke“ | Es gilt der Wortlaut aus E6 unten statt des Plan-Texts, damit die Kleinvarianten und das Orange im Bild erwähnt sind. |
| K14 | Plan §7 „nach Welle 2 grün“ | `sftp-loopback.test.ts` ist unter Volllast flaky (Ausgangslage). Schlägt nur dieser Test fehl, läuft er einzeln erneut (`npx vitest run src/main/files/sftp-loopback.test.ts`). Ist er dann grün, zählt die Welle als grün. |

## Entscheidungen

| # | Entscheidung |
|---|---|
| E1 | Der Renderer bekommt **ein** Zeichen, `resources/mark-64.png` aus dem Master (mit Prompt), für den Kopf (24 px) und die Willkommenskarte (36 px). Kein zweites Renderer-Asset. |
| E2 | `.header-vault` behält `gap: var(--space-16)`. Zeichen und Wortmarke stehen als eigene Flex-Kinder ohne Wrapper. Unter 1100 px verschwindet nur `.brand-word`. |
| E3 | Eine bestehende Zieldatei in `%APPDATA%\Shellherd` wird nie überschrieben, auch wenn sie leer oder kaputt ist. Der alte Ordner bleibt unverändert (keine Schreib-, Lösch- oder Umbenennungszugriffe). |
| E4 | Bei der Single-Instance-Sperre bleibt alles wie im Plan §2.4. Terminus und Shellherd können gleichzeitig laufen. |
| E5 | `package.json` wird `"name": "shellherd"`, `"productName": "Shellherd"`. In `package-lock.json` ändert T1 den Namen an beiden Stellen von Hand, die Version zieht `npm run version:minor` nach. Es läuft kein `npm install`. |
| E6 | Der Abschnitt „Marke“ in `docs/design-system.md` steht nach „Roter Faden“ und vor „Tokens“, wörtlich: „## Marke\n\nDas Shellherd-Zeichen (`resources/mark-64.png`) ist das einzige Rasterbild der Oberfläche: 24 px im App-Kopf (`.brand-icon`), 36 px auf der Startkarte (`.brand-mark`). Keine CSS-Radien, Filter oder Schatten darauf; die runden Ecken stecken im Asset. Das Orange im Zeichen ist Bildinhalt, kein Signal; Signalfarbe bleibt Cyan. Erzeugung: `npm run icons` aus `resources/brand/shellherd-master.png` (48–256 px, Kopf- und Startzeichen) und den vereinfachten Kleinvarianten `resources/brand/shellherd-small-32.png` (24, 32 px) und `resources/brand/shellherd-small-16.png` (16 px).“ |

## Vertrag (exakt)

### `src/main/user-data.ts` (neu, T1)

```ts
import { randomUUID } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/** Files Shellherd takes over once from the Terminus profile; the Chromium profile stays behind. */
export const LEGACY_USER_DATA_FILES = ['known-hosts.json', 'last-vault.json'] as const;

/**
 * Copies each file that is missing in `target` from `source`. Never overwrites, never touches `source`,
 * never throws. Returns the names that were copied.
 */
export function migrateUserData(source: string, target: string, files: readonly string[] = LEGACY_USER_DATA_FILES): string[];
```

Verhalten wie in K4. Aufruf in `src/main/index.ts`:

```ts
app.whenReady().then(() => {
  if (!singleInstance) return;
  migrateUserData(join(app.getPath('appData'), 'Terminus'), app.getPath('userData'));
  const association = new FileAssociation(process.execPath, process.defaultApp ? app.getAppPath() : null, brandIconPath());
  …
```

### `src/main/brand.ts` (neu, T1)

```ts
import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Window and file-type icon (`resources/icon.ico` on Windows, `icon.png` elsewhere); undefined when the file is missing. */
export function brandIconPath(): string | undefined;
```

Pfad gepackt: `join(process.resourcesPath, datei)`. Pfad in der Entwicklung: `join(app.getAppPath(), 'resources', datei)`. Im Konstruktor von `createWindow` kommt hinzu: `...(icon ? { icon } : {})` mit `const icon = brandIconPath();`.

### `src/main/file-association.ts` (T2)

```ts
export const VAULT_EXTENSIONS = ['.term', '.terminus'] as const;        // unchanged
export const PROG_ID = 'Shellherd.Vault';
export const LEGACY_PROG_ID = 'Terminus.Vault';
export function isVaultFile(path: string): boolean;                     // unchanged
export function vaultFileFromArgs(argv: string[], exists?: (path: string) => boolean): string | null; // unchanged
export function launchCommand(execPath: string, appPath: string | null): string;                     // unchanged
export function registryEntries(command: string, icon: string): string[][];  // signature unchanged, texts below
/** `"<path>",0` for DefaultIcon. */
export function iconValue(path: string): string;
/** `reg delete` arguments that remove what Terminus (≤ 0.9.0) registered; only HKCU\Software\Classes. */
export function legacyRegistryDeletes(): string[][];
/** True when a `reg query …\.term /ve` output names Shellherd.Vault or Terminus.Vault. */
export function pointsToVaultProgId(regQueryOutput: string): boolean;
export class FileAssociation {
  constructor(execPath: string, appPath: string | null, iconPath?: string);
  registered(): Promise<boolean>;   // checks PROG_ID only, as today
  register(): Promise<void>;
  unregister(): Promise<void>;
}
```

`legacyRegistryDeletes()` liefert genau (in dieser Reihenfolge):

```ts
[
  ['delete', 'HKCU\\Software\\Classes\\Terminus.Vault', '/f'],
  ['delete', 'HKCU\\Software\\Classes\\.term\\OpenWithProgids', '/v', 'Terminus.Vault', '/f'],
  ['delete', 'HKCU\\Software\\Classes\\.terminus\\OpenWithProgids', '/v', 'Terminus.Vault', '/f'],
]
```

`registryEntries` enthält `add(PROG_ID, 'Shellherd Vault')` und `add(\`${PROG_ID}\\shell\\open\`, 'Mit Shellherd öffnen')`. Reihenfolge und übrige Einträge bleiben.

### `src/renderer/src/assets.d.ts` (anhängen, T3)

```ts
/** Images bundled by Vite resolve to their URL. */
declare module '*.png' {
  const src: string;
  export default src;
}
```

`App.tsx`: `import mark from '../../../resources/mark-64.png';`
Kopf: `<div className="header-vault" title={vaultPath ?? undefined}><img className="brand-icon" src={mark} alt="" /><span className="brand-word">Shellherd</span><strong>{vault.name}</strong></div>`
Startkarte: `<img className="brand-mark" src={mark} alt="" />` ersetzt das `<span className="brand-mark">…svg…</span>`, danach `<span>Shellherd</span>`.

### CSS (`src/renderer/src/styles.css`, T3)

```css
.brand-mark { width: var(--control-lg); height: var(--control-lg); object-fit: contain; }
.brand-icon { width: var(--control-xs); height: var(--control-xs); flex: 0 0 auto; object-fit: contain; }
```

`.brand-mark` verliert `display: grid; place-items: center; color: …`. Kein `border-radius`, `filter` oder `box-shadow`. `.brand-icon` steht direkt nach `.header-vault`.

### Icon-Skripte (T0)

```js
// scripts/icons/ico.mjs
/** @param {Array<{ size: number; png: Buffer }>} entries  @returns {Buffer} */
export function buildIco(entries) {}
/** @param {Buffer} buffer  @returns {Array<{ width: number; height: number; offset: number; length: number; png: Buffer }>} width/height 256 for stored 0 */
export function parseIco(buffer) {}
```

`make-icons.mjs`: Ablauf Quelle → Bounding-Box (Luminanz `0.299R+0.587G+0.114B < 200`) → K2-Quadrat → `crop` → Maske mit vorzeichenbehaftetem Abstand zum Rundeck, `coverage = clamp(0.5 − d, 0, 1)` an der Pixelmitte, B2-Vormultiplikation → `createFromBitmap` → `resize({ width, height, quality: 'best' })` → `toPNG`. Die Quellen ordnet K3 zu. Ausgaben: `resources/icon.ico`, `resources/icon.png`, `resources/mark-64.png`.

### Wörtliche Texte

| Ort | Text |
|---|---|
| `index.ts` Fenstertitel | `'Shellherd'` / `'Shellherd – Sitzungen'` |
| `index.ts` Schließen-Dialog | Titel `'Shellherd schließen'`, Meldung `'Alle aktiven Verbindungen in allen Fenstern trennen und Shellherd schließen?'` |
| `vault/ipc.ts` | `'Shellherd-Vault speichern'`, `'Shellherd-Vault auswählen'`, Filtername `'Shellherd Vault'`, Endungen `['term', 'terminus']` **unverändert** |
| `file-association.ts` | `'Shellherd Vault'`, `'Mit Shellherd öffnen'` |
| `WelcomePage.tsx` | `'.term-Dateien öffnen sich jetzt per Doppelklick oder Rechtsklick → „Mit Shellherd öffnen“.'`, `'Shellherd ist mit .term-Dateien verknüpft.'` |
| `App.tsx` | Wortmarke `Shellherd` (Kopf und Startkarte), Fußzeile `Shellherd {version}` |
| `ReleaseNotes.tsx` | `Shellherd {version}` |
| `AiSettingsDialog.tsx` | `… nur vom Shellherd-Hauptprozess verwendet …`, `… Shellherd findet den passenden Aufrufweg selbst.` |
| `kube-menus.ts` (+ Test 451, 726) | `` `Objekte vom Typ ${involved.kind} zeigt Shellherd nicht an.` `` |
| `migrations.ts` (+ Test 37: `/neueren Shellherd-Version/`) | `` `Dieser Vault wurde mit einer neueren Shellherd-Version gespeichert (Format ${version}). Bitte aktualisiere Shellherd.` `` |
| `ai/assistant.ts` | `Terminal-Assistent in Shellherd.` … `Shellherd tippt ihn ein; der Nutzer führt ihn selbst aus.` |
| `ssh/session.ts:286` (+ Test 450–451) | `'\r\n[Shellherd] sudo hat nicht wie erwartet geantwortet – bitte selbst eingeben.\r\n'` |
| `RdpSession.cs:77` | `"Shellherd RDP - " + request.Server` |
| `index.html` | `<title>Shellherd</title>` |
| localStorage | `shellherd.seenVersion`, `shellherd.aiProvider`, `shellherd.aiStepByStep`, `shellherd.assistantOpen` |
| MIME | `application/x-shellherd-files`, `application/x-shellherd-node` |
| fieldManager | `'shellherd'` (`client-api.ts:377,388`, Test 370) |
| Temp-Präfix | `'shellherd-edit-'` |
| Env | `SHELLHERD_RDP_DEBUG`, `SHELLHERD_RDP_SMARTSIZE`, `SHELLHERD_RDP_MODE` (die alten Namen werden **nicht** zusätzlich gelesen) |
| `package.json` | `description`: `"Shellherd – a local, encrypted connection manager for SSH, RDP, containers and Kubernetes."`, `homepage`, `repository` wie Plan §1.1, `"icons": "electron scripts/icons/make-icons.mjs"` |
| `CHANGELOG.md:3` | `Alle nennenswerten Änderungen an Shellherd (bis 0.9.0 unter dem Namen Terminus).` |

CHANGELOG 0.10.0 wie Plan §5, dazu als fünfter Punkt: „Lokale Oberflächen-Vorlieben (gewählter KI-Anbieter, Assistent offen, gesehene Release-Notes) starten nach dem Umzug einmal neu.“ Beim ersten Punkt heißt es „Startkarte“ statt „Willkommensseite“.

Unverändert bleiben (ausdrücklich): `terminus-vault`, `terminus-encrypted-vault`, AAD `terminus-encrypted-vault:v1`, `.term`/`.terminus` in `storage.ts`, `App.tsx:87`, `file-association.ts:6`, `vault/ipc.ts`, die sudo-/list-/ready-Marker `[terminus-…]`, die Test-Temp-Präfixe, historische Specs, Pläne und CHANGELOG-Einträge, `UI_UX_PLAN.md`, `RDP_IMPLEMENTIERUNGSPLAN.md` sowie der Kommentar in `migration-backup.test.ts:13`.

## Wellen und Tasks (Dateien disjunkt)

| Welle | Task | Dateien | Grün danach |
|---|---|---|---|
| 1 | T0 Icons | `scripts/icons/make-icons.mjs`, `scripts/icons/ico.mjs`, `scripts/icons/ico.test.mjs`, `resources/brand/shellherd-master.png`, `resources/brand/shellherd-small-32.png`, `resources/brand/shellherd-small-16.png`, `resources/icon.ico`, `resources/icon.png`, `resources/mark-64.png`, `.gitignore` (`resources/*.zip`) | Skript einmal mit `./node_modules/.bin/electron scripts/icons/make-icons.mjs` ausführen, die Artefakte einchecken |
| 1 | T2 Dateizuordnung | `src/main/file-association.ts`, `src/main/file-association.test.ts`, `src/renderer/src/components/WelcomePage.tsx` | B1 (optionaler Parameter), K7 |
| 1 | T3 Renderer | `src/renderer/index.html`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`, `src/renderer/src/assets.d.ts` (anhängen), `components/{ReleaseNotes,AiSettingsDialog,AssistantPanel,FilePane,VaultTree,SplitTerminalArea}.tsx`, `hooks/useAssistantToggle.ts`, `release-notes.ts`, `assistant-chat.ts`, `kube-menus.ts`, `kube-menus.test.ts` | Typecheck ohne T0 grün (Moduldeklaration). Kein Test importiert `App.tsx`. |
| 1 | T4 Main/Shared | `src/main/vault/ipc.ts`, `src/main/ssh/session.ts`, `src/main/ssh/session.test.ts` (nur 450–451), `src/main/ai/assistant.ts`, `src/main/kubernetes/client-api.ts`, `src/main/kubernetes/client-api.test.ts`, `src/main/files/remote-edit.ts`, `src/shared/ipc.ts`, `src/shared/ai-cli.ts`, `src/shared/vault/migrations.ts`, `src/shared/vault/migrations.test.ts` | |
| 1 | T5 RDP-Helfer | `git mv native/Terminus.RdpHost native/Shellherd.RdpHost` (Namespaces, Manifest, Fenstertext, Kommentare), `scripts/build-rdp-host.mjs` (Z. 14, 15, 35, 38), `scripts/rdp-try.mjs`, `src/main/rdp/host.ts`, `src/main/rdp/ipc.ts` (Z. 28, 33, 35) | `npm run build:rdp-host` erzeugt `out/rdp-host/Shellherd.RdpHost.exe` |
| 2 | T1 Identität/Start | `package.json`, `package-lock.json`, `src/main/index.ts`, `src/main/brand.ts`, `src/main/user-data.ts`, `src/main/user-data.test.ts`, `src/main/windows.ts`, `src/main/drag-ghost.ts` | K4–K6, E5; Version 0.10.0 |
| 2 | T6 Doku | `README.md`, `CHANGELOG.md`, `docs/design-system.md` | K12, E6, CHANGELOG 0.10.0. `version.test.ts` und `check:version` werden erst mit T1 und T6 zusammen grün, also am Ende von Welle 2. |

Nach jeder Welle laufen `npm run typecheck` und `npx vitest run`, für K14 gilt die Ausnahme oben. Nach Welle 1 bleibt `version.test.ts` grün (0.9.0 und CHANGELOG 0.9.0 unverändert). Nach Welle 2 folgt zusätzlich `npm run check:version` und `npm run build:rdp-host`.

## Testpflichten

- **neu `src/main/user-data.test.ts`** (Temp-Verzeichnisse): kopiert beide Dateien inhaltsgleich und legt das Ziel an, wenn es fehlt. Eine vorhandene Zieldatei (auch leer) bleibt unverändert. Fehlt die Quelle oder der Quellordner, gibt es kein Werfen und `[]`. Danach sind Inhalt und Dateiliste der Quelle unverändert. Gleicher Pfad (andere Schreibweise) ergibt `[]`. Ist die Quelle ein Verzeichnis namens `known-hosts.json`, wird es übersprungen. Ein Name mit Pfadtrenner (`'..\\x'`, `'a/b'`) wird übersprungen. Es bleibt keine `*.migrating`-Datei zurück.
- **neu `scripts/icons/ico.test.mjs`**: `buildIco` und `parseIco` per Round-Trip, Header `0,1,n`, 256 als 0 kodiert, Offsets lückenlos. Artefakte nach B3 und K9: `icon.png` 256², `mark-64.png` 64², ICO genau `[16,24,32,48,64,256]`, jeder Eintrag mit PNG-Signatur, Bittiefe 8, Farbtyp 6, Interlace 0, Eck-Alpha < 16.
- **angepasst `file-association.test.ts`**: neue Texte und ProgID. `legacyRegistryDeletes()` liefert genau die drei Einträge, alle unter `HKCU\Software\Classes\`, keiner löscht den Schlüssel `.term` selbst oder etwas unter `Software\Microsoft`. `pointsToVaultProgId` ist wahr für Ausgaben mit `Shellherd.Vault` oder `Terminus.Vault` und falsch für `SomeEditor.term` oder leer. `iconValue('C:\\a b\\icon.ico')` ergibt `'"C:\\a b\\icon.ico",0'`. `launchCommand`-Beispielpfade auf `Shellherd` umstellen.
- **angepasst**: `kube-menus.test.ts:451,726`, `migrations.test.ts:37`, `session.test.ts:450–451`, `client-api.test.ts:370`.
- **unverändert grün als Formatbeleg**: `storage.test.ts`, `migration-backup.test.ts`, `schema.test.ts`, `mutations.test.ts`, `crypto`-Tests, `design-tokens.test.ts`, `version.test.ts` (nach Welle 2).
- **Grep-Abnahme nach Welle 2**: `git grep -n "Terminus" -- src scripts native package.json` liefert nur noch folgende Treffer: `LEGACY_PROG_ID`/`'Terminus.Vault'` in `file-association.ts`/`.test.ts`, `'Terminus'` als Quellordner in `index.ts`, den Kommentar in `migration-backup.test.ts:13` und Testpfade. `git grep -n "terminus" -- src` zeigt nur Formatkennungen, Endungen, sudo-Marker und Test-Präfixe.

## Sicherheitsprüfung (vor dem Code)

- Bestätigungspfad für Host-Schlüssel unverändert. `known-hosts.json` wird nur kopiert, nie zusammengeführt oder überschrieben. Eine Kopie mit gleichem Inhalt bedeutet gleiches Vertrauen, kein neues Vertrauen ohne Klick.
- Registry nur auf Nutzerklick über `requireMain`-geschützte Kanäle. Der Start schreibt keine Registry. Gelöscht werden nur eigene Alt-Schlüssel (K7).
- Keine neuen IPC-Kanäle, `sandbox`/`contextIsolation`/`devTools: false` unverändert, keine neuen Pakete, keine Exec außer dem bestehenden `reg.exe` (auf Klick) und dem RDP-Helfer (unverändert, nur umbenannt).
- Die Migration nutzt nur feste Dateinamen und Electron-Pfade. Es gibt keine Nutzereingabe im Pfad und keinen Zugriff außerhalb von `appData\Terminus` (lesen) und `userData` (schreiben).
- kubeconfig ist nicht betroffen. Der fieldManager-Wechsel wird nur im Unit-Test geprüft, nicht am Cluster.

## Manuelle Abnahme (Windows, `npm run dev`)

1. Vorher `%APPDATA%\Terminus\known-hosts.json` und `last-vault.json` sichern (Hash notieren). `%APPDATA%\Shellherd` existiert nicht.
2. Start: Titel „Shellherd“, Fenster- und Taskleisten-Icon zeigen den Hund (Taskleiste: Kleinvariante ohne Prompt). Zweitfenster „Shellherd – Sitzungen“ oder „Shellherd“ (K10).
3. `%APPDATA%\Shellherd\known-hosts.json` und `last-vault.json` sind hash-gleich zu den alten. Der alte Ordner ist unverändert (Dateiliste und Hashes). Ein bekannter Host fragt nicht nach dem Schlüssel. Der letzte Vault ist vorausgewählt.
4. Release-Notes 0.10.0 erscheinen einmal.
5. Startkarte: 36-px-Zeichen ohne hellen Saum auf dunklem Grund, Fußzeile „Shellherd 0.10.0“. Kopf: 24-px-Zeichen und „Shellherd“. Unter 1100 px bleibt das Zeichen und das Wort verschwindet.
6. „In Windows einbinden“: `reg query HKCU\Software\Classes\.term /ve` zeigt `Shellherd.Vault`. `reg query HKCU\Software\Classes\Terminus.Vault` meldet „nicht gefunden“. `DefaultIcon` zeigt auf `C:\workspace\Terminus\resources\icon.ico`. Doppelklick auf `.term` öffnet in der laufenden Instanz. `.terminus` geht über „Öffnen mit → Shellherd“ (K11). „Verknüpfung entfernen“: beide ProgIDs und der `.term`-Standard sind weg.
7. Schließen mit offener Sitzung: „Shellherd schließen“.
8. RDP gegen `rdp-test`: `Shellherd.RdpHost.exe` läuft im Task-Manager. `SHELLHERD_RDP_DEBUG=1` loggt mit maskierten Passwörtern.
9. Vault speichern und öffnen: Titel „Shellherd-Vault speichern/auswählen“, Filter „Shellherd Vault“. Ein alter `.terminus`-Vault öffnet und speichert weiter als `.terminus`.
10. Kubernetes nur lesend: Hinweis „… zeigt Shellherd nicht an.“ im Event-Menü.
