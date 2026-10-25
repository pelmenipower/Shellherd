# KI-Maskierung – Review (Stufe 5)

Branch `claude/feature/ki-maskierung` gegen `claude/feature/haertung` (11 Commits, `127b789..79ed760`).
Grundlage: Spec `2026-10-25-ki-maskierung-design.md`, der bindende Anhang `…-validation.md` (B1–B3, K1–K11, V-R1–V-R6) und das Ledger `.superpowers/sdd/2026-10-25-ki-maskierung/progress.md`.

**Urteil: ready** – 0 Critical, 0 Important, 5 Minor. Die Minor-Befunde können als Folgepaket kommen. M-1 und M-2 sollten vor dem nächsten Ausbau der Maskierung erledigt werden.

Gates: `npm run typecheck` grün, `npx vitest run` grün (162 Dateien, 2524/2524). Der mfa-Flake trat nicht auf.
Der Arbeitsbaum ist sauber, die Läufe gelten also für `79ed760`.

Proben (nur synthetisch, alle Dateien im Scratchpad):
- Masker direkt unter Node 24 mit 25 Formaten (siehe M-3) und 11 feindlichen Eingaben zu je 256 KiB: höchstens 48 ms (`kind: Secret` plus 40 000 `data:`-Zeilen).
- Wachstum eines Maskers über 60 Runden zu je 40 Nachrichten mit 20 000 Funden je Runde (siehe M-2).
- Treiber-Shots `assistant-masked.png`, `ai-provider-masking.png` und `assistant-masking-off.png` angesehen. Zu sehen sind „Vertrauliche Werte maskiert: 14“, `PGPASSWORD='[SECRET_3]'` mit dem Hinweis „Enthält maskierte Werte …“ und der Schalter im Formular.

Es wurde weder ein echter Vault noch `%APPDATA%\Shellherd` geöffnet. Der Treiber wurde nicht bedient, nur seine Shots wurden gelesen.

---

## 1. Sicherheit

### Engpass: Kein Text erreicht den Anbieter ohne `prepare`

Ergebnis: dicht.
- **Aufrufer von `streamChat`.** Es gibt genau zwei, beide in `assistant.ts`:
  - `:101` (`ask`) sendet nur `chat` aus `prepare` (`:96`).
  - `:133` (`test`) sendet nur die festen Katalogtexte `assistant.test.system`/`assistant.test.user`. Erreichbar ist es nur aus dem Hauptfenster (`ipc.ts`, `registry.requireMain`).
  - `httpRequests`, `streamHttp` und `streamAnthropic` sind modulintern. Andere `fetch`-Aufrufe in Main tragen keine Inhalte (Validierung §5, unverändert).
- **Reihenfolge in `ask`.** Erst kommen `busy` und `requestRunning`, dann `provider()` und `prepare()`, danach `running.set` und das Senden. Wirft `prepare`, gibt es weder `running`-Eintrag noch Ereignis noch Stream (Test `sends nothing when the masker fails`).
- **Fehlerpfad im Masker.** `catch {}` verwirft den Fehler samt Text und wirft nur `AiError('ai.maskFailed')` ohne Detail (`assistant.ts:86-89`).
  - `secrets()` liegt nach V-R5 bewusst außerhalb des `try`. Gesendet wird trotzdem nichts.
- **Retry und Fallback.** Azure probiert mehrere `HttpCall`s nacheinander (`providers.ts:111`), aber jeder mit demselben, bereits maskierten Body. Ein erneutes Fragen aus dem Panel läuft wieder über `ai:ask` → `prepare`.
- **Abbruch.** `cancel`, `cancelOwner` und `cancelAll` setzen nur `abort()`. Nichts wird erneut gesendet.
- **Vollständigkeit.**
  - `system` (Regeln plus `target`) und jede `messages[i].content` werden maskiert, unabhängig von der Rolle.
  - `AskSchema` ist `.strict()` und hat kein Feld, mit dem der Renderer die Maskierung abschalten könnte. Ob maskiert wird, entscheidet Main allein aus `provider.maskSecrets` im Vault (`assistant.ts:77`).

### Klartext in Main

Ergebnis: kein Klartext in Fehlern, Logs oder `AiError`-Details.
- `secret-mask.ts` hat kein I/O. `src/main/ai` enthält kein `console.*`.
- `ai.maskFailed` trägt keine Parameter.
- `error.detail` (`providers.ts:110`) stammt aus der Antwort des Anbieters auf den **maskierten** Body. Bei abgeschalteter Maskierung wäre ein Echo Klartext, der aber nur zum Renderer geht, der ihn ohnehin hält. Das ist die Wahl des Nutzers.
- `userError` und Electrons Handler-Log sehen nur `AppError`-Codes.
- Es gibt keine Rückübersetzung. Die Zuordnung ist `private` in `SecretMasker` und ohne Getter, `masked` trägt nur `count`.

### Lebensdauer der Masker

Ergebnis: entspricht V-R2. Einschränkung LRU siehe M-1.

| Weg | Aufrufstelle | Wirkung |
|---|---|---|
| Fenster schließen | `index.ts:94`, `:180`, `:192`, `:197`, `:200`; `window-ipc.ts:219` → `closeOwnerSessions` (`index.ts:80-85`) | `assistant.cancelOwner(ownerId)` (`:84`) löscht alle Schlüssel `${ownerId}/…` |
| Renderer-Absturz | `index.ts:130` `render-process-gone` | wie oben |
| `destroyed` / Navigation im Hauptframe | `index.ts:132`, `:134` | wie oben |
| Vault-Wechsel oder neuer Vault | `vault/ipc.ts:130`, `:203` (außer beim Fortsetzen desselben gesperrten Vaults) → `onSessionChange` (`index.ts:366`) → `closeAllSessions` | `assistant.cancelAll()` (`index.ts:86`), `maskers.clear()` |
| Trennen (`lockVault` mit `disconnect: true`) | `vault/ipc.ts:241` | wie oben |
| Beenden | `index.ts:434` `will-quit` | wie oben |
| Sperre ohne Trennen, Auto-Sperre | `index.ts:367`, `:374` | Masker bleiben (V-R2, so gewollt) |
| `Verlauf leeren` | nur im Renderer: neue `conversationId` (`AssistantPanel.tsx:257`) | der alte Masker bleibt bis LRU, Fenster oder Trennen (V-R3) |

Der Präfixvergleich `${ownerId}/` verwechselt Fenster 1 nicht mit 12. Der Test `keeps placeholders per conversation and forgets them …` deckt `cancelOwner` und `cancelAll` ab.

### `vaultLiterals`

Ergebnis: Alle geheimen Vault-Felder sind erfasst.
- Folgende Felder werden gelesen:
  - `Authentication.password` von SSH und SFTP (`types.ts:11`)
  - `Authentication.passphrase` von SSH und SFTP (`:16`)
  - `RdpConnectionNode.password` (`:116`)
  - `AiProvider.apiKey` aller Anbieter (`:206`)

  Das geschieht in Ordnern jeder Tiefe, ab 6 Zeichen und ergänzt um die URL-kodierte Form (`secret-mask.ts:217-237`).
- **Kubernetes-Token** stehen nicht im Vault. `KubernetesConnectionNode.kubeconfig` ist nur `auto` oder ein Pfad, die kubeconfig verlässt Main nie. Erscheint ein Token im Terminal, etwa nach `kubectl config view --raw`, greifen die Regeln. Probe: `token: …` wird zu `[SECRET_1]`, `client-key-data: LS0tLS1CRUdJTi…` ebenfalls (über base64-PEM). SA-Token sind JWTs.
- Weitere geheime Felder hat das Schema nicht. `login.commands` und `Workflow.command` sind keine Geheimnisfelder. Das Vault-Passwort selbst und Antworten auf Anmelde-Rückfragen stehen als Grenze im Handbuch.

### Masker: ReDoS und Grenzen

- **ReDoS.** Jede Regex wurde einzeln nachgeprüft wie in Validierung §5. Keine hat verschachtelte Quantoren, Lookbehinds sind begrenzt. K1 nutzt eine Vorausschau von 66 Zeichen statt `indexOf`.
  - Eigene Proben auf 256 KiB: `-----BEGIN `, `a=`, `a: `, `a://`, `x://a:a:…@`, END ohne BEGIN × 5 000, `kind: Secret` mit 40 000 Zeilen, `eyJaaaaaaaaa.`, `Bearer \t`, `password="` und `password=<`. Alle liegen zwischen 6 und 48 ms.
  - Das einzige wachsende Teil ist die Liste `numbers` selbst (M-2).
- **Handbuch gegen Code.** Diese Angaben stimmen:
  - 6 Zeichen: `MIN_LITERAL_LENGTH`, `trim()`
  - 4.096 Zeichen: `MAX_VALUE`
  - 1.000 bekannte Werte: `MAX_KNOWN`
  - `;`/`&` ohne Anführungszeichen: `BARE_END`
  - `/ ? #` in Adressen: `AUTHORITY_END`
  - 6 000/8 000 Zeichen: `SCREEN_CHARS`/`OUTPUT_CHARS`
  - Kurzoptionen und Fließtext

  Das Manual entspricht K11 wörtlich (Zeilenabgleich ohne Abweichung). Nicht im Handbuch steht nur der LRU-Verlust (M-1).
- **Lücken bei gängigen Formaten:** siehe M-3. Keine davon widerspricht dem Handbuch, denn die Aufzählung der erkannten Formate ist abschließend formuliert.

### Renderer-Fixes

- **`rangeText`** (`terminal-access.ts:49-62`):
  - Der Anfang geht bis zur ersten Zeile eines umbrochenen Blocks zurück.
  - Umbrochene Zeilen werden verbunden, nur die letzte Zeile eines Blocks wird rechts getrimmt.
  - Offen ist das Ende: Folgt auf die Cursorzeile eine Fortsetzungszeile, endet der Text mitten in der Zeile (M-4).
- **`tail`** (`assistant-chat.ts:44-49`): Es beginnt immer nach einem Zeilenumbruch. Einzige Ausnahme ist eine einzelne Zeile, die länger ist als der Ausschnitt. Das ist Spec-Risiko 3 und steht im Handbuch.
- **`compactMessage`** (`:74-79`): Es kürzt am letzten Umbruch vor 600 Zeichen. Aufgerufen wird es nur für `outputMessage`, deren Kopf immer einen Umbruch hat (`AssistantPanel.tsx:169`, `:246`). Ohne Umbruch in den ersten 600 Zeichen bliebe nur ein Kopf mit einem über 590 Zeichen langen Modell-Befehl. Dieser enthält nur Platzhalter. Kein Befund.

### Panel

- **„Eintippen“** → `typeIntoTerminal` → `insertableCommand`. Das Ergebnis ist eine Zeile, Steuerzeichen werden entfernt, und es gibt **kein** `\r`/`\n` (`assistant-chat.ts:35-41`, `terminal-input.ts`). Ein Befehl mit `[SECRET_n]` wird also nie selbst ausgeführt.
- Der Hinweis `panel.maskedCommand` erscheint, sobald `SECRET_PLACEHOLDER` passt und keine andere Notiz anliegt (`AssistantPanel.tsx:230-231`).
- Kopf der Ausgabe-Rückmeldung ist der eingetippte Text (`awaiting.command`), nicht die vom Nutzer ergänzte Zeile. Ein selbst eingesetztes Passwort kommt dort also nicht hinein. In der Ausgabe darunter greifen die Regeln.

### Formular

- Der Schalter ist ein `checked={draft.maskSecrets !== false}`. Eingeschaltet setzt er `undefined`, ausgeschaltet `false` (`AiSettingsDialog.tsx:117-122`). Ein altes Vault ohne Feld zeigt deshalb „an“, und Main maskiert (`!== false`).
- Das Schema ist `z.boolean().optional()` (`schema.ts:257`). Beim Speichern fällt `undefined` beim Serialisieren weg.
- Downgrade: Spec-Risiko 7 gilt (sichere Richtung).
- In der Liste steht „Maskierung aus“ (K7 wörtlich). Das Panel zeigt `panel.maskingOff` aus dem Katalog (`masking`), nie den Schlüssel (Test `tells windows whether masking is on, never the key`).

### Szene und Fixtures

- Der vorgegebene Grep über die Diff findet nur die Spec-Zeilen 1212 (`'-----BEGIN OPENSSH PRIVATE KEY-----'` im Codeblock der Spec) und 1371 (Testbeschreibung). Beides ist ohne Schlüsselrumpf und nach Validierung §5 hingenommen.
- In `.claude/skills/run-app/*.mjs` und `src/main/ai/*.ts` gibt es keinen Treffer. `DEMO_SECRETS` und die Tests bauen jedes Token aus Teilen zusammen.
- Der erweiterte Grep aus Validierung §5 (`github_pat_`, `AIza`, `sk-ant-`, `sk-proj-`, Webhook, JWT) ist leer.
- Das Protokoll `ai-requests.jsonl` liegt in `RUN_DIR`. Es enthält nur synthetische Werte, wird vor und nach der Szene gelöscht und nie mit Headern geschrieben.

### Bekannter Minor aus dem Ledger („`masked` zählt nur neue Nummern der letzten Nachricht“)

Bewertung: **kein Befund, die Beschreibung im Ledger ist ungenau.**
- `placeholder()` fügt jede verwendete Nummer zu `used` hinzu, auch eine bereits bekannte (`secret-mask.ts:186-191`). `count` ist also die Zahl der **verschiedenen** Platzhalter in der letzten Nachricht, alte wie neue. Genau das verlangen Spec 3.3 („`count` zählt die verschiedenen Platzhalter darin“) und 10.2.
- Der Verlauf zählt bewusst nicht mit (Test `reports nothing when only the history had secrets`). Funde im Systemprompt zählen ebenfalls nicht. Das passt, denn der Hinweis steht unter der Frage.
- Sieht der Nutzer dieselbe `.env` zweimal, steht zweimal „14“. Das ist richtig, denn die Nachricht enthielt 14 maskierte Werte.

---

## Issues

### Critical

Keine.

### Important

Keine.

### Minor

**M-1 LRU-Verdrängung löscht bekannte Werte still, entgegen dem Handbuch** – `src/main/ai/assistant.ts:12`, `:66-73`; `docs/handbuch.md:189`, `docs/manual.md:188`
- Ursache:
  - `MAX_CONVERSATIONS = 32` gilt **global** über alle Fenster, und jeder Tab mit Assistent ist eine Unterhaltung. Ab der 33. Unterhaltung wird der älteste Masker verworfen, ohne dass Renderer oder Nutzer davon erfahren.
  - Das Panel schickt nur die letzten 12 Nachrichten mit (`historyForRequest`, `assistant-chat.ts:82`).
- Szenario:
  - In Tab A steht in Runde 1 `DB_PASSWORD=Hunter2-Synth`. Der Wert wird maskiert und ist danach bekannt.
  - Nach mehr als 6 Runden fällt diese Nachricht aus dem Verlauf. Später erscheint `mysql -pHunter2-Synth` (Kurzoption ohne Muster) und ist nur über den bekannten Wert verdeckt.
  - Hat der Nutzer inzwischen in 32 anderen Tabs gefragt, ist der Masker von A weg. Der Wert geht dann im Klartext hinaus, und die Platzhalter werden neu nummeriert.
  - Das Handbuch verspricht: „Ein einmal erkannter Wert bleibt im ganzen Verlauf verdeckt …; Shellherd merkt sich dafür je Verlauf die letzten 1.000 erkannten Werte“.
- Fix (Eigentümer `assistant.ts`): `MAX_CONVERSATIONS` auf 256 anheben. Der Speicher je Masker ist nach M-2 begrenzt, und `cancelOwner` räumt beim Schließen des Fensters ohnehin auf. Die Doku ergänzt einen Grenzpunkt:
  - Handbuch: „mehr als 256 Verläufe in einer Sitzung: Shellherd vergisst dann die bekannten Werte des ältesten,“
  - Manual: „more than 256 histories in one session: Shellherd then forgets the known values of the oldest one,“

  Eigentümer der Doku sind `docs/handbuch.md` und `docs/manual.md`.
- Test (`assistant.test.ts`): Nach 33 Unterhaltungen beginnt die erste wieder bei `[SECRET_1]`. Der Test hält die Grenze fest und schützt vor stillen Änderungen.

**M-2 `numbers` wächst je Unterhaltung unbegrenzt, und der Durchgang über bekannte Werte baut die Liste je Nachricht neu** – `src/main/ai/secret-mask.ts:184`, `:188`, `:210`
- Ursache: K4 deckelt nur die **Suche** (`slice(-MAX_KNOWN)`). Die Map behält jeden Fund für die Lebensdauer der Unterhaltung. `[...this.numbers.keys()].filter(…)` kopiert sie bei **jedem** `mask`-Aufruf, also bis zu 41-mal je Anfrage.
- Beleg (Probe, 40 Nachrichten je Runde, 20 000 Funde in der letzten):
  - Runde 10: 208 ms, +13 MB Heap.
  - Runde 30: 401 ms, +37 MB.
  - Runde 60: 700 ms, +72 MB.

  Das ist linear und ohne Obergrenze, mal 32 Masker. Der Pflichttest (12 Runden mit je **einer** Nachricht) sieht das nicht.
- Szenario: Fremdbestimmte Terminalausgabe mit automatischem Einordnen hält Main über viele Runden zunehmend synchron auf. Alle Fenster stocken.
- Fix (Eigentümer `secret-mask.ts`, minimal):
  - Neben `numbers` eine Liste `recent: string[]` der Werte ab 6 Zeichen führen. `placeholder()` hängt neue Werte an, und bei mehr als `MAX_KNOWN` Einträgen wird vorne gekürzt. Die Suche läuft über `recent`, sortiert nach Länge, statt über `numbers.keys()`.
  - `numbers` deckeln, z. B. `MAX_NUMBERS = 50_000`. Bei Überlauf wirft `mask` einen Fehler, und `prepare` macht daraus `ai.maskFailed` (fail-closed, nichts wird gesendet). Der Nutzer leert dann den Verlauf.
- Test (`secret-mask.test.ts`): 60 Runden mit 40 Aufrufen. Die letzte Runde bleibt unter 1 000 ms, und nach dem Deckel kommt `ai.maskFailed` statt eines Sendens.

**M-3 Lücken bei gängigen Formaten** – `src/main/ai/secret-mask.ts:19-46`
- Beleg (Probe, jeweils `new SecretMasker().mask(t, [])`). Diese Eingaben bleiben unverändert:
  - `.netrc`: `machine db login app password Synth-Pw-123`. Der Wert folgt dem Namen nach einem Leerzeichen, ohne `=`/`:` und ohne `-`.
  - PowerShell: `ConvertTo-SecureString "Synth-Pw-123" -AsPlainText -Force`. Bei `-Password (ConvertTo-SecureString -String "Synth-Pw-123")` maskiert `FLAG` sogar `(ConvertTo-SecureString`, und das Passwort bleibt stehen. Das ist für eine Windows-App mit PowerShell-Tabs ein typischer Fall.
  - PuTTY-Schlüssel (`.ppk`): `PuTTY-User-Key-File-3: …`, `Private-Lines: N` und base64-Zeilen. Der Rumpf geht hinaus. Unter Windows ist das das häufigste Format privater Schlüssel.
  - `Cookie: session=…` und `Set-Cookie: sessionid=…`: Sitzungs-Cookies sind Zugangsdaten.
  - Feste Präfixe ohne Regel: GitLab `glpat-`, Stripe `sk_live_`/`rk_live_`, npm `npm_` (nur ohne Namen; `_authToken=` greift).
- Handbuch und Manual zählen die erkannten Formate abschließend auf. Es gibt also keinen Widerspruch, aber gängige Fälle fehlen.
- Fix (Eigentümer `secret-mask.ts`, je eine lineare Regel, plus Doku):
  - `.netrc`: `/(?<=(?:^|[ \t])password[ \t]{1,8})[^\s]{1,4096}/gim`
  - PowerShell: `/(?<=ConvertTo-SecureString[ \t]{1,8}(?:-String[ \t]{1,8})?)(["'])[^"'\r\n]{1,4096}\1/gi`, gemeint ist nur der Inhalt in Anführungszeichen. Dazu in `pairSpans`: Ein `FLAG`-Wert, der mit `(` beginnt, ist kein Wert (`continue`, wie bei `-`).
  - PPK: In einer eigenen Funktion nach `Private-Lines: \d{1,4}` die folgenden base64-Zeilen bis `Private-MAC:` maskieren. Sie läuft linear wie `pemSpans`.
  - `SECRET_NAME` um `cookie|session(?:[_-]?id)?|sid` erweitern. Danach `max_tokens`/`secretName`-artige Falsch-Positive prüfen (`sessionName` endet nicht auf `session`).
  - `TOKEN_RULES` um `glpat-[A-Za-z0-9_-]{20,255}`, `[sr]k_live_[A-Za-z0-9]{20,255}` und `npm_[A-Za-z0-9]{36}` ergänzen, mit Grenz-Lookbehind wie bei `gh…`.
  - Tests in `secret-mask.test.ts` für jede Form, aus Teilen gebaut (R13). Die Laufzeiteinheiten bekommen `password `, `ConvertTo-SecureString "`, `Private-Lines: 1\n` und `glpat-` dazu.
  - Die Aufzählung in Handbuch, Manual und CHANGELOG wird erst erweitert, wenn die Regeln da sind.

**M-4 `rangeText` schneidet am Ende einer umbrochenen Cursorzeile** – `src/renderer/src/terminal-access.ts:53-55`
- Ursache: `to` ist immer `cursorLine()` (`:71`, `:75`). Für `index === to` gilt `continued = false`. Fortsetzungszeilen **nach** dem Cursor werden nicht gelesen, die letzte Zeile wird getrimmt.
- Szenario: Der Nutzer tippt eine lange Zeile, etwa `PGPASSWORD=… psql …` über mehrere Terminalzeilen, und geht mit den Pfeiltasten in eine frühere Zeile zurück. Dann fragt er den Assistenten. Ein Wert, der über die Zeilengrenze am Cursor läuft, geht als Bruchstück hinaus. Ist die Namensregel vorn, wird das Bruchstück maskiert. Sonst, z. B. bei einem Token ohne Namen, geht der Anfang des Tokens unmaskiert hinaus.
- Fix (Eigentümer `terminal-access.ts`): Am Anfang von `rangeText` das Ende vorziehen, solange Fortsetzungszeilen folgen:
  ```ts
  let end = to;
  while (end + 1 < buffer.length && buffer.getLine(end + 1)?.isWrapped === true) end += 1;
  ```
  Danach `end` statt `to` in der Schleife verwenden.
- Test (`terminal-access.test.ts`): `rangeText(lines(['abc', false], ['def', true]), 0, 0)` ergibt `'abcdef'`.

**M-5 Die Platzhalter-Prüfung der Szene ist wirkungslos** – `.claude/skills/run-app/screens.mjs:370`
- Ursache: Der Systemprompt enthält bei aktiver Maskierung immer die Zeile `assistant.prompt.masked` mit dem Literal `[SECRET_1]` (`main.json`). Deshalb passt `/\[SECRET_\d+\]/.test(masked)` auf jedes Protokoll, auch wenn der Masker in den Nachrichten nichts ersetzt hätte.
- Wirkung gering: Den eigentlichen Beweis tragen die Leckprüfung über alle 14 `DEMO_SECRETS` (`:366-367`) und der Hinweis „Vertrauliche Werte maskiert:“ (`:364`).
- Fix (Eigentümer `screens.mjs`): Nur die Nutzer-Nachrichten prüfen.
  ```js
  const userText = masked.trim().split('\n').map(line => JSON.parse(line)).flatMap(body => body.messages.filter(m => m.role === 'user').map(m => m.content)).join('\n');
  if ((userText.match(/\[SECRET_\d+\]/g) ?? []).length < 14) throw new Error('Zu wenige Platzhalter in den Nutzer-Nachrichten');
  ```

---

## 2. Korrektheit (geprüft, ohne Befund außer oben)

- **Vertrag:** `shared/ai.ts` (`masking`, `conversationId` als Pflichtfeld, `masked`-Ereignis, `SECRET_PLACEHOLDER`), `types.ts` und `schema.ts` entsprechen Spec 3.1. `AskSchema` hat `conversationId: z.string().uuid()` (V-R1).
- **Masker:** `secret-mask.ts` entspricht Spec 3.2 mit K1 (`:55`), K2 (`:43`, `:177-180`, `:197-213`), K3 (`:151-157`) und K4 (`:8`, `:210`) wörtlich.
- **Service:** `assistant.ts` entspricht 3.3 mit K5. `ipc.ts` verdrahtet `secrets: () => vaultLiterals(…)` (3.4).
- **Panel:** Es entspricht 3.6 mit K6, nämlich `Fragment`-Import, `conversationIds`, `userEntryId`, `masked`-Ereignis, Hinweise sowie `Verlauf leeren` mit neuer Id. Die Anbieterliste und der `.ai-check`-Block entsprechen K7.
- **Tests:** Die Pflichtfälle aus 10.1 bis 10.4 sowie K9 und K10 (B, R und C wörtlich) sind vorhanden und grün. Dazu gehören die Fixture mit 14 Platzhaltern, K1 bis K4, die Flutung, 1 000 Literale, `vaultLiterals`, `rangeText`, `tail` und `compactMessage`, die sechs Service-Tests sowie die Fake-Tests mit Protokoll und Masker-Fixture.
- **Platzhalter im Prompt:** Der Systemprompt enthält `[SECRET_1]` als Beispiel. Der Masker überspringt es (`PLACEHOLDER`, `replaceOutside`), deshalb wird nichts doppelt ersetzt.

## 3. Spec-Abdeckung

| Spec / Anhang | Stand |
|---|---|
| 1a Vault-Literale | erfüllt (alle Geheimnisfelder des Schemas) |
| 1b bekannte Werte je Unterhaltung | erfüllt, Deckel K4. Grenzen: LRU (M-1) und Wachstum (M-2) |
| 1c Musterregeln (PEM, Name=Wert, URL, Bearer/Basic, AWS, GitHub, Slack, OpenAI/Anthropic, Google, Azure, JWT, base64-PEM, Secret-`data:`) | erfüllt, mit B2/K1 und B3/K3. Weitere Formate in M-3 |
| 3.3 Engpass `prepare`, fail-closed, `masked`-Ereignis | erfüllt |
| 3.4 IPC `conversationId`, `secrets` | erfüllt |
| 3.5 Renderer-Lecks (`rangeText`, `tail`, `compactMessage`) | erfüllt, Restfall am Cursorende (M-4) |
| 3.6 Panel-Hinweise, kein Auto-Enter | erfüllt |
| 3.7 Schalter je Anbieter, Standard an, alte Vaults | erfüllt |
| 3.8 Texte de/en | erfüllt, `i18n-catalog.test.ts` grün |
| 5 Doku und CHANGELOG 0.25.0 | erfüllt (K11 wörtlich, `version.test.ts` grün). Ergänzung durch M-1 |
| 6 run-app `masking` | erfüllt, Shots angesehen. Prüfung schärfen (M-5) |
| 7 Nicht-Ziele (keine Rückübersetzung, `aicli` ausgenommen, kein IPC für `Verlauf leeren`) | eingehalten |
| V-R1 bis V-R6 | eingehalten |
| R13 Secret Scanning | erfüllt (nur hingenommene Spec-Zeilen) |

## 4. i18n und Tokens

- Neue Keys gibt es in de-DE und en-US an den Stellen aus Validierung §6:
  - `assistant.prompt.masked`
  - `ai.maskFailed`
  - `panel.masked`, `panel.maskedCommand`, `panel.maskingOff`
  - `settings.maskSecrets`, `settings.maskSecretsHint`, `settings.maskingOff`
  - geändert: `settings.intro`

  Platzhalter ist `{{amount}}` über `formatNumber`. Main nutzt nur `mainTFor`.
- `.ai-check` nutzt nur vorhandene Tokens und hat keine Bewegung. `design-tokens.test.ts` ist grün.
