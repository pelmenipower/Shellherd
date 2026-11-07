# k8s-direct – Review (nach dem Code)

Geprüft: `git diff origin/staging...HEAD` (11 Commits, `76dfc05`…`750566f`) gegen `2026-11-05-k8s-direct-validation.md` (bindend) und `2026-11-05-k8s-direct-design.md` (D-1…D-8).
Gates nachgeprüft: `npm run typecheck` grün; `npx vitest run src/main/kubernetes src/shared src/renderer/src/connection-form.test.ts src/main/ai/secret-mask.test.ts` → 50 Dateien, 923 Tests grün.

## Urteil

**ready after fixes**: 0 Critical, 1 Major, 4 Minor. Dazu 2 Notizen ohne Fix.

Die Sicherheitskerne halten:
- B-1 ist vollständig.
- Das Exec-Gate liegt im Main und lässt sich nicht umgehen.
- B-2 ist umgesetzt.
- Es gibt keine neuen schreibenden Verben.
- Der SSH-Weg ist unverändert, bis auf die gewollte Verschärfung durch K-5 und `token-file`.

Offen ist eine Umgehung der UNC-Sperre (K-3). Sie wird mit einer Zeile in der gemeinsamen Konstante plus einem Main-Guard behoben.

---

## Sicherheit: Prüfergebnis je Punkt

| Punkt | Ergebnis | Beleg |
|---|---|---|
| B-1 `token-file` auf allen Parse-Pfaden | OK | Einziger Aufruf von `loadFromString` ist `kubeconfig.ts:65` hinter `rejectTokenFiles` (`:51-60`). `listContexts`, `kubeconfigSecrets` und `parseKubeconfig` laufen alle über `load()`. Damit sind SSH-Probe (`ipc.ts:145`), Text-Probe (`:133`), Datei-Probe (`:136`), Session (`session.ts:273`) und AI-Maskierung (`secret-mask.ts:305`) abgedeckt. client-node liest nur `elt.user['token-file']` (`config_types.js:119-127`). Nachgeprüft: Ein YAML-Schlüssel `__proto__` wird bei js-yaml 5.5.0 zur eigenen Eigenschaft und nicht zum Prototyp. `<<` wird nicht gemergt (Core-Schema). `Object.hasOwn` deckt daher alle Wege ab. |
| Exec-Freigabe | OK | Der Vergleich läuft bei jedem Verbinden im Main (`kubeconfig.ts:126-128`) gegen `execCommandLine` des aufgelösten Context-Users. Context-Wechsel, geänderter Text, geänderte env-Werte oder Argumente ergeben eine andere Zeile, also `loginPluginNeedsConsent`. `auth-provider` (auch `name: exec`, `config.exec`, gcp/azure `cmd-path`, oidc, FileAuth) wird bei inline und file vorher abgelehnt. `ExecAuth` gibt es je `KubeConfig`-Instanz (`config.js:90-96`), Token-Cache und `execFn`-Ersatz sind also nicht global. Die Quoting-Eindeutigkeit (K-7) ist geprüft: Weder `=` noch Leerzeichen oder Anführungszeichen kommen ohne JSON-Quoting vor. Die Probe baut nie einen Client (`ipc.ts:130-147`). |
| Vault-Redaktion (B-2) | OK | `connections.ts:45` leert `text` und entfernt `execConsent`, rekursiv über Ordner. Zweitfenster (`window-ipc.ts:84`) und Sperre (`App.tsx:655`) nutzen das. Zweitfenster validieren den Katalog nicht gegen das Schema, daher stört `text: ''` nicht. |
| Keine kubeconfig-Secrets zum Renderer | OK | Datei- und SSH-Probe entfernen `execCommands` (`ipc.ts:136,145`). Fehler tragen nur Codes mit `command` (≤ 200, ohne env) oder `path` (wie eingegeben). `toApiError` gibt keine Rohmeldung und kein stderr weiter. In `src/main/kubernetes` gibt es kein `console.*`. |
| AI-Maskierung inline | teilweise | Siehe F-3. |
| Lokale Pfadprüfung | **Lücke** | Siehe F-1. |
| Nur lesen | OK | `KubeActionRequestSchema` ist unverändert. Es gibt keine neue Aktion und kein neues Verb. Der Fake-Test prüft, dass nur `GET` vorkommt (`fakes.test.mjs`). |
| Exec ohne Klick | OK | Plugins laufen nur in `build()` → `list` beim Verbinden. inline braucht dazu die gespeicherte Freigabe, file läuft ohne (D-5). `windowsHide`, `stdio` mit stdin `ignore` und 60 s Timeout sind gesetzt (`kubeconfig.ts:164-165`). |

## Zusammenspiel und Lebenszyklus: OK

- `session.ts:270-288`: Ohne Host gibt es keinen Tunnel, `port = null`, `hostName` bleibt `undefined`.
- `checkHealth` (`:334`) verbindet ohne Host nie neu. Das steht so in der Doku.
- `teardownLive`/`dispose` funktionieren ohne Host. Die Tests stehen in `session.test.ts:733-783`.
- Terminal, Port-Forward und Logs laufen alle über `KubeApi` und hängen nicht an `access.host`.
- `openTunnel` ohne Host wirft (`ipc.ts:51`, K-18).
- Die Status-Texte ohne Host stimmen: `ClusterView.tsx:370` und `cluster-bar.ts:45`.
- Hin- und Rückweg im Formular für inline und file, Moduswechsel (K-12/K-13) und der Standard für neue Cluster (D-3: `connection-form.ts:91`) sind korrekt. `newClusterFromSsh` bleibt `auto`.
- VaultTree blendet „Zugangs-Host per SSH öffnen“ bei direkten Clustern aus (`VaultTree.tsx:159`).
- Die Adresszeile zeigt „Cluster · direkt“.

## Packaging (Commit 692e8e0): tragfähig

- `js-yaml` 5.5.0 steht exakt in `dependencies` und passt zu client-nodes `^5.1.0`. Der Lockfile hält eine einzige Kopie auf oberster Ebene (`package-lock.json:4305`).
- `externalizeDepsPlugin` (`electron.vite.config.ts:9`) lässt damit `js-yaml` extern.
- electron-builder packt Produktions-Abhängigkeiten. `files` schließt nur `.map/.ts` aus, `js-yaml/dist/*.js|.mjs` bleiben drin.
- Main ist ESM (`"type": "module"`). Unsere Importe und die von client-node lösen beide auf `dist/js-yaml.mjs` auf, also dasselbe Modul. Der Resolve-Test (`kubeconfig.test.ts:426-430`, CJS-Bedingung) bindet weiterhin dasselbe Paketverzeichnis.
- Abgleich aller nackten Importe in `src/main`, `src/preload` und `src/shared` gegen `dependencies`: Jeder Import steht dort. Es wird nichts aus `node_modules` gebündelt, das extern sein müsste.

---

## Befunde

### F-1 (Major, Sicherheit): UNC-Sperre K-3 ist mit `/\server\share\…` umgehbar
- **Ort:** `src/shared/kubernetes.ts:14`. Die Regex wirkt identisch in `src/main/kubernetes/direct.ts:30`, `src/shared/kubernetes-schema.ts:22`, `src/shared/vault/schema.ts:162` und `src/renderer/src/connection-form.ts:222`.
- **Fehlerszenario:**
  - `/(?!\/)` schließt nur `//` aus.
  - Unter Windows gilt `/\server\share\config` als UNC: `path.win32.toNamespacedPath` liefert `\\?\UNC\server\share\config`, nachgeprüft mit Node 24. Der Pfad besteht Schema, Formular, Probe-Schema und `readLocalKubeconfig`.
  - Folgen:
    1. `k8s:probe { path }` oder schon das Verbinden löst eine SMB-Anmeldung an einen fremden Server aus, also NTLM-Hash-Abfluss. Die App schützt sich davor an anderer Stelle ausdrücklich (`docs/handbuch.md:68`).
    2. Policy `file` mit `dir = /\server\share\` führt `exec`-Plugins aus der fremden Freigabe ohne Freigabe-Klick aus (D-5). Relative Befehle werden gegen die Freigabe aufgelöst.
    3. `certificate-authority`, `client-key` und andere Pfade werden von dort gelesen.
- **Fix:**
  1. `KUBECONFIG_LOCAL_PATH = /^(?:~[\\/]|\/(?![\\/])|[A-Za-z]:[\\/])/`.
  2. Defense in depth in `readLocalKubeconfig` nach `expandHome`: `if (process.platform === 'win32' && !/^[A-Za-z]:\\/.test(path.win32.resolve(expanded))) throw unreadable;`. Damit fällt alles weg, was sich nicht zu einem Laufwerkspfad auflöst, ohne dass `stat` aufgerufen wird.
  3. Tests:
     - `'/\\server\\share\\c'` (JS-Literal) als ungültig in `schema.test.ts`, `kubernetes-schema.test.ts` und `connection-form.test.ts`.
     - In `direct.test.ts` ohne `stat`-Aufruf.
     - Für den Guard ein Test mit `process.platform`-unabhängiger Hilfsfunktion, oder `it.runIf(process.platform === 'win32')`.

### F-2 (Minor): `.cmd`/`.bat`-Plugin und Plugin-Timeout enden als generischer „API-Fehler“
- **Ort:** `src/main/kubernetes/kubeconfig.ts:164-165`, `src/main/kubernetes/client-api.ts:102`.
- **Fehlerszenario:**
  - `spawn('x.cmd')` ohne Shell wirft unter Windows synchron `EINVAL` mit `syscall: 'spawn'` und ohne `path` (nachgeprüft).
  - `toApiError` kennt nur ENOENT/EACCES/EPERM mit `path` und liefert deshalb `kubernetes.apiError` („The Kubernetes API reported an error“), obwohl der Server nie angefragt wurde.
  - Typischer Fall: eine kubeconfig mit `command: C:\…\az.cmd`. Die Doku verspricht für diesen Fall einen klaren Hinweis.
- **Fix:**
  1. In `execFn`: `try { return spawn(…); } catch (error) { throw Object.assign(error as object, { path: command }); }`.
  2. In `toApiError` `EINVAL` in die Code-Liste aufnehmen, aber nur zusammen mit `syscall` beginnend mit `spawn`. Dann folgt `loginPluginNotStarted { command }`.
  3. Test in `client-api.test.ts` mit `{ code: 'EINVAL', syscall: 'spawn', path: 'C:/x/az.cmd' }`.

### F-3 (Minor, Sicherheit/Defense in depth): Maskierung fällt für die ganze kubeconfig aus, sobald `load()` ablehnt
- **Ort:** `src/main/kubernetes/kubeconfig.ts:89-102`.
- **Fehlerszenario:**
  - `kubeconfigSecrets` liefert `[]`, wenn `load()` wirft. Das passiert bei einem `token-file`-User irgendwo in der Datei, bei einer kubeconfig ohne `contexts` oder bei einem User ohne `name` (client-node `ActionOnInvalid.THROW`).
  - Solche Texte lassen sich speichern, denn das Schema parst kein YAML. Die `token`-, `password`- und `client-key-data`-Werte der übrigen User landen dann unmaskiert beim KI-Anbieter, sobald sie in Terminal- oder Analyse-Text auftauchen.
- **Fix:**
  - `kubeconfigSecrets` liest direkt das js-yaml-Dokument, ohne client-node: `try { doc = parseYaml(text) } catch { return [] }`.
  - Dann über `users[].user` die String-Werte von `token`, `password`, `client-key-data` und `auth-provider.config.{id-token,refresh-token,client-secret,access-token}` sammeln.
  - Es gibt keine Dateizugriffe, weil client-node nicht beteiligt ist.
  - Test: Eine kubeconfig mit einem `token-file`-User und einem `token`-User maskiert den Token. Eine kubeconfig ohne `contexts` maskiert ihn ebenfalls. Der bestehende Test `': : :'` → `[]` bleibt.

### F-4 (Minor): veraltetes Probe-Ergebnis nach Textänderung
- **Ort:** `src/renderer/src/components/ClusterForm.tsx:55-71`, mit dem Reset-Effekt `:77-78`.
- **Fehlerszenario:**
  - Der Nutzer klickt „Contexts lesen“ und ändert danach Text oder Pfad, bevor die Antwort kommt. Der Effekt setzt zurück, dann überschreibt die alte Antwort `contexts`/`execCommands` und ggf. `context`.
  - Die Checkbox zeigt dann die Befehlszeile der **alten** kubeconfig. Ein Haken speichert eine Freigabe, die nicht passt.
  - Das ist keine Umgehung, denn der Main vergleicht erneut. Der Nutzer bekommt aber verwirrend `loginPluginNeedsConsent`.
- **Fix:** `const probeSeq = useRef(0)`. Der Reset-Effekt erhöht ihn. `readContexts` merkt sich den Wert vor `await` und verwirft das Ergebnis bzw. den Fehler, wenn er sich geändert hat.

### F-5 (Minor, Doku ≠ UI)
- **Ort:**
  - `docs/handbuch.md:533-535, 538-540, 550, 553-560`
  - `docs/manual.md:511-513, 517-518, 528, 531-537`
- **Abweichungen:**
  1. „stellst du unter ‚Zugang‘ von ‚Über SSH‘ auf ‚Direkt‘ um“: Neue Cluster starten nach D-3 bereits auf „Direkt“. Umstellen muss man nur bei Einträgen aus „Als Kubernetes-Cluster einrichten…“ bzw. bei bestehenden SSH-Einträgen.
  2. Die Checkbox „Login-Programm beim Verbinden ausführen: …“ erscheint erst nach „Contexts lesen“ (`execCommands` kommt aus der Probe). Die Fehlermeldung schickt den Nutzer „unter Context“, die Doku sagt nicht, dass er dort zuerst „Contexts lesen“ klicken muss.
  3. Der Absatz davor („Kubeconfigs mit `exec`- oder `auth-provider`-Abschnitten lehnt Shellherd ab“) widerspricht jetzt dem neuen Abschnitt. Er muss auf „über SSH“ eingeschränkt werden.
  4. „nutze eine `.exe` oder den vollen Pfad“: Ein voller Pfad auf eine `.cmd` startet ebenso wenig. Gemeint ist: Programmname ohne Endung (sucht `.exe` im PATH) oder voller Pfad zu einer `.exe`.
- **Fix (wörtlich, de):**
  - zu 1: „Neue Cluster-Einträge starten unter „Zugang“ auf „Direkt“; Einträge über SSH stellst du dort auf „Direkt“ um.“
  - zu 2: an den Satz zur Bestätigung anhängen: „Die Bestätigung erscheint, nachdem du „Contexts lesen“ geklickt hast.“
  - zu 3: „Über SSH lehnt Shellherd Kubeconfigs mit `exec`- oder `auth-provider`-Abschnitten ab, …“
  - zu 4: „nutze eine `.exe` (Programmname oder voller Pfad).“
- **Fix (en):** sinngemäß gleich:
  - „New cluster entries start with “Access” set to “Direct”; switch entries that go through SSH there.“
  - „The confirmation appears after you click “Read contexts”.“
  - „Through SSH, Shellherd rejects kubeconfigs with …“
  - „use an `.exe` (program name or full path).“
  - Die genaue Beschriftung von „Read contexts“ stammt aus `en-US/connection.json` `cluster.context.read`.

---

## Notizen (kein Fix)

- **N-1 (Ruling-Vorschlag):** Commit 692e8e0 fasst `package.json`/`package-lock.json` an. Das widerspricht dem Satz „Kein Task fasst `package.json` … an (D-1)“ und macht akzeptiertes Restrisiko 4 gegenstandslos. Die Abweichung ist richtig, weil sie den Absturz behebt und die Abhängigkeit ehrlich deklariert. Als Ruling festhalten: „js-yaml 5.5.0 ist direkte Abhängigkeit; der Resolve-Test bleibt als Wächter gegen eine zweite Kopie.“
- **N-2:** Gemappte Netzlaufwerke (`Z:\…`) bestehen die Pfadprüfung weiterhin. Shellherd kann sie nicht zuverlässig von lokalen Laufwerken unterscheiden, und der Nutzer hat sie bewusst eingebunden. Restrisiko akzeptiert. Die Doku nennt nur UNC.

---

## Fix-Welle (eine Welle, zwei Umsetzer, Dateien disjunkt)

| Umsetzer | Befunde | Dateien (exklusiv) |
|---|---|---|
| **A – Main/Shared** | F-1 (Regex, Guard, Main-/Shared-Tests), F-2, F-3 | `src/shared/kubernetes.ts`, `src/main/kubernetes/direct.ts`, `src/main/kubernetes/direct.test.ts`, `src/shared/vault/schema.test.ts`, `src/shared/kubernetes-schema.test.ts`, `src/main/kubernetes/kubeconfig.ts`, `src/main/kubernetes/kubeconfig.test.ts`, `src/main/kubernetes/client-api.ts`, `src/main/kubernetes/client-api.test.ts` |
| **B – Renderer/Doku** | F-1 (nur Formular-Test), F-4, F-5 | `src/renderer/src/connection-form.test.ts`, `src/renderer/src/components/ClusterForm.tsx`, `docs/handbuch.md`, `docs/manual.md` |

- B's Formular-Test für F-1 hängt an A's Regex in `src/shared/kubernetes.ts`. Der Orchestrator führt `npx vitest run` deshalb erst nach beiden Umsetzern aus. Alternativ legt B den Test erst nach A an.
- Es kommen keine neuen Locale-Keys und kein CSS dazu.
- Nach der Welle: `npm run typecheck`, `npx vitest run`. Für F-4 reicht die bestehende run-app-Szene `kube-direct` als Sichtprüfung.
