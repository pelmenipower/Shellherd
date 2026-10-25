# Härtung – Review (Stufe 5)

Branch `claude/feature/haertung` gegen `claude/feature/sftp-komfort` (11 Commits, `c0fda4d..dbcdca3`).
Grundlage: Spec `2026-10-25-haertung-design.md`, der bindende Anhang `…-validation.md` (B1, B2, K3–K6, V-R1–V-R3) und das Ledger `.superpowers/sdd/2026-10-25-haertung/progress.md` mit R-1 (Capture-Probe bewusst entfernt).

**Urteil: ready after fixes** – 0 Critical, 1 Important, 4 Minor.

Gates: `npm run typecheck` grün, `npx vitest run` grün (160 Dateien, 2477/2477).
Live-Proben im laufenden Treiber (isoliertes Profil, nur synthetische Daten):
- `isContentProtected()` im entsperrten Zustand ist `[false]`.
- Server-Schlüssel-Dialog mit 120 geklonten Zeilen (nur DOM, nichts gespeichert): Er scrollt als Ganzes, siehe I-1. Dabei entstand der Shot `%TEMP%\shellherd-run\shots\review-host-keys-many.png`.
- Escape führt zurück in die Einstellungen, der Fokus liegt dann auf „Server-Schlüssel verwalten“.
- Fokusverhalten von Chromium beim Deaktivieren eines fokussierten Knopfs geprüft, siehe M-1.

Weder ein echter Vault noch `%APPDATA%\Shellherd` noch `~/.ssh` wurden geöffnet.

---

## 1. Sicherheit

### Vault-Freigabe

Ergebnis: dicht. Es gibt keinen Main-Weg, der eine Vault-Datei aus einem Renderer-String ohne Freigabe öffnet.

- **Einziger Leser** ist `readEncryptedVaultFile`, aufgerufen nur in `session.ts:59` über `vaultSessionManager.unlock`. Diesen Aufruf gibt es an genau zwei Stellen:
  - `vault/ipc.ts:197` (`unlockVault`): Davor prüft `vaultPathAllowed` (`:194`), und zwar nach `requirePassword` und vor jedem Dateizugriff. `recent.has` liest nur `settings.json` (bzw. einmalig `last-vault.json`), die Vault-Datei selbst nie.
  - `vault/ipc.ts:124` (neuer Vault): Der Pfad kommt aus `showSaveDialog` und nur der Basisname aus dem Renderer.
- **Freigabequellen**, alle mit Klick des Nutzers oder aus Main-eigenen Daten:
  - nativer Dialog (`:168`)
  - Explorer-argv beim Start und in `second-instance` (`index.ts:219-230`)
  - geprüfter Drop (`:69-74`)
  - die gesperrte Session
  - `recentVaults`
- **V-R1 nachgeprüft:** Node öffnet unter Windows `toNamespacedPath(path)`, also `\\?\` + `win32.resolve(path)`. Das geöffnete Ziel ist damit genau der geprüfte Schlüssel, bis auf die Kleinschreibung. Eine Unicode-Ausnahme dazu steht unter M-2.
- **Drop im Renderer** (`App.tsx:281-283`): `openVaultFileRef` läuft nur im Erfolgszweig von `dropVaultFile`. Lehnt Main ab, erscheint nur die Meldung `vaultPathRefusedTitle`, und es folgt kein `unlockVault`. Selbst wenn der Renderer das ignorierte, lehnt `unlockVault` den nicht freigegebenen Pfad ab (K6-Test `ipc.test.ts:36-41`).
- **`droppedVaultPath`:**
  - Prüfung vor **und** nach `resolve`, deshalb nur `X:\`.
  - `C:/\\srv\s\v.term` wird zu `C:\srv\s\v.term` und bleibt damit lokal.
  - `\\?\`, `\\.\`, `//` und relative Pfade liefern `null`.
- **`missing()`** erkennt `//` und `\/` jetzt als UNC (`recent-vaults.ts:62`). Der Test steht in `recent-vaults.test.ts` (`it.each`).
- **Grenze bleibt A5:** `privateKeyPath`, das lokale Dateifenster und Auto-Upload bei entsperrtem Vault.

### known-hosts

- **Reihenfolge in `verifyNext`** (`known-hosts.ts:147-160`): revoked (`:147`) → bestätigt (`:148-152`, beendet die Prüfung mit Treffer oder `hostKeyChanged`) → importiert (`:154-159`) → Rückfrage. Das ist korrekt.
  - Nach der Rückfrage wird erneut gelesen. Die Queue verhindert, dass ein Import oder Entfernen dazwischenfunkt.
  - Tests: „revoked trotz bestätigt“, „bestätigt schlägt importiert“, „gleicher Typ → changed“, „anderer Typ → confirm“.
- **HMAC** (`known-hosts-parse.ts:30-32`): Schlüssel ist das base64-decodierte Salt, Nachricht `host` bzw. `[host]:port`. Das entspricht OpenSSH `put_host_port`/`host_hash`. `verifyNext` übergibt den kleingeschriebenen Namen.
  - Salt und Hash sind beim Parsen auf genau 20 Byte geprüft und gepaddet. Das Schema `BASE64_20` erzwingt das auch beim Lesen.
- **`...stored`** übernehmen alle drei Schreiber: `verifyNext` (`:166`), `remove` (`:200`) und `importKeys` (`:240`). `write` schreibt immer das ganze Objekt. Der Regressionstest „keeps imported and revoked entries when a new server is confirmed“ ist vorhanden.
- **Queue:** `enqueue` hängt jede Aufgabe an und setzt `queue` auf eine Promise, die nie rejected. `verify`, `remove` und `importKeys` laufen darüber. `list` läuft absichtlich nicht darüber (V-R2) und liest eine atomar ersetzte Datei. Der Test „does not lose a write when an import runs alongside a confirmation“ ist vorhanden.
- **`remove` mit fremder Id:**
  - Ids sind `sha256(JSON[origin, …])[0..16]`, der Ursprung ist Teil des Hashes. Eine Kollision über Kategorien hinweg hätte 2⁻⁶⁴ Wahrscheinlichkeit.
  - Der Kanal prüft `^[0-9a-f]{16}$`, das Hauptfenster und den entsperrten Vault.
  - Eine gültige Id trifft also nur den Eintrag, zu dem sie gehört. Ein kompromittierter Renderer **mit entsperrtem Vault** kann jeden Eintrag entfernen, auch einen Widerruf, und damit eine erneute Rückfrage erzwingen. Das ist so gewollt (R3.7: ohne Rückfrage, umkehrbar) und liegt innerhalb der bekannten Grenze „entsperrter Renderer“.
- **Kann ein Import einen bestätigten Schlüssel aushebeln?** Nein.
  - Klartext-Zeilen für bestätigte Adressen werden nie gespeichert (`:225-231`).
  - Gehashte Zeilen werden gespeichert, aber `verifyNext` sieht sie erst, wenn kein bestätigter Eintrag existiert.
  - Ein Import kann einen bestätigten Schlüssel nur **strenger** machen, nämlich per `@revoked` (R3.4, gewollt).
  - Ein widerrufener Schlüssel wird nie als vertrauenswürdig übernommen. Das gilt auch dann, wenn die 200er-Grenze den Widerruf selbst nicht mehr speichert, denn `revokedPrints` enthält die Widerrufe der Datei.
- **Fail-closed:** Jede vom Parser erzeugte Zeile erfüllt das Schema (Name über `HOST`, Port 1–65535, Typ aus `KEY_TYPES`, Fingerprint mit 43 Zeichen). Ein Import kann die Datei deshalb nicht so beschädigen, dass alle Verbindungen am Schema scheitern.
- **K4** steht in `known-hosts-ipc.ts:139`: Wird während des Dialogs gesperrt, liest der Kanal nichts und schickt keine Hostnamen.

### Parser-Grenzen

Ergebnis: kein Backtracking-Risiko.
- `BASE64 /^[A-Za-z0-9+/]+={0,2}$/`: Die Klasse enthält kein `=`, der Ausdruck ist verankert, das ergibt O(n).
- `HOST` und `PORT` sind begrenzte Einzelklassen.
- `/[ \t]+/` in `split` und `/=+$/` laufen nur auf dem 44-Zeichen-Digest.
- Die Länge wird vor dem Zerlegen geprüft (16 KiB), Schlüssel sind auf 1 000 begrenzt, die Eingabe auf 4 MiB (`stat` vor `readFile`).
- Der 4-MiB-Test mit `|`, `[`, `a,` und Leerzeichen bleibt unter 1 s.
- `keyType` begrenzt die Typlänge auf 64.

### Fensterschutz

Ergebnis: Er greift in allen Sperrwegen und wird korrekt zurückgesetzt.

| Weg | Stelle | Schutz |
|---|---|---|
| Manuell (`vault:lock` ohne `disconnect`) | `index.ts:367` `onLock` | an, vor `announce` |
| Auto-Sperre | `index.ts:374`, im `finally` | an, auch wenn `lock()` wirft |
| Nebenfenster entsteht während der Sperre (B1) | `index.ts:123` `captureBlocked` | an |
| Entsperren (auch nach `saveVault`) | `index.ts:368` `onUnlock` | aus |
| Wechsel/Trennen (`disconnect: true`), anderer Vault vom Sperrbildschirm | `index.ts:366` `onSessionChange` | aus, danach `onUnlock` |
| Falsches Passwort | kein Callback | bleibt an (richtig) |
| `will-quit` | `index.ts:436` | ohne Wirkung, die Fenster schließen (Spec-Risiko 3) |

- Die Abnahme prüft `isContentProtected()` in `lock` und `lock-secondary`, während der Sperre und nach dem Entsperren (`screens.mjs:335-336`, `:369`, `:399-400`, `:413`).
- Die Capture-Probe fehlt nach R-1 bewusst.
- M1 (Taskleisten-Vorschau) ist offen und im Ledger als manueller Test für den Nutzer vermerkt. Das Handbuch verspricht die Vorschau nicht.

### run-app-Szenen

Ergebnis: nur synthetische Daten.
- **Fixture** (`import-fixtures.mjs:107-123`): Schlüssel deterministisch aus `sha512(label)`, Hosts erfunden, abgelegt in `RUN_DIR\import`.
- **`host-keys`:**
  - verbindet nur `web-01` (`127.0.0.1:2222`)
  - räumt nur Einträge im isolierten Profil auf
  - stellt den Dateidialog im `finally` auf `VAULT_FILE` zurück
- **`vault-path`:**
  - nennt als UNC nur `127.0.0.1`
  - `C:\nope\…` wird vor jedem Zugriff abgelehnt
  - Der Drop-Test gibt `C:\nope\x.term` nur für diesen Lauf im Speicher frei, die Datei existiert nicht.

---

## Issues

### Critical

Keine.

### Important

**I-1 Die Server-Schlüssel-Liste scrollt nicht, der ganze Dialog scrollt** – `src/renderer/src/settings-ui.css:2`, `:28`; Struktur `src/renderer/src/components/KnownHostsDialog.tsx:71-101`
- Szenario:
  - `.known-hosts-dialog` erbt `max-height: calc(100dvh - 48px); overflow: auto`, `.known-hosts-list` hat `overflow: visible`.
  - Schon bei 7 Einträgen füllt der Dialog fast das ganze Fenster (Shot `host-keys-import.png`). Live mit 122 Zeilen gemessen: Dialoghöhe 850 px, `scrollHeight` 10 167 px, der Knopf `Schließen` steht bei y = 10 140.
  - Nach dem Scrollen ans Ende liegt das Suchfeld bei y = −9 189. Suchfeld, Import-Knopf, Ergebnis- und Konfliktmeldung sowie „N von M“ verschwinden beim Scrollen.
  - Eine typische `known_hosts` mit 100 oder mehr Zeilen (Import bis 1 000) macht die Suche nach dem Scrollen unerreichbar, ohne zurückzuscrollen. `Schließen` erreicht man nur über Scrollen oder Escape.
- Fix (Eigentümer `settings-ui.css`, nur vorhandene Tokens, keine Bewegung):
  ```css
  .known-hosts-dialog[open] { display: flex; flex-direction: column; overflow: hidden; }
  .known-hosts-list { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }
  ```
  - Der Dialog bleibt dabei auf `max-height` begrenzt. Kopf, Werkzeugzeile, Meldung und Fußzeile bleiben stehen, nur die Liste scrollt.
  - Zeile 2 behält `.known-hosts-dialog` für Breite, Padding und Radius. `overflow: hidden` gilt nur für den Unterdialog, `.settings-dialog` bleibt unverändert.
  - Damit Rahmen und Fokusring nicht abgeschnitten werden, bekommt `.known-hosts-list` zusätzlich `padding: var(--space-2);` (Token vorhanden).
- Absichern (Eigentümer `.claude/skills/run-app/screens.mjs`, Block `host-keys`): Nach dem Import prüfen, dass `getComputedStyle(list).overflowY === 'auto'` gilt und die Fußzeile im Viewport liegt (`getBoundingClientRect().bottom <= innerHeight`).

### Minor

**M-1 Nach dem Import (auch nach Abbrechen) fällt der Fokus auf `body`** – `src/renderer/src/components/KnownHostsDialog.tsx:36-50`, `:77`
- Szenario:
  - `importFile` setzt `pending`, und der fokussierte Import-Knopf wird `disabled`. Chromium verschiebt den Fokus dann auf `body`, live nachgeprüft (`activeElement` = `BODY`, und der Fokus kommt nach `disabled = false` nicht zurück).
  - Anders als `remove` (`:64`) stellt `importFile` den Fokus nicht wieder her. Ein Tastaturnutzer steht nach dem Import oder Abbruch außerhalb jedes Elements.
  - Escape funktioniert weiter, Tab beginnt wieder oben.
  - Nebenbei: Die Live-Region (`role="status"`, `:79`) wird zusammen mit ihrem Text eingefügt. Manche Screenreader lesen das Importergebnis deshalb nicht vor.
- Fix (Eigentümer `KnownHostsDialog.tsx`):
  - `const importRef = useRef<HTMLButtonElement>(null)` am Import-Knopf.
  - Im `finally` von `importFile`: `setPending(false); requestAnimationFrame(() => importRef.current?.focus());`. Fokussiert wird erst nach dem Re-Render, sonst ist der Knopf noch `disabled`.
  - Optional die Meldungs-`div` immer rendern (leer, `role="status"`) und nur ihren Inhalt setzen.

**M-2 Unicode-Faltung im Freigabeschlüssel** – `src/main/vault/recent-vaults.ts:18` (`toLowerCase`), genutzt von `src/main/vault/path-grants.ts:8-9` und `:41`
- Szenario:
  - `'\u212A'.toLowerCase() === 'k'` (Kelvin-Zeichen). Steht in `Zuletzt benutzt` ein UNC-Vault wie `\\nas.k…\share\v.term`, kann ein kompromittierter Renderer `unlockVault` mit `\\nas.\u212A…\share\v.term` aufrufen. Der Schlüssel ist gleich, also folgt die Freigabe. Geöffnet wird aber der Rohpfad (V-R1), und damit ein anderer Servername.
  - V-R1 sagt „wo dieselbe Schreibweise auf zwei Dateien zeigen kann, sind beide lokal“. Für UNC-Freigaben stimmt das nicht.
  - Ob die Windows-Namensauflösung (UTS46-Mapping) den Namen wieder auf `k` abbildet und damit denselben Server trifft, ist unbelegt. Die Voraussetzungen sind eng: kompromittierter Renderer, UNC-Vault in der Liste, ein `k` im Hostnamen und ein vom Angreifer kontrollierter Zielname. Deshalb nur Minor.
- Fix (Eigentümer `path-grants.ts`, ohne die Dedup-Semantik von `recentKey` anzufassen): In `vaultPathAllowed` zusätzlich verlangen, dass `filePath` reines ASCII ist oder dass `win32.resolve(filePath)` buchstabengleich mit dem freigegebenen bzw. gespeicherten Pfad ist. Am einfachsten wird nur ASCII gefaltet:
  ```ts
  const grantKey = (p: string): string => win32.resolve(p).replace(/[A-Z]/g, c => c.toLowerCase());
  ```
  Dieser Schlüssel gilt für `VaultPathGrants`, für den Vergleich mit dem gesperrten Pfad und, über eine Variante von `RecentVaults.has`, für die Liste.
  - Test: `grant('\\\\nas.k\\s\\v.term')` darf `has('\\\\nas.\u212A\\s\\v.term')` nicht erfüllen.

**M-3 Doku: „Typ“ bei bestätigten Einträgen, kein Weg zu gehashten Einträgen** – `docs/handbuch.md:618`, `docs/manual.md:607`; Kartentext `src/shared/locales/{de-DE,en-US}/terminal.json` (`hostkey-changed.next`)
- Szenario 1: Das Handbuch sagt, die Liste zeige alle Schlüssel „mit Host, Port, Typ“. Bestätigte Einträge haben keinen Typ (R3.7), gehashte keinen Host, widerrufene keinen Host und keinen Port.
- Szenario 2: Ein importierter **gehashter** Eintrag mit altem Schlüssel löst nach einem gewollten Wechsel `hostKeyChanged` aus. Die Karte rät, „den alten Schlüssel“ zu entfernen. Die Suche nach dem Hostnamen findet ihn aber nicht (gehasht, Extra „HMAC-Suche“). Nur der Fingerprint aus der Kartendetail-Zeile `expected …` führt zum Eintrag.
- Fix (Eigentümer `docs/handbuch.md`, `docs/manual.md`): Den Satz so fassen: „… mit Host und Port (gehashte Einträge: „Gehashter Hostname“), Typ bei importierten Einträgen und SHA-256-Fingerprint.“ Dazu einen Satz anhängen: „Einen gehashten Eintrag findest du über den Fingerprint, den die Fehlerkarte als `expected` nennt.“ Die Kartentexte bleiben wie in Spec 3.9.

**M-4 Kein Handler-Test für `known-hosts-ipc.ts`** – `src/main/ssh/known-hosts-ipc.ts:119-149`
- Szenario: Folgende Prüfungen sind ungetestet:
  - Wächter (Hauptfenster, entsperrter Vault)
  - Id-Regex
  - K4 (gesperrt nach dem Dialog → kein `stat`/`readFile`)
  - Größenlimit (`core.importTooLarge`)
  - Abbruch → `{ canceled: true }`

  Eine spätere Umstellung, zum Beispiel K4 hinter das Lesen zu schieben, bliebe grün. Spec 10 verlangt das nicht, für eine Vertrauensgrenze ist es aber der fehlende Teil.
- Fix (Eigentümer neue Datei `src/main/ssh/known-hosts-ipc.test.ts`, Muster `src/main/vault/ipc.test.ts`): `electron` mocken, dazu `../vault/ipc` mit `getSnapshot` als `vi.fn` und `node:fs/promises` als Spion.
  - Testfälle:
    - `remove('x')` → `core.invalidRequest`.
    - Bei gesperrtem Vault nach dem Dialog wirft der Aufruf, und `readFile` wird nicht aufgerufen.
    - Bei `stat.size > MAX_IMPORT_BYTES` → `core.importTooLarge`.
    - Bei `canceled` → `{ canceled: true }` ohne `stat`.

---

## 2. Korrektheit (geprüft, ohne Befund außer oben)

- **Vertrag:** `src/shared/known-hosts.ts`, `ipc.ts` und Preload stimmen wörtlich mit Spec 3.1/3.2 überein, ebenso `known-hosts-parse.ts` (3.3 mit K5), `known-hosts.ts` (3.4) und `known-hosts-ipc.ts` (3.5 mit K4).
- **Freigabe:** `path-grants.ts`, `recent-vaults.ts` und `vault/ipc.ts` folgen 3.6 wörtlich. `index.ts` folgt 3.7 mit B1 wörtlich.
- **Renderer:** `known-hosts-view.ts` folgt 3.8 wörtlich. `KnownHostsDialog.tsx` folgt 3.8 mit K3 (Klasse `confirm-dialog known-hosts-dialog`). `SettingsDialog` und `App` stimmen mit 3.8 überein.
- **Rücksprung:**
  - `onClose` setzt `{ kind: 'settings', instant: true, focus: 'manageHostKeys' }`, live bestätigt per Escape: Die Einstellungen sind offen, der Fokus liegt auf dem Knopf.
  - `afterLock` schließt den Dialog (`App.tsx:630`).
  - `onManageHostKeys` öffnet nur mit `settingsVault`, und der Knopf steht nur im Abschnitt `connections` mit Vault.
- **Tastatur:** Beim Öffnen liegt der Fokus im Suchfeld. Escape wird während `pending` ignoriert (`onCancel`, `locked`). Nach `Entfernen` geht der Fokus ins Suchfeld. Jeder `Entfernen`-Knopf trägt ein eigenes `aria-label` mit dem Host.
- **Viele Einträge:** Die Liste wird ohne Virtualisierung gerendert (R3.7, ≤ 1 000 + bestätigte). `sortKnownHosts` und `matchesKnownHost` sind über `useMemo` gecacht. Das Problem ist nur das Layout (I-1), nicht die Leistung.
- **React-Keys:** Ids sind innerhalb jeder Kategorie eindeutig (Import dedupliziert per Id, Widerrufe per Fingerprint), zwischen den Kategorien trennt der Ursprung im Hash.
- **Tests:** Alle fetten Pflichttests aus 10.1 bis 10.4 sowie K5 und K6 (wörtlich) sind vorhanden und grün. Dazu gehören die Fixture-Zählung 4/1/1 mit Konflikt `127.0.0.1:2222`, „zweiter Import schreibt nicht“, `remove` aller drei Arten mit anschließender Rückfrage und die Queue.
- **Ledger, Minor F** (`ssh.hostKeysSaveFailed` neben `hostKeySaveFailed`): spec-konform (3.5), unterschiedliche Texte („Verbindung abgebrochen“ nur beim Verbinden). Kein Befund.

## 3. Spec-Abdeckung

| Spec / Anhang | Stand |
|---|---|
| 1a Fensterschutz während der Sperre, R1.1, R1.3, B1 | erfüllt |
| R1.4/M1 Taskleisten-Vorschau | offen, manueller Test für den Nutzer (Ledger), Doku verspricht nichts |
| R1.5 Treiber-Shots während der Sperre | erfüllt (`lock-screen.png` laut Ledger angesehen) |
| 2a Freigabeliste (R2.1, R2.3) | erfüllt, Restpunkt M-2 |
| 2b Drop nur von Laufwerken (R2.2, R2.5) | erfüllt, Main und Renderer |
| 2c `missing()` mit `//` (R2.4) | erfüllt, getestet |
| 3a Verwaltungsansicht (R3.1, R3.7) | erfüllt, Layout bei vielen Einträgen I-1, Fokus M-1 |
| 3b Import (R3.2–R3.6) | erfüllt |
| 3c Fehlerkarte (R3.8) | erfüllt |
| R4 Tokens/keine Bewegung, R5 i18n/format, R6 Version | erfüllt: nur `var(--…)`, alle Texte über `t()`/`mainT`, Zahlen über `formatNumber`, Sortierung `compareText`, Suche `foldCase`, 0.24.0 in `package.json` und an beiden Root-Stellen in `package-lock.json` |
| 5 Doku, B2 CHANGELOG | erfüllt (`## [0.24.0] – 2026-10-25`, 4 Punkte de/en), Präzisierung M-3 |
| 6 run-app (6.0–6.5, K3 Schritt 7) | erfüllt, ohne die Capture-Probe aus 6.1 (R-1) |
| 7 Nicht-Ziele | eingehalten: kein Worker, kein Export, kein Schreiben von `known_hosts`, keine dauerhafte Content Protection |
| 10 Tests | Pflichtteil erfüllt, Ergänzung M-4 |

## 4. Doku

- Handbuch und Manual haben die drei Stellen aus Spec 5. Der Satz zur Taskleisten-Vorschau bleibt, bis M1 entschieden ist.
- Der CHANGELOG hat de und en mit 4 Punkten. `version.test.ts` ist grün.
- Ungenau ist nur die Aufzählung „Host, Port, Typ“ (M-3).

## 5. i18n und Tokens

- Neue Keys gibt es in de-DE und en-US, als volle Literale, ohne `{{count}}`. Main nutzt `mainT('dialogs.importKnownHosts.title')`. Fehler gehen nur als Codes (`core.vaultPathNotAllowed`, `ssh.hostKeyRevoked`, `ssh.hostKeysSaveFailed`).
- `·` und `, ` als Trenner folgen dem Muster in `FilesPanel.tsx`.
- Das CSS (`settings-ui.css:23-35`) nutzt nur vorhandene Tokens und hat keine Bewegung. `design-tokens.test.ts` und `i18n-catalog.test.ts` sind grün.
