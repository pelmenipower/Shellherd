# k8s-direct – Nachprüfung der Fix-Welle

Geprüft: `1ec8288` (F-1, F-2, F-3) und `fdc389e` (F-4, F-5) gegen `2026-11-05-k8s-direct-review.md`.
Gates: typecheck und volle Suite laut Orchestrator grün (2950 Tests). Nachgeprüft mit `npx vitest run src/main/kubernetes src/main/ai src/shared/kubernetes-schema.test.ts src/shared/vault/schema.test.ts src/renderer/src/connection-form.test.ts`: 23 Dateien, 497 Tests grün.

## Urteil

**i.O.**: 0 Critical, 0 Major, 1 Minor (nicht blockierend). Dazu 1 Notiz.

| Befund | Status | Beleg |
|---|---|---|
| F-1 (Major) UNC über `/\server` | **ADDRESSED** | Regex `src/shared/kubernetes.ts:14` = `/^(?:~[\\/]\|\/(?![\\/])\|[A-Za-z]:[\\/])/`. Sie wirkt über dieselbe Konstante in `direct.ts:30`, `kubernetes-schema.ts`, `vault/schema.ts:162` und `connection-form.ts`. Main-Guard: `direct.ts:32-33` nach `expandHome` und vor `stat`. Tests mit `'/\\server\\share\\c'`: `direct.test.ts:44` (`stat` nicht aufgerufen), `kubernetes-schema.test.ts:220`, `vault/schema.test.ts:67`, `connection-form.test.ts:206`. |
| F-2 (Minor) `.cmd`-EINVAL | **ADDRESSED** (Umfang laut Fix-Vorgabe) | `kubeconfig.ts:167-171` hängt `path: command` an den synchronen Spawn-Fehler. Der Fehler wird im Promise-Executor von client-node geworfen (`exec_auth.js:79-83`) und kommt damit als Rejection an. `client-api.ts:102` nimmt `EINVAL` nur zusammen mit `syscall` `spawn*`. Test `client-api.test.ts:113-115` deckt den positiven Fall ab, dazu den Negativfall `syscall: 'open'` → `apiError`. Zum Timeout siehe N-1. |
| F-3 (Minor) Maskierung | **ADDRESSED** | `kubeconfig.ts:89-105` liest das YAML direkt mit `parseYaml`. Es gibt keinen client-node-Aufruf und keinen Dateizugriff, nur `token`, `password`, `client-key-data` und `auth-provider.config.{id-token,refresh-token,client-secret,access-token}`. Diese Schlüssel entsprechen dem alten Satz (`keyData` ⇔ `client-key-data`). Tests: `kubeconfig.test.ts:142` (token-file plus anderer User → `['t']`) und `:257-261` (token-file-User plus Token-User, ohne `contexts`). `': : :'` → `[]` bleibt (`:255`). |
| F-4 (Minor) veraltete Probe | **ADDRESSED** | `ClusterForm.tsx:34`: `probeSeq`. Der Reset-Effekt erhöht ihn (`:39`). `readContexts` verwirft bei geänderter Sequenz sowohl Erfolg (`:63`) als auch Fehler (`:69`). `finally { setProbing(false) }` läuft auch beim frühen `return`, die Schaltfläche bleibt also nicht gesperrt. `context` steht nicht in den Effekt-Deps, deshalb setzt das eigene `onChange({ context })` die Sequenz nicht zurück. |
| F-5 (Minor) Doku | **ADDRESSED** | Alle vier Punkte sind wörtlich übernommen, de `docs/handbuch.md:532, 538-539, 557, 559-560`, en `docs/manual.md:511, 517-518, 534, 536-537`. „Read contexts“ stimmt mit `en-US/connection.json:230` überein. |

## Regressionsprüfung

Die Regex und der Guard wurden mit Node 24 und `path.win32.resolve` nachgerechnet. Die Home-Expansion lief wie `expandHome` mit `C:\Users\x`.

| Eingabe | Regex | Guard | Ergebnis |
|---|---|---|---|
| `C:\Users\x\.kube\config` | ok | ok | angenommen |
| `c:/Users/x/.kube/config` | ok | ok | angenommen |
| `~/.kube/config` | ok | ok | angenommen |
| `~\.kube\config` | ok | ok | angenommen |
| `/home/u/.kube/config` | ok | Linux: Guard entfällt; Win32: wird zu `C:\home\u\…` aufgelöst | angenommen |
| `/\server\s\c`, `//server/c`, `\\server\s`, `\\?\C:\x`, `\\.\C:\x` | abgelehnt | abgelehnt | abgelehnt |
| `/??/UNC/s/c`, `C:\..\..\server\share`, `~/\server\s`, `/x/../\server` | ok | ok | wird zu `C:\…` aufgelöst, also lokal und harmlos |

- **Guard:** Er lehnt keinen legitimen Laufwerkspfad ab. Er greift nur unter `win32`, und Linux-Pfade erreichen ihn nie.
- **F-3:** Kein Dateizugriff, denn `parseYaml` ist reines Parsen. Der Typ wird defensiv geprüft (`Array.isArray`, Objektprüfung). Multi-Dokument-YAML oder ungültiges YAML ergibt wie bisher `[]`.
- **F-4:** Gültige Ergebnisse gehen nicht verloren, denn verworfen wird nur, wenn sich Quelle, Text, Pfad oder Host seit dem Klick geändert haben. In diesem Fall setzt der Effekt ohnehin alles zurück.
- **F-2:** Asynchrone Spawn-Fehler (ENOENT über das `error`-Event) laufen unverändert. `Object.assign` überschreibt nur `path` des geworfenen Fehlers.

## Verbleibende Befunde

### R-1 (Minor, Testlücke): Der Win32-Guard selbst ist ungetestet
- **Ort:** `src/main/kubernetes/direct.ts:33`, `src/main/kubernetes/direct.test.ts`.
- **Fehlerszenario:** Der neue `/\server`-Fall in `direct.test.ts:44` wird schon von der Regex abgefangen. Der Guard läuft in keinem Test. Die Review hatte dafür eine plattformunabhängige Hilfsfunktion oder `it.runIf(process.platform === 'win32')` verlangt. Würde der Guard später versehentlich gelockert oder entfernt, bliebe die Suite grün. Heute ist er laut obiger Tabelle reine Defense in depth, weil keine Eingabe die Regex besteht und am Guard scheitert.
- **Fix-Richtung:** `it.runIf(process.platform === 'win32')` mit einer gemockten `KUBECONFIG_LOCAL_PATH`-Lücke ist aufwendig. Einfacher ist es, die Prüfung als `resolvesToDrive(p)` zu exportieren und mit `'\\\\server\\s'` → false sowie `'C:\\x'` → true zu testen. Das blockiert nicht.

## Notiz

- **N-1:** Der Titel von F-2 nennt auch den Plugin-Timeout. Die Fix-Vorgabe der Review deckte nur EINVAL ab. Ein Timeout endet weiter als `kubernetes.apiError`, weil client-node bei `close` ohne Exit-Code `new Error(stderr)` verwirft (`exec_auth.js:101`). Es fließen keine Rohdaten zum Renderer. Das Restrisiko ist akzeptiert (nur der Hinweis ist ungenau), ein Folgeticket ist optional.
