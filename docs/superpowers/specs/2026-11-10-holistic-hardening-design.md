# H3.1 – Ganzheitliche Härtung (Design und Plan)

Stand: 2026-11-10. Branch `claude/feature/holistic-hardening`, gestapelt auf `claude/feature/device-keys` (PR #46).

Quelle: ganzheitlicher Review von vier Prüfern (Server, Sync-Kryptografie, Fernansicht, App-Grenze). Die Befundberichte liegen lokal unter `.superpowers/sdd/2026-11-10-holistic-review/{server,sync,remote,app}.md`. Sie sind die Detailspezifikation: Befund-ID, Ort, Szenario, Fix-Vorschlag und Testidee. Diese Spec legt fest, **was** davon in H3.1 umgesetzt wird, und trifft die Entscheidungen.

## 0. Rulings

- **R-H31-1 Umfang:** Alle Major-Befunde (S1, S2, S4, C1, C2, C3) und die Minor-Befunde, die sich ohne Architekturumbau beheben lassen. Architekturpunkte gehen nach H4 (Abschnitt 3).
- **R-H31-2 Lab-Bruch erlaubt** (wie R-H3-3): Das Nachweisformat ändert sich (Origin-Bindung, C1). Alte Einschreibungen werden ungültig, und die Geräte schreiben sich neu ein. Es gibt keinen Kompatibilitätspfad.
- **R-H31-3 Origin-Konfiguration:** Der Server bekommt die öffentliche Origin ausschließlich über `SHELLHERD_SERVER_ORIGIN` (z. B. `https://sync.example.home`). Er nutzt nie den Host-Header. Im Modus `enrolled-device` ist der Wert Pflicht, ohne ihn startet der Server nicht. Der Client nimmt die normalisierte Origin der vom Nutzer eingegebenen URL (`new URL(u).origin`, ohne Slash am Ende).
- **R-H31-4 Gerätenamen:** Es gibt genau eine Regel, `src/shared/device-name.ts` (TS) mit `scripts/sync-prototype/device-name.mjs` (mjs) und einem Paritätstest.
  - Erlaubt: Unicode-Buchstaben, Ziffern, Leerzeichen und `-_.,()'`, nach NFC-Normalisierung, Länge 1–64.
  - Verboten: alle Steuer- und Formatzeichen (Cc, Cf, also auch Bidi und Zero-Width), Zl/Zp und eine Folge von 8 oder mehr Hex-Zeichen. Hex wird verboten, damit niemand einen Prüfcode im Namen fälschen kann.
  - Server (Einschreiben), Sync-Host, Remote-Host (`deviceSchema`) und Renderer nutzen diese Regel. Bisherige Kopien (R5, A10) entfallen.
- **R-H31-5 Passwortraten (S4):** Beide Maßnahmen gelten.
  - (a) Eine harte globale Obergrenze von 20 fehlgeschlagenen Passwortprüfungen je 10 min. Danach antwortet der Server allen mit 429 bis zum Fensterende.
  - (b) `account-init` nimmt eigene Passwörter erst ab 20 Zeichen an. Der Standard bleibt das generierte Passwort. Altkonten unter 20 Zeichen bekommen beim Start eine Warnung, die zu `rotate-password` auffordert.
- **R-H31-6 Electron-Fuses (A6):**
  - Jetzt: `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`.
  - Erst nach einem Windows-Signaturtest durch den Nutzer: `enableEmbeddedAsarIntegrityValidation` und `onlyLoadAppFromAsar`. Sie stehen als offene Punkte im PR.
- **R-H31-7 Neuer Wiederherstellungscode (C2/A1):** Die Funktion verpackt weiterhin denselben Sync-Schlüssel neu. Die echte Rotation kommt in H4. Texte und Handbuch sagen ehrlich: „Der alte Code öffnet die Keybox nicht mehr. Wer eine alte Kopie der Serverdaten und den alten Code hat, kann weiter lesen. Echter Schutz erst mit Schlüsselrotation (H4).“ Vor dem Erzeugen kommt eine Rückfrage im Dialog.
- **R-H31-8 CGNAT (C12):** 100.64/10 bleibt erlaubt, weil Tailscale diesen Bereich nutzt. Die Doku nennt das Risiko bei Provider-CGNAT.
- **R-H31-9:** Keine CHANGELOG-/Versionsänderung (Lab).

## 1. Umsetzung je Befund

| ID | Was | Task |
|---|---|---|
| S1 | Server-Grundlast: `connectionsCheckingInterval: 1000`, `headersTimeout` ≤ 5 s, Lesefrist 3 s für Bodies vor der Authentisierung (`readJson`), `maxConnections` 256, höchstens 4 offene Requests je Quelle im Handler (greift auch hinter dem Proxy). Doku im Threat-Model (T7). | T1 |
| S2 | Zustandslose Challenges: `nonce = ts ‖ rand ‖ HMAC(serverSecretRAM, ts‖rand)`, Gültigkeit 30 s. Verbrauchte Nonces kommen bis zum Ablauf in eine Menge, die nur gültige Nonces aufnimmt. Wird die Menge zu groß (4096), verdrängt der Server die älteste. Ein globaler 429-Deckel auf ausgegebene Challenges entfällt. Das Budget je Quelle bleibt. | T1 |
| S3 | `SHELLHERD_SERVER_TRUSTED_PROXY` nimmt eine Adresse oder CIDR-Liste (IPv4/IPv6). Der Server nutzt XFF nur, wenn `socket.remoteAddress` darin liegt. Der alte Wert `1` wird abgelehnt: Fehler beim Start mit Hinweis. Compose/README zeigen das Projekt-Netz (feste Subnetz-Definition in compose). Hinweis auf Docker Engine ≥ 28. | T1 |
| S4 | R-H31-5 | T1 |
| S5 | Offline-Befehle `main.mjs list-devices` und `main.mjs revoke-device <id>` (nur bei gestopptem Server, gleicher atomarer Roster-Schreibpfad). README-Ablauf nach einem Passwortleck: `rotate-password`, unbekannte Geräte widerrufen, Server starten. | T1 |
| S6 | Beim Start Temp-Dateien (`*.tmp-*` o. ä. nach tatsächlichem Muster in `file-store.mjs`) älter als 1 h entfernen. Ein defektes Objekt verhindert den Start nicht mehr, es wird übersprungen und protokolliert (ohne Inhalt). | T1 |
| S7 | Server-README an den Code angleichen (Sitzungs-Backoff, `deviceWrites`, Verbindungslimit, neue Variablen). | T1 |
| S8/V3/R5/A10 | R-H31-4. Server prüft beim Einschreiben. | T1 (Modul, Server), T5/T6 (Hosts) |
| S9 | `send` prüft `headersSent`/`writableEnded`. | T1 |
| S10 | Das generierte Passwort geht nicht ins Container-Log. Es wird einmalig in eine Datei mit Rechten 0600 im Datenverzeichnis geschrieben (`initial-password.txt`), und das Log nennt nur den Pfad. Die Datei wird beim ersten erfolgreichen Einschreiben gelöscht. | T1 |
| C1 | Server-Origin (R-H31-3) in `enrollmentBody`, `sessionProof` und `requestProofV2` (device-proof.mjs, Client und Server). Der Server vergleicht mit `SHELLHERD_SERVER_ORIGIN`. Test: zwei Server mit derselben `serverId`, ein Nachweis für A wird bei B mit 401 abgelehnt. | T1 |
| C1 (App) | `signIn` lehnt bei gesetztem `enrolledElsewhere` mit eigenem Code ab. Ein eigener Bestätigungsschritt im Dialog (Checkbox plus deutlicher Text „Ein fremder Server kann sich als dein Server ausgeben …“) erlaubt die Neueinschreibung. Der Pin wird über `(serverId, serverOrigin)` geschlüsselt, nicht über `serverId` allein. | T5 (Host/Dialog), T6 (`identity.ts`) |
| C2/A1 | R-H31-7 und eine Bestätigung im Dialog. `regenerateRecoveryCode` verweigert, wenn im Konto ein Versionsumschlag liegt, der sich unter dem eigenen Schlüssel nicht öffnen lässt (eigener Code → UI-Text „Im Konto liegen Daten eines anderen Sync-Schlüssels …“). Die fremde Keybox bleibt erhalten. | T2 (Kern), T5 (Dialog/Texte) |
| C3/R2 | `abortBootstrap` nimmt die eigene Keybox und die eigenen hochgeladenen Versionen zurück (best effort) und löscht den Checkpoint. `versionsHeld` entfällt. Der bestehende Test `vault-sync.test.ts:320` wird umgedreht. `removeForeignObjects` löscht unlesbare **Versionsumschläge** nicht mehr, nur Altformat-Objekte. | T2 |
| C4/R1 | Die alte Keybox wird zuerst entfernt. Nur Erfolg oder 404 setzt den Lauf fort, sonst endet er mit unveränderter Markierung. Danach erst kommen die neue Markierung, das `put` und die Bestätigung, ohne `old` in der erlaubten Menge. Code laut sync.md C4. | T2 |
| R3 | Abbruch während `settle()`: Steht der Code schon fest und ist die Markierung entfernt, wird der Code dennoch zurückgegeben (Abbruchsignal nach dem Entfernen der Markierung nicht mehr prüfen). | T2 |
| R4 | 429 aus renew/roster ergibt `syncBusy`/`rateLimited` (vorhandener Code, falls nicht vorhanden: einen neuen anlegen), nicht `syncLimit`. | T5 |
| C5 | Import verlangt ein Vault-Passwort mit mindestens 8 Zeichen (gleiche Regel wie die Vault-Anlage, Konstante wiederverwenden). | T2 (Kern-Check), T5 (Dialog) |
| C6 | `.sync-state.lock` enthält PID und Zeit. Lebt die PID nicht mehr oder ist die Sperre älter als 10 min, gilt sie als verwaist und wird ersetzt. | T2 |
| C7 | Das Timeout skaliert mit der Größe: 5 s plus 1 s je 64 KiB Body, höchstens 30 s. | T1 (Transport) |
| C8 | Der Checkpoint merkt sich `serverId`. Passt er nicht, kommt ein eigener Code mit Text „Sync-Zustand gehört zu einem anderen Server“ statt `wrongVault`. | T2 (Kern), T5 (Text) |
| C9 | `compacts` zurückgehaltener Versionen entschuldigen nichts mehr. | T2 |
| C10 | Import: Die Vault-ID wird deterministisch bestimmt (die von der neuesten lesbaren Version, Gleichstand nach ID sortiert). | T2 |
| C11, A7, A8, A3 | Threat-Model aktualisieren (Datum, veralteter Abschnitt „vereinfachter Kontosync“, Widerruf, S1-Hinweis). Handbuch: Flag, Entwicklungsstatus, Einschränkung „Prüfung vor dem Senden“, Linux-only. Der Einstiegsknopf bekommt „(Entwicklung)“ (Text in T5). | T7 |
| A2 | Nicht-Linux: eigener Code `syncPlatform` mit ehrlichem Text. | T5 |
| A4 | Pairing-Altcode entfernen (lab-host, lab-ipc, shared/sync-lab.ts, `device-enrollment.mjs`, CSS-Klassen). `enabled` bindet an `probe && createAccount && identity`. Der Dispatcher validiert über `discriminatedUnion`, Unbekanntes ergibt `invalid`. | T5 (`device-enrollment.mjs`-Löschung in T1) |
| A5 | `scripts/smoke-linux.mjs` startet das gepackte Linux-Paket mit beiden Lab-Flags plus `SHELLHERD_REMOTE_CAPTURE_FAKE=1` und prüft `syncLabEnabled === false`, `remoteLabEnabled === false` und `remoteCaptureFake === false`. Zusätzlich prüft er, dass `ELECTRON_RUN_AS_NODE=1 shellherd -e 'process.exit(7)'` nicht 7 liefert. | T4 |
| A6 | R-H31-6 in `electron-builder.yml`. | T4 |
| A9 | `sync-lab:action` in `IPC_CHANNELS`, Kommentare angleichen. | T5 |
| V1 | Viewer schließt eine vorhandene `RTCPeerConnection`, bevor er eine neue anlegt. Der Host lässt je Sitzung nur ein Angebot durch, weitere beenden die Sitzung. | T3 |
| V2 | Der Host merkt sich frühe `stopped`-Belege auch vor dem Sitzungsende. Die Notbremse feuert nur, wenn kein Beleg vorliegt. Test: ein `accept`-Fehler nach Zustimmung crasht den Renderer nicht. | T3 |
| V4 | Agent `addTransceiver(track, {direction:'sendonly'})`, Viewer `recvonly`. `checkSdp`: Angebot genau `a=sendonly`, Antwort genau `a=recvonly`, sonst `fail('direction')`. | T3 |
| V7 | Globale Bremse: Nach 3 abgelehnten oder abgelaufenen ungeprüften Anfragen innerhalb von 10 min verwirft der Host alle weiteren ungeprüften bis zum nächsten `goOnline` still. Geprüfte Pins sind ausgenommen. | T3 |
| V9 | Der Fensterschutz endet erst, wenn die Stopps bestätigt sind oder die Notbremse ausgelöst hat. Der Timer dient nur als Obergrenze (> `byeMs`). | T3 |
| V10 | `RendezvousPeer.forget(sessionId)`. Der Host ruft es für Viewer-Sitzungen ohne Kanal auf. Ein volles Limit ergibt `limit` statt `connection`. | T1 (Client-Modul), T3 (Aufruf) |

## 2. Wellen und Dateien

Jede Task besitzt nur ihre Dateien. Tests liegen neben den Dateien und gehören zur Task.

**Welle 1 (parallel)**
- **T1 Server und Skripte:** `scripts/sync-prototype/**` (inkl. neuem `device-name.mjs`, Löschen von `device-enrollment.mjs`, `rendezvous-client.mjs` für V10), `server/**`, `src/shared/device-name.ts` (+ Test, Paritätstest gegen die mjs), `.claude/skills/run-app/rendezvous.mjs` und `.claude/skills/run-app/sync-scene.mjs` (Origin-Variable setzen).
- **T2 Sync-Kern:** `src/main/sync-prototype/vault-sync.ts`, `vault-sync-state.ts`, `vault-sync-crypto.ts`, `vault-merge.ts` und deren Tests. Neue `SyncFailure`-Codes werden als String-Literale eingeführt, die T5 in `shared` aufnimmt. Den T2-Report mit der Liste der neuen Codes muss T5 lesen.
- **T3 Fernansicht:** `src/renderer/src/remote-peer.ts`, `src/shared/remote-signal.ts`, `src/main/remote/lab-host.ts` (außer `deviceSchema`-Namensprüfung, die macht T6 in Welle 2), `src/main/remote/presence.ts`, `src/main/index.ts` (nur V9-Schutzende) und die zugehörigen Tests.
- **T4 Paket:** `electron-builder.yml`, `scripts/smoke-linux.mjs`, ggf. `scripts/linux-after-pack.cjs`.

**Welle 2 (parallel)**
- **T5 Sync-App-Fläche:** `src/main/sync-prototype/lab-host.ts`, `lab-ipc.ts` (+ Tests), `src/shared/sync-lab.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` (falls nötig), `src/renderer/src/components/SyncLabDialog.tsx` (+ Test), `src/renderer/src/sync-lab.css`, `src/renderer/src/sync-lab-view.ts`, **alle Locale-Dateien** `src/shared/locales/*`.
- **T6 Remote-App-Fläche:** `src/main/remote/identity.ts` (Pin über `(serverId, origin)`), `src/main/remote/lab-host.ts` (nur `deviceSchema` und `NAME` → `device-name.ts`), `src/main/remote/lab-ipc.ts`, `src/renderer/src/components/RemoteLabDialog.tsx` (Regex → `device-name.ts`), die zugehörigen Tests. Neue Texte meldet T6 im Report, T5 legt sie an. T6 braucht voraussichtlich keine.

**Welle 3**
- **T7 Doku:** `docs/plans/selfhosted-threat-model.md`, `docs/handbuch.md`, `docs/manual.md`, `scripts/sync-prototype/README.md` (nur Abschnitte, die T1 nicht angepasst hat), `.claude/skills/run-app/SKILL.md` (Origin-Variable, neue Befehle).

Nach jeder Welle müssen `npm run typecheck` und `npx vitest run` grün sein, danach je Task ein Commit. Am Ende laufen zusätzlich `node server/smoke.mjs`, `sync-scene.mjs` und `remote-scene.mjs`.

## 3. Bewusst nach H4 verschoben

- V5: Fernansicht in ein eigenes Fenster bzw. eine eigene `WebContentsView` ohne Vault-Preload.
- V6: Aufnahmeschutz der nativen RDP-Flächen (Windows).
- V8: Mindestwartezeit im nativen Dialog.
- C2: Echte Schlüsselrotation (Epochen), damit widerrufene Geräte und alte Codes nichts mehr lesen.
- A11: Die beiden Zustandsmaschinen der Geräteanmeldung vereinheitlichen.
- A12: Szenen in CI.
- A5-Option: Build-Konstante, die die Lab-Pfade aus Release-Bundles entfernt.
- A6-Rest: R-H31-6.
- Bereits geplant: Einschreibecodes, TOTP, Roster-TOFU.
