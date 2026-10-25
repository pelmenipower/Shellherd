# Härtung – Nachprüfung Runde 2

Grundlage:
- Review `2026-10-25-haertung-review.md` (I-1, M-1 bis M-4)
- Ledger `.superpowers/sdd/2026-10-25-haertung/progress.md` (Ruling: alle vier Minor mitfixen)
- Fix-Diff `c7c6596..b3bbb50`: `72fdbf2` (I-1, M-1) und `b3bbb50` (M-2, M-3, M-4)

**Urteil: ready** – 5 Befunde geprüft: 5 ADDRESSED, 0 PARTIAL, 0 NOT ADDRESSED. Neu: 0 Critical, 0 Important, 1 Minor (N-1, nicht blockierend).

Gates: `npm run typecheck` ist grün. `npx vitest run` ist grün mit 161 Dateien und 2488/2488 Tests, 11 Tests mehr als im Review (2477).
Live: Ich habe den Shot `%TEMP%\shellherd-run\shots\host-keys-small.png` (Probe des Orchestrators, 62 DOM-Zeilen) angesehen. Kopf, Suchfeld und Import-Knopf stehen oben, die Liste hat einen eigenen Scrollbalken, „2 von 2“ und `Schließen` stehen unten im Dialog. Der Fokusring des Suchfelds wird nicht abgeschnitten. Eine eigene Treiber-Probe war nicht nötig. Es wurden weder ein echter Vault noch `%APPDATA%\Shellherd` noch `~/.ssh` geöffnet.

---

## Befundtabelle

| Befund | Status | Beleg |
|---|---|---|
| I-1 Dialog scrollt als Ganzes | ADDRESSED | `settings-ui.css:28` `.known-hosts-list`: `flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: var(--space-2)`. `settings-ui.css:36` `.known-hosts-dialog[open] { display: flex; flex-direction: column; overflow: hidden; }`. Das ist spezifischer als Zeile 2, `max-height` bleibt erhalten, `.settings-dialog` bleibt unverändert. Es gibt nur Tokens und keine Bewegung (`design-tokens.test.ts` grün). Absicherung in `screens.mjs:795-801`: `overflowY === 'auto'` und `Schließen`-`bottom <= innerHeight`, sonst wirft die Szene. Live gemessen vom Orchestrator: `Schließen` bei y 855 von 900, siehe Shot. Rest bei sehr kleinem Fenster siehe N-1. |
| M-1 Fokus fällt nach Import auf `body` | ADDRESSED | `KnownHostsDialog.tsx:18` `importRef`, `:80` am Knopf. `:52-54` im `finally`: `setPending(false)` und danach `requestAnimationFrame(() => importRef.current?.focus())`. Das gilt auch beim Abbrechen, weil `return` im `try` das `finally` durchläuft, und auch beim Fehler. Schließt `afterLock` den Dialog vorher, ist die Ref `null` und es passiert nichts. Der optionale Teil (Live-Region immer rendern) ist nicht umgesetzt. Das Review hatte ihn als optional markiert. |
| M-2 Unicode-Faltung im Freigabeschlüssel | ADDRESSED | Details unten. `recent-vaults.ts:22` `grantKey = win32.resolve(p).replace(/[A-Z]/g, …)`. Alle Freigabe-Vergleiche laufen darüber, `recentKey` ist unverändert. Tests mit echtem U+212A: `path-grants.test.ts:50-54`, `:70-72`, `recent-vaults.test.ts:8-13`, `:52-56`, `ipc.test.ts:50-54` (Ende-zu-Ende über `vaultDropFile` → `unlockVault`). |
| M-3 Doku „Typ“, gehashte Einträge | ADDRESSED | `handbuch.md:618` und `manual.md:607` haben jetzt wörtlich die Fassung aus dem Review: „Host und Port (gehashte Einträge: …), Typ bei importierten Einträgen“ und den Satz zum Fingerprint aus `expected`. Laut Review bleiben die Kartentexte unverändert, `terminal.json` musste also nicht angefasst werden. |
| M-4 kein Handler-Test `known-hosts-ipc.ts` | ADDRESSED | Neue Datei `src/main/ssh/known-hosts-ipc.test.ts` mit 5 Tests: Liste bei gesperrtem Vault, `remove('x')` → `core.invalidRequest` ohne Store-Zugriff, K4 (Sperre während des Dialogs → kein `stat`/`readFile`/`importKeys`), Größenlimit → `core.importTooLarge` ohne `readFile`, Abbruch → `{ canceled: true }` ohne `stat`. Alle Fälle aus der Fix-Richtung sind abgedeckt. Nicht getestet ist die Ablehnung durch den Wächter „Hauptfenster“ (`requireMain` ist ein leerer Mock). Das Review hat diesen Fall nicht verlangt, deshalb kein Befund. |

---

## M-2 im Detail (Sicherheit)

### Nutzen alle Freigabe-Vergleiche `grantKey`?

Ja. Einen Pfad freigeben oder vergleichen kann nur `VaultPathGrants` bzw. `vaultPathAllowed`. Per Grep habe ich alle Stellen in `src/main` geprüft:

| Weg | Stelle | Schlüssel |
|---|---|---|
| Dialog-Grant | `vault/ipc.ts:168` → `VaultPathGrants.grant` (`path-grants.ts:11`) | `grantKey` |
| argv beim Start | `index.ts:220` → `grant` | `grantKey` |
| argv bei `second-instance` | `index.ts:228` → `grant` | `grantKey` |
| Drop | `vault/ipc.ts:72` → `grant` | `grantKey` |
| Prüfung der Freigabe | `path-grants.ts:12` `has`, aufgerufen in `path-grants.ts:28` | `grantKey` |
| Gesperrter Pfad | `path-grants.ts:29` | `grantKey` auf beiden Seiten |
| `RecentVaults.has` | `recent-vaults.ts:70-72` | `grantKey` auf beiden Seiten |

Der einzige Aufrufer ist `vault/ipc.ts:194`. Er läuft vor `vaultSessionManager.unlock`, also vor jedem Dateizugriff. Andere Aufrufer von `recentKey` in einem Freigabevergleich gibt es nicht mehr.

### Bleibt `recentKey` für die Dedup unverändert?

Ja. `recent-vaults.ts:15-19` ist unverändert (Unicode-`toLowerCase`, plattformabhängig). Es wird nur noch in `touch` (`:77-78`, Dedup) und `recentId` (`:26`) benutzt. Damit bleiben die Ids der Liste und `removeRecentVault` stabil. `grantKey` liegt in `recent-vaults.ts` und wird aus `path-grants.ts:6` re-exportiert. So entsteht kein Importzyklus.

### Wird ein legitimer Pfad jetzt fälschlich abgelehnt?

Nein, für alle normalen Wege nicht. Der Grund: Der Renderer schickt nur Pfade zurück, die er vorher vom Main buchstabengleich bekommen hat.

- **Umlaute im Ordnernamen** (`C:\Übergabe\v.term`): Dialog, argv und Drop geben genau den String frei, den der Main dem Renderer zurückgibt (`ipc.ts:72-73`, `:168-171`, `index.ts:228-229`). Der Renderer sendet ihn unverändert an `unlockVault`. `grantKey` ist deterministisch, also trifft gleich auf gleich. Für ASCII-Groß/Klein (`C:\Vaults` gegen `c:\vaults`) gilt die Faltung weiter (Test `path-grants.test.ts:44-48`).
- **Eintrag in `recentVaults` mit anderer Schreibweise**: `list()` gibt `entry.filePath` roh heraus (`toView`, `:32`). Klickt der Nutzer den Eintrag an, kommt genau dieser String zurück, und `has` vergleicht ihn mit genau diesem String. Abweichen kann die Schreibweise nur bei veraltetem Renderer-Zustand. Ein Beispiel: Die Liste zeigt `C:\ärger\v.term`. Der Nutzer öffnet im selben Lauf über den Dialog `C:\Ärger\v.term`, und `touch` ersetzt den alten Eintrag per `recentKey`-Dedup durch die neue Schreibweise. Klickt er danach in einer nicht neu geladenen Liste auf den alten String, lehnt der Main mit `vaultPathNotAllowed` ab. Früher hätte `recentKey` beide als gleich gewertet. Dafür müssen zwei Schreibweisen derselben Datei existieren, die sich nur bei einem Nicht-ASCII-Buchstaben im Groß/Klein unterscheiden, und die Liste muss veraltet sein. Der Dialog liefert in der Regel die Schreibweise auf der Platte. Folge ist eine Meldung statt eines Lecks, ein erneuter Klick nach dem Neuladen der Liste funktioniert. Das ist die gewollte Härte von M-2 und kein Befund.
- **`lastVaultFile` beim Start**: `latest()` (`:56-61`) gibt `entry.filePath` roh zurück, und `has` liest dieselbe Quelle (`entries()`). Das gilt auch für den einmaligen Seed aus `last-vault.json` (`:95-104`), denn `has` und `latest` gehen beide über `entries()` → `seed()`. Der String ist auf beiden Seiten identisch.
- **Gesperrter Vault**: `previous.filePath` ist `snapshot.filePath`, also der String aus dem letzten erfolgreichen `unlockVault`. Der Sperrbildschirm schickt ihn zurück. Identisch.
- **Unicode-Normalisierung (NFC/NFD)**: Daran ändert sich nichts. Auch `recentKey` hat nicht normalisiert.
- **Nicht-Windows**: `grantKey` nutzt immer `win32.resolve`. Weil Vergleich und Freigabe dieselbe Funktion nutzen, ist das symmetrisch. Shellherd läuft nur unter Windows, und die Tests sind auf der CI grün.

### Restgrenze

Das Kelvin-Szenario aus dem Review ist geschlossen. Andere Nicht-ASCII-Unterschiede (zum Beispiel `ß`/`ẞ`, griechische und kyrillische Buchstaben) faltet `grantKey` gar nicht mehr, also kann keiner davon eine Freigabe erschleichen. Der Rohpfad, den `unlock` öffnet (V-R1: `\\?\` + `win32.resolve`), unterscheidet sich vom geprüften Schlüssel jetzt nur noch in ASCII-Groß/Klein. NTFS und SMB-Hostnamen behandeln ASCII-Groß/Klein gleich.

---

## Neue Befunde aus dem Fix-Diff

### Critical
Keine.

### Important
Keine.

### Minor

**N-1 Bei sehr kleinem Fenster und langer Konfliktliste ist `Schließen` abgeschnitten** – `src/renderer/src/settings-ui.css:36` (`overflow: hidden`), `:27` (`.known-hosts-message`), Inhalt `KnownHostsDialog.tsx:82-85`
- Szenario:
  - Der Dialog schneidet jetzt ab, statt zu scrollen. Schrumpfen kann nur die Liste (`min-height: 0`). Die Meldung behält als Flex-Kind `min-height: auto` und wird nie kleiner als ihr Inhalt.
  - Konflikte sind auf 20 Hosts begrenzt (`known-hosts.ts:203`), nicht aber in der Länge. Beim Mindestfenster des Hauptfensters (600 px, `index.ts:108`) bleiben laut Shot-Geometrie nach Abzug von etwa 220 px für Kopf, Werkzeugzeile und Fußzeile rund 330 px für Meldung und Liste. Übersteigt die Konfliktzeile etwa 14 Zeilen (20 FQDNs mit je ungefähr 55 Zeichen), liegen „N von M“ und `Schließen` unter dem Dialogrand und lassen sich nicht erreichen.
  - Escape schließt weiterhin. Der Zustand verschwindet beim nächsten Import oder beim Schließen. Vor dem Fix ließ sich in diesem Fall noch scrollen.
- Fix-Richtung (Eigentümer `settings-ui.css`, nur vorhandene Tokens): `.known-hosts-message { flex: 0 1 auto; min-height: 0; overflow: auto; }`. Dann schrumpft die Meldung mit und scrollt selbst, und die Fußzeile bleibt stehen. Alternativ die Fußzeile mit `flex-shrink: 0` absichern und dem Dialog bei Überlauf `overflow: auto` zurückgeben. Nicht blockierend.

---

## Abschluss

Alle fünf Befunde sind behoben und belegt. M-2 ist geschlossen, ohne die Dedup-Semantik oder die Ids der Liste zu ändern. Kein normaler Öffnungsweg (Dialog, argv, Drop, Liste, `lastVaultFile`, Sperrbildschirm) wird fälschlich abgelehnt. Die Gates sind grün. N-1 ist ein Randfall des Layouts ohne Sicherheitsbezug.

**Urteil: ready.**
