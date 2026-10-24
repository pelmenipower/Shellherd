# Import und Update-Hinweis – Nachprüfung Runde 4

Grundlage: Nachprüfung Runde 3 `2026-10-24-import-update-recheck-2.md` (N2 Important, N3 Minor), die Nutzerentscheidung vom 2026-10-25 (Worker mit Zeitlimit) und der Fix-Commit `1fa7191` (`fix(import): parse import sources in a worker with a 5 s limit`).

**Urteil: ready to merge.** Von 2 offenen Befunden sind 2 ADDRESSED. Neu: 0 Critical, 0 Important, 1 Minor (N4, blockiert nicht).

Gates: `npm run typecheck` grün, `npx vitest run` grün (154 Dateien, 2352 Tests). `npx electron-vite build` ohne Fehler.

## 1. Befunde aus Runde 3

| Befund | Status | Beleg |
|---|---|---|
| N2 OpenSSH-Optionen O(Aliasse × Optionen) friert Main ein, Heap > 1 GB | **ADDRESSED** (über die Fix-Richtung des Nutzer-Rulings, nicht im Parser) | `src/main/import-source.ts:174, 180, 198` Alle drei Parse-Aufrufe laufen über `deps.parse`. Der Standard ist `parseInWorker` (`:56`). `:95` `new Worker(path, { resourceLimits: { maxOldGenerationSizeMb: 256 } })`, `:128` Zeitlimit 5000 ms (`:24`). Damit gilt: Der Main-Thread führt keinen Parser-Code mehr aus, und der Heap des Main wächst nicht. Ein OOM trifft nur den Worker (`ERR_WORKER_OUT_OF_MEMORY` → `error`/`exit` → `core.importTooComplex`). Ledger Runde 4: Die 4,1-MB-Datei aus N2 (590 000 `User`-Zeilen + 500 Aliasse) endet nach 2068 ms mit `core.importTooComplex`, Main antwortet währenddessen in 66–91 ms. Die quadratische Last im Parser bleibt bestehen. Laut Ruling ist das akzeptiert: Solche Dateien werden abgelehnt, statt geparst zu werden. |
| N3 Falsche Ursache „höchstens 4 MiB“ bei Budget-Überlauf | **ADDRESSED** | `src/shared/import-openssh.ts:33, 39` werfen `core.importTooComplex`. Die Keys stehen in `src/shared/locales/de-DE/errors/core.json:65` und `en-US/errors/core.json:65`, Parität ist vom Katalogtest geprüft. Der Test `import-openssh.test.ts:281` ist auf den neuen Code angepasst. Zum Wortlaut des neuen Texts siehe N4. |

## 2. Worker-Korrektheit

| Prüfpunkt | Ergebnis |
|---|---|
| `terminate` immer | `finish` (`import-source.ts:120-126`) ist der einzige Abschlussweg für `message`, `error`, `exit` und das Zeitlimit. Er ruft `terminate()` genau einmal auf und löscht den Timer. Ein Worker, der von selbst endet (`parentPort.once`, `import-worker.ts:21`), wird ebenfalls beendet. `terminate` auf einem schon beendeten Worker ist in Node harmlos. Wirft `createWorker` synchron (`:113-118`), gibt es keinen Worker und keinen Timer, also auch kein Leck. |
| `resourceLimits` | `maxOldGenerationSizeMb: 256` ist gesetzt. Young Generation und Code-Space bleiben beim Node-Standard, das ist für das Ziel ausreichend. |
| Antwort genau einmal | Das Flag `settled` in `finish` sorgt dafür. Node stellt alle Nachrichten des Workers vor dem `exit`-Event zu, also überholt ein normales Ende die Antwort nicht. Test `import-source.test.ts` „settles only once“ belegt das. |
| Fehler- und Exit-Pfade | Antwort `ok:false` → `AppError.from(reply.error)` (`:132`), der Code bleibt erhalten (`core.importEncrypted`, `core.importTooComplex` aus dem Budget). Ein Nicht-`AppError` im Worker → `core.importUnreadable` (`import-worker.ts:16`). Absturz, OOM, Exit ohne Antwort und Zeitlimit → `core.importTooComplex`. Leere Antwort → `core.importTooComplex`. Alle Pfade sind mit Fake-Worker getestet. |
| Was in den Worker geht | Nur `{ source, text, home }` (`:137-138`). `home` ist das Home-Verzeichnis als String, das der OpenSSH-Parser schon vorher für die Expansion von `IdentityFile` brauchte. Es gibt keinen Dateipfad der Quelle, keine Secrets und keinen Vault. |
| Pfade und Dateizugriffe im Worker | Keine. Das Bundle `out/main/import-worker-*.js` importiert nur `node:worker_threads` und den Shared-Chunk. Dieser importiert nur `zod`. Es gibt kein `fs`, kein `electron` und kein `child_process`. |
| `AppError`-Weitergabe | `toCoded()` im Worker, `AppError.from` im Main. Der IPC-Weg zum Renderer ist unverändert (siehe Runde 3, Abschnitt 4). |
| Teure Arbeit im Main vor dem Worker | `stat` (Grenze 4 MiB), `readFile`, `decodeImport` (ein `toString` und ein verankertes `replace`), dann das Structured Clone von höchstens ca. 4 Mio. UTF-16-Einheiten. Das ist linear, liegt im Millisekundenbereich und ist vertretbar. |

Restpunkte ohne Befund:
- `messageerror` wird nicht abgehört. Kann eine Nachricht nicht deserialisiert werden, greift erst das Zeitlimit. Mit Klartext-Strings ist das praktisch ausgeschlossen.
- Parallele Importe würden je einen 256-MB-Worker starten. Jeder Import braucht aber einen Klick und einen Dialog, die Lage ist also unkritisch.

## 3. Bundle-Auflösung (`?modulePath`)

`npx electron-vite build` erzeugt `out/main/import-worker-BEfg7zxB.js` (21 kB), den Shared-Chunk `out/main/import-DOfbI9cr.js` und `out/main/index.js`. In `out/main/index.js:8516` steht `const workerPath = join$1(__dirname, "./import-worker-BEfg7zxB.js");`, und `__dirname` ist in `:29` als `import.meta.dirname` definiert (`package.json` `"type": "module"`). Der Pfad zeigt damit auf dieselbe Datei im selben Ordner, auch innerhalb von `app.asar`. Der Ledger belegt den Paket-Test: `electron-builder --dir`, Import über den Worker liefert 4 Kandidaten. Der Worker ist ESM (`import … from`) und liegt in einem `"type": "module"`-Paket, Node lädt ihn daher korrekt als ESM.

## 4. Neue Befunde (nur im Fix-Diff)

### Minor

**N4 – Der Text von `core.importTooComplex` nennt fest „nach 5 Sekunden“, auch wenn der Abbruch einen anderen Grund hat.** Betroffen sind `src/shared/locales/de-DE/errors/core.json:65` („… Shellherd hat das Lesen nach 5 Sekunden abgebrochen.“) und `en-US/errors/core.json:65`.
- Derselbe Code entsteht auch:
  - beim OpenSSH-Schrittbudget (`import-openssh.ts:33, 39`), nach rund 80 ms,
  - beim OOM des Workers, im Ledger nach 2068 ms,
  - bei einem Absturz oder Exit ohne Antwort (`import-source.ts:135-136`),
  - wenn die Worker-Datei fehlt. `new Worker` meldet einen Ladefehler asynchron über `error`, nicht synchron, deshalb erreicht der Zweig `core.importUnreadable` in `:116` diesen Fall nicht.
- **Fehlerszenario:** Der Nutzer wählt die präparierte Datei. Die Meldung erscheint nach 2 s und behauptet einen Abbruch „nach 5 Sekunden“. Bei einem defekten Paket ohne Worker-Datei erscheint sofort dieselbe Meldung, und sie beschuldigt die Datei des Nutzers.
- **Fix-Richtung:** Den Text ohne Zeitangabe fassen, z. B. „Die Importquelle ist zu umfangreich oder beschädigt und wurde nicht gelesen.“ / „The import source is too complex or damaged and was not read.“. Die Hinweise auf 5 Sekunden in CHANGELOG und Handbuch sind als Obergrenze korrekt und können bleiben. Optional: Einen `error` vor jeder Antwort mit `ERR_WORKER_*`-Code außer `ERR_WORKER_OUT_OF_MEMORY` (etwa ein Modul-Ladefehler) auf `core.importUnreadable` abbilden. Das ist kein Merge-Blocker.

## 5. Geprüft ohne Befund

- `import-worker.ts:21` `parentPort?.once` hat keine Seiteneffekte, wenn Tests oder Main das Modul importieren. Der Main importiert aus `import-worker` nur Typen (`import type`, `import-source.ts:15`). Deshalb landet `parentPort` nicht im Main-Bundle.
- `parseImport` (`import-parse.ts`) ist identisch zum alten `parse` und hat vier Dispatch-Tests.
- Die Tests verwenden einen injizierten `deps.parse` (synchron über `parseImport`). Die Worker-Mechanik ist separat mit `FakeWorker` getestet. Den echten Worker belegt der run-app-Lauf aus dem Ledger.
- Sicherheit: Es gibt keinen neuen IPC-Kanal. Gelesen wird weiter erst nach dem Klick, und es geht nichts Neues zum Renderer außer dem Fehlercode. kubeconfig und Secrets sind nicht betroffen.
