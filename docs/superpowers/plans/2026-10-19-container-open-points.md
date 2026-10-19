# Container-Features – offene Punkte abschließen (Recherche)

Stand: 2026-10-19 · Branch `claude/fix/container-open-points` (HEAD `81f2ad2`, Arbeitsbaum sauber) · Version bleibt 0.9.0

> Auftrag: „schließe die offenen punkte ab“ – P1–P7 aus `cv-final-review.md` (M6, M8, N1, N2), `cv-final-rereview.md` (N1, N2), `cve-final-review.md` (M4, M5) und `cve-final-rereview.md` (N1).

Bindend bleiben `2026-10-18-container-view-validation.md` und `2026-10-18-container-view-entries-validation.md`, soweit diese Recherche sie nicht ausdrücklich ablöst (Abschnitt 9 nennt die drei Stellen). Alle Sicherheitsregeln (Befehlsbau nur im Main aus festen Teilen, kein `-f`/`--force`/`prune`, Passwort nur über `runWithSudo` mit Sperre nach Ablehnung, Kube-Dateien, `session.ts`, `TerminalPanel.tsx`, `containers-schema.ts`, Preload und IPC-Kanäle unverändert) gelten weiter.

## 0. Urteil in einem Satz

Alle sieben Punkte sind klein genug für eine Fix-Welle ohne neue IPC, ohne Schema- und ohne Spec-Umbau: zwei Main-Änderungen (P1, P6, gemeinsam in `discovery.inventory`), drei reine Auslagerungen mit Tests (P2, P3, P4), eine Zwei-Zeilen-Korrektur (P5) und Doku (P7 plus die Texte, die P1 und P6 im README falsch machen).

## 1. Bestand und Lücken

| Punkt | Wert | Aufwand | Bestand (Beleg) | Lücke |
|---|---|---|---|---|
| P1 sudo einmal je Poll | ★★★ | kleine Main-Änderung | `discovery.ts:115-119` ruft je Art `run(rt, kind)`, bei SSH `discovery.ts:132` → `runWithSudo` je Liste. `runWithSudo` (`sudo-run.ts:14-32`) baut je Aufruf `remoteCommand(argv, …)` mit `sudo -S -p <marker> -v` (`commands.ts:33-37`), holt das Gate (`sudo-run.ts:20`) und sendet das Passwort (`runner.ts:96-98`). | Vier Anmeldungen, vier Gate-Wartezeiten, vier Exec-Kanäle je Poll. README `:165-166` dokumentiert „viermal“. |
| P2 Scheduler-Test | ★★ | nur Renderer | `useContainerInventory.ts:29-48` (`load`), `:50-53` (`alive`), `:58-64` (Schlüssel-Effekt). Kein Test (`src/renderer/src/hooks/` hat keine `*.test.ts` dazu). | Logik hängt an Refs im Hook, nicht testbar ohne React-Mount. |
| P3 Fokus-Logik testbar | ★★ | nur Renderer | `App.tsx:679-685`: Treffer filtern mit `sameTarget`, aktiver Tab vor erstem, dann Session-Limit `:685`. `sameTarget` (`terminal-tabs.ts:60-63`) vergleicht `runtime`. | Reihenfolge „Fokus vor Limit“ und „aktiver Tab zuerst“ nur manuell geprüft (cve-final-review M5). |
| P4 maskInspect-Fallback | ★★ | nur Main (rein) | `inventory-parsers.ts:257-259`: `([A-Za-z_][A-Za-z0-9_.-]*)=([^"\r\n]*)`. Test `:314-323`. | (a) Der Wert frisst die Zeile bis zum nächsten `"`: in `PATH=/usr/bin TOKEN=abc` bleibt `abc` sichtbar. (b) In `"TOKEN=a\"b"` endet der Wert am `\` vor dem Quote: `"TOKEN=***"b"` – `b` bleibt sichtbar. |
| P5 stateRef | ★ | nur Renderer | `ContainerView.tsx:113` vergleicht `row.uid === state.selected`; `state` stammt aus dem Render, in dem `run` erzeugt wurde (`:103`). `useReducer` `:48`. | Nach einem Auswahlwechsel während der Aktion lädt das Dock für die falsche Zeile neu oder gar nicht. |
| P6 fester Tab, strenger Modus | ★★★ | kleine Main-Änderung | `discovery.ts:112`: `runtime && runtimes.includes(runtime) ? runtime : runtimes[0]` – stiller Fallback. Renderer lehnt ab (`container-view.ts:86-88`), pollt aber weiter (`useContainerInventory.ts:46`) und Main listet alle 10 s die andere Laufzeit, mit sudo. README `:167-168` dokumentiert das als Grenze. | Vier (nach P1: ein) sudo-Lauf je 10 s für Daten, die nie angezeigt werden. |
| P7 README-Umbruch | ★ | Doku | `README.md:149` hat 103 Zeichen; Nachbarn ≈ 85. (Das Review nannte `:145`; durch die M3-Fixes ist es jetzt `:149`.) | Nur Kosmetik. |

## 2. Empfehlung je Punkt

### P1 · Eine sudo-Anmeldung je Poll (SSH)

**Ursache.** `inventory` behandelt jede Art als eigenen Remote-Befehl (`discovery.ts:115-119`, `:132`). Im Passwortmodus macht `remoteCommand` daraus je Befehl `sudo -S -p M -v && printf READY && sudo -n <argv>` (`commands.ts:33-37`); `runWithSudo` holt dafür je Befehl das Gate (`sudo-run.ts:20-28`).

**Lösung.** Die vier Listen laufen per SSH in **einem** `sh -c`-Skript mit einmal `sudo -v` und je Liste `sudo -n <argv>`, getrennt durch zufällige, zeilenverankerte Marken mit Exit-Code. Lokal bleibt alles wie heute (vier `runLocal`, `discovery.ts:123-127`).

1. `sudo.ts:4` – `createSudoMarker(kind: 'sudo' | 'ready' | 'list')`. Ergebnis `[terminus-list-<16 hex>]`; `SUDO_MARKER` (`commands.ts:27`) nimmt es bereits an.
2. `commands.ts` – neuer Export neben `remoteCommand` (das bleibt wörtlich unverändert, die Exakt-Tests `commands.test.ts:51-60` bleiben grün):
   ```ts
   /** Runs a fixed sh script; in prompt mode after one `sudo -v`, the script itself prefixes `sudo -n` where needed. */
   export function remoteScript(body: string, sudo: SudoMode): string
   // none, noninteractive: shellJoin(['sh', '-c', `${PATH_PREFIX}; ${body}`])
   // prompt:               shellJoin(['sh', '-c', `${PATH_PREFIX}; ${validate} && printf %s ${shellJoin([sudo.ready])} && { ${body}; }; exit $?`])
   ```
   `validate` ist derselbe Ausdruck wie in `:33`. Die Klammern sind nötig, sonst liefen die Listen auch nach einem gescheiterten `sudo -v`.
3. Neue Datei `src/main/containers/inventory-batch.ts` (rein, wirft nur bei ungültiger Marke):
   ```ts
   export const LIST_MARKER = /^\[terminus-list-[0-9a-f]{16}\]$/;
   /** One remote command for all four lists; after each list `<marker>:<kind>:<exit code>` is printed on its own line, on stdout and on stderr. */
   export function inventoryBatchCommand(runtime: ContainerRuntime, marker: string, sudo: SudoMode): string;
   /** Splits the batch output back into one RunResult per kind; kinds without a marker inherit the batch's flags (timedOut, sudo*) with code null. */
   export function splitInventoryBatch(result: RunResult, marker: string): Record<InventoryKind, RunResult>;
   ```
   Skript-Körper je Art (`prefix` = `[]` bei `sudo.kind === 'none'`, sonst `['sudo', '-n']`; `tag` = `shellJoin([`${marker}:${kind}:`]) + '"$c"'`):
   ```
   <shellJoin([...prefix, ...inventoryArgv(runtime, kind)])>; c=$?; echo; echo <tag>; echo >&2; echo <tag> >&2
   ```
   Die vier Teile werden mit `; ` in der Reihenfolge `INVENTORY_KINDS` verbunden und an `remoteScript` übergeben. Jeder Befehl bleibt `sudo -n <programm> …`, damit sudoers-Regeln auf das Programm weiter passen (Kommentar `commands.ts:34`).
   `splitInventoryBatch`: Regex `^<marker>:(containers|images|volumes|networks):(\d+)$` mit Flags `gm` getrennt über `stdout` und `stderr`. Segment = Text zwischen dem Ende der vorigen Markenzeile und dem Anfang der aktuellen, ein führendes und ein abschließendes `\n` entfernt. Erste Marke je Art gewinnt. Art **mit** stdout-Marke → `{ code: Number(code), stdout: segment, stderr: stderr-Segment ?? '', sudoReady? }`. Art **ohne** stdout-Marke → `{ code: null, stdout: '', stderr: stderr-Rest nach der letzten Marke (oder ganz), timedOut?, sudoRejected?, sudoBusy?, sudoNoPrompt?, sudoReady? }` aus dem Batch-Ergebnis. Damit liefert `describeFailure` (`parsers.ts:53-69`) für sudo-Ablehnung, Gate-Timeout, Timeout und „a password is required“ unverändert die bekannten Texte, und zwar je Art getrennt in `problems`.
4. `sudo-run.ts:14` – zweiter Parametertyp: `command: string[] | ((sudo: SudoMode) => string)`. Intern `const render = (mode: SudoMode) => typeof command === 'function' ? command(mode) : remoteCommand(command, mode)`; `:16` und `:27` nutzen `render`. Alles andere (Gate, Sperre, Marker, Passwort) bleibt.
5. `discovery.ts:95-135` – `build` bekommt statt `run(rt, kind)` eine Funktion `lists(rt): Promise<Record<InventoryKind, RunResult>>`. Lokal: vier `runLocal` nacheinander, `containers` aus `probed` (wie `:116`). SSH:
   ```ts
   const marker = createSudoMarker('list');
   const batch = await runWithSudo(host, connection, mode => inventoryBatchCommand(rt, marker, mode), LIST_TIMEOUT, this.sudoRejections);
   return splitInventoryBatch(batch, marker);
   ```
   Die Schleife `:115-119` bleibt (Parsen bei `code === 0`, sonst `problems[kind]`).

**Timeout.** `LIST_TIMEOUT` (15 s) gilt für den ganzen Batch. Läuft er ab, sind die Arten mit Marke vollständig, die übrigen bekommen „Der Host hat nicht rechtzeitig geantwortet.“ Das ist besser als heute (bis zu 4 × 15 s bei hängendem Daemon).

**Tests.**
- `commands.test.ts`: `remoteScript('true', …)` exakt für alle drei Modi (Muster `:57-58`); im Prompt-Modus genau ein `sudo -v`, `{ true; }` nach `printf`.
- `inventory-batch.test.ts` (neu): Befehl enthält für Docker und Podman alle vier `shellJoin(inventoryArgv(rt, kind))` in Reihenfolge; `none` ohne `sudo`, `noninteractive`/`prompt` mit `sudo -n` vor jeder Liste; Marke kommt 8-mal vor; kein `-f`, `--force`, `-v` (außer `sudo -v`), `prune`; ungültige Marke (`%u`, leer, `x'y`) wirft. `splitInventoryBatch`: vier erfolgreiche Segmente mit Exit-Codes; `images` mit Code 1 und eigener stderr-Zeile, die anderen `code 0` und `stderr ''`; Timeout nach `containers` → `containers` geparst, drei Arten `timedOut`; `sudoRejected` ohne Marken → alle vier `sudoRejected`; Zeile im JSON, die wie eine Marke aussieht, aber in Quotes steht, trennt nicht; Podman-Array mit Einrückung bleibt intakt. Dazu `it.runIf(hasSh())` Rundreise mit dem Fake-sudo aus `commands.test.ts:68-77` (unter Windows übersprungen, wie dort).
- `discovery.test.ts:367-410`: `inventoryAnswers` (`:356-365`) wird durch einen Fake-Host ersetzt, der die Marke mit `/\[terminus-list-[0-9a-f]{16}\]/` aus dem Befehl liest, prüft, dass der Befehl die vier `inventoryArgv` in Reihenfolge enthält, und stdout/stderr aus den Antworten je Art samt Markenzeilen zusammensetzt (eine Fake-Shell). Erwartungen: `host.commands.length === 2` (Probe + Batch) · Docker vor Podman · Parameter `podman` gewinnt · `images` mit Code 1 und `stderr 'Error response from daemon: x'` → `problems` genau `{ images: 'Error response from daemon: x' }`, drei Arten geliefert · Batch mit `timedOut` nach `containers` → `problems` für drei Arten · `noninteractive`: Befehl beginnt mit `sh -c`, enthält `sudo -n docker ps` und `sudo -n docker images` · **Passwortmodus: `host.sudo.filter(Boolean)` hat Länge 1 für ein komplettes Inventar** (das ist der Nachweis für P1) · `sudoRejected`-Batch → alle vier `problems` = `SUDO_REJECTED`, Passwort einmal gesendet, zweiter Poll sendet nichts (Muster `:126-138`). Lokal `:412-427` unverändert.

**Risiken.** `OUTPUT_LIMIT` (`runner.ts:9`, 1 MiB) gilt jetzt für vier Listen zusammen; wird er überschritten, fehlt den letzten Arten die Marke und sie melden „Befehl fehlgeschlagen (Exit-Code ?)“. Bei typischen Hosts liegt das Inventar unter 200 kB. Nicht jetzt: Limit anheben. – Die stderr-Trennung hängt an derselben Marke; sudo-Meldungen vor der ersten Liste landen im Segment der ersten Art (`containers`), und die Daemon-Heuristiken in `describeFailure` (`:61-65`) treffen dort. Das entspricht dem heutigen Verhalten, bei dem die erste Liste zuerst scheitert.

### P2 · Scheduler als Klasse mit Fake-Timern

**Ursache.** Die gesamte Ablaufsteuerung liegt in Refs und Closures des Hooks (`useContainerInventory.ts:15-48`), die nur im React-Mount existieren.

**Lösung.** Neue reine Datei `src/renderer/src/inventory-scheduler.ts`:
```ts
export interface InventoryInput { hostId: string; runtime: ContainerRuntime | null }
export interface InventorySchedulerHooks {
  request: (input: InventoryInput) => Promise<ContainerInventory>;
  dispatch: (action: ContainerViewAction) => void;
  /** Default POLL_MS = 10_000. */
  pollMs?: number;
}
export class InventoryScheduler {
  constructor(hooks: InventorySchedulerHooks);
  /** Mount (also the StrictMode remount): answers count again. */
  start(): void;
  /** Unmount: pending answers are dropped, the timer cleared. */
  stop(): void;
  /** New host/runtime (outdates the request in flight) and visibility; loads when visible and nothing runs. */
  update(input: InventoryInput, visible: boolean): void;
  /** F5, action, runtime switch: non-quiet load; remembered exactly once while a request runs. */
  reload(): void;
}
```
Die Semantik ist **exakt** die heutige: `load(quiet)` (`:29-48`) → `clearTimeout`; läuft etwas → `again = true`; sonst `sequence++`, `dispatch(loading | loading quiet)`, `request(input)`; Antwort nur bei `alive && id === sequence`; im `finally`: `stale = id !== sequence`; `(again || stale) && visible` → sofort erneut (nicht quiet); sonst bei `visible` Timer `pollMs` → `load(true)`. `update` (`:58-64`): anderer Schlüssel `${hostId}|${runtime ?? ''}` → `sequence++`; unsichtbar → Timer löschen; sichtbar und nichts in Flug → `load(false)`. Fehler über `ipcMessage(error, 'Die Container konnten nicht geladen werden.')`.

Der Hook behält seine Signatur (Vertrag 1.12) und wird dünn: `useRef(new InventoryScheduler({ request: input => window.desktopApi.containersInventory({ hostId: input.hostId, ...(input.runtime ? { runtime: input.runtime } : {}) }), dispatch: a => dispatchRef.current(a) }))`, `useEffect(() => { s.start(); return () => s.stop(); }, [])`, `useEffect(() => s.update({ hostId, runtime }, visible), [hostId, runtime, visible])`, `reload = useCallback(() => s.reload(), [])`. `start()` ist nötig, weil StrictMode `stop()` zwischen zwei Mounts aufruft und die laufende Antwort danach wieder zählen muss (heute `alive` in `:51`).

**Tests** (`inventory-scheduler.test.ts`, `vi.useFakeTimers()`, Antworten als steuerbare Promises):
- Erster `update(sichtbar)` → genau eine Anfrage, `loading` ohne `quiet`; nach Antwort `setInventory`; `advanceTimersByTimeAsync(10_000)` → zweite Anfrage mit `loading quiet`.
- Zwei `reload()` während einer laufenden Anfrage → nach der Antwort genau eine weitere Anfrage, nicht zwei.
- Laufzeitwechsel während der Anfrage → die alte Antwort löst kein `setInventory` aus, eine neue Anfrage startet sofort mit der neuen Laufzeit.
- `update(unsichtbar)` → keine Anfrage; unsichtbar während des Timers → Timer gelöscht, kein Poll; wieder sichtbar → sofort eine Anfrage.
- Unsichtbar während der Anfrage → `finally` plant nichts; der spätere `update(sichtbar)` lädt.
- `stop()` während der Anfrage → Antwort verworfen, kein Timer; `start()` + `update` danach lädt wieder (StrictMode).
- Zwei `update` mit gleichem Schlüssel → eine Anfrage.
- Abgelehnte Anfrage → `fail` mit dem Text aus `ipcMessage` (`Error invoking remote method 'x': Error: Boom` → `Boom`).

**Risiken.** Keine funktionalen. `ContainerView.tsx:49` bleibt unverändert.

### P3 · Trefferwahl als reine Funktion

**Ursache.** `App.tsx:679-685` entscheidet inline. B3 (Fokus vor Limit) und E2 (aktiver Tab zuerst) sind nur manuell belegt.

**Lösung.** In `terminal-tabs.ts` nach `sameTarget` (`:63`):
```ts
/** Open view of the same host and runtime: the active tab first, else the first match; undefined when none. */
export function reusableTab(tabs: readonly TerminalTab[], activeTabId: string | null, connection: TerminalConnection): TerminalTab | undefined;
export type ContainerViewPlan = { kind: 'focus'; tabId: string } | { kind: 'limit' } | { kind: 'open' };
/** reuse → focus an open tab before the session limit applies; then MAX_SSH_SESSIONS; then open. */
export function planContainerView(tabs: readonly TerminalTab[], activeTabId: string | null, connection: TerminalConnection, reuse: boolean): ContainerViewPlan;
```
`App.tsx:679-686` wird zu: `const plan = planContainerView(terminals.tabs, terminals.activeTabId, connection, reuse); if (plan.kind === 'focus') { terminals.select(plan.tabId); … return; } if (plan.kind === 'limit') { setError(…Maximal…); return; } terminals.open(connection);` – Texte und Nebenwirkungen (`setEditorOpen(false)`, `setEditorDirty(false)`, `setError(null)`) wörtlich wie heute. Der Import `sameTarget` in `App.tsx:29` entfällt, wenn er sonst ungenutzt ist (prüfen).

**Tests** (`terminal-tabs.test.ts`, Describe `container view tabs` `:130`): `reusableTab` – aktiver passender Tab gewinnt vor einem früheren passenden; ohne aktiven Treffer der erste; Docker-Tab passt nicht zu Podman- oder freier Ansicht; Datei-Tab und Terminal-Tab passen nie; leer → `undefined`. `planContainerView` – 16 Tabs (`MAX_SSH_SESSIONS`) mit passendem Tab und `reuse` → `focus` (nicht `limit`); 16 Tabs ohne Treffer → `limit`; 16 Tabs mit Treffer, aber `reuse = false` → `limit`; unter dem Limit ohne Treffer → `open`; mit Treffer und `reuse = false` → `open` (Menü öffnet zweiten Tab, B2).

**Risiken.** Keine. Verhalten unverändert, nur verschoben.

### P4 · Fallback-Maske: Zeilen mit mehreren Paaren und escapte Quotes

**Ursache.** `inventory-parsers.ts:258`: ein Muster für zwei Fälle. In Freitext frisst `[^"\r\n]*` bis zum Zeilenende, in JSON-Strings endet es am Backslash eines escapten Quotes.

**Lösung.** Zwei Durchgänge in `maskEnvText`, zuerst Quotes, dann Freitext:
```ts
/** "NAME=value" as a JSON string: the value runs to the closing quote, escapes included. */
const QUOTED_ENV = /"([A-Za-z_][A-Za-z0-9_.-]*)=((?:\\.|[^"\\\r\n])*)"/g;
/** NAME=value in free text: the value ends at whitespace or a quote, so a second pair on the line is seen. */
const BARE_ENV = /(?<![A-Za-z0-9_.\-"=])([A-Za-z_][A-Za-z0-9_.-]*)=([^\s"]*)/g;
text.replace(QUOTED_ENV, (m, name) => SECRET_NAME.test(name) ? `"${name}=***"` : m)
    .replace(BARE_ENV, (m, name) => SECRET_NAME.test(name) ? `${name}=***` : m)
```
Das Lookbehind lässt den zweiten Durchgang nicht an Strings beginnen, die der erste schon behandelt hat, trifft aber ein `TOKEN=…` **innerhalb** eines fremden Werts (`"PATH=/x TOKEN=y"` → `"PATH=/x TOKEN=***"`). Das ist Übermaskierung im Fallback und gewollt. Die Maske ist idempotent (`TOKEN=***` bleibt). `maskInspect` (`:262-282`) und die Namensregel `SECRET_NAME` (`:254`) bleiben; Werte wie `DATABASE_URL=postgres://u:p@…` bleiben laut R8/C10 unmaskiert.

**Tests** (`inventory-parsers.test.ts`, neben `:314-323`): `PATH=/usr/bin TOKEN=abc` → `PATH=/usr/bin TOKEN=***` · `"TOKEN=a\"b"` → `"TOKEN=***"`, kein `b"` · `"API_KEY=abc def"` → `"API_KEY=***"` (bleibt) · `"PATH=/usr/bin TOKEN=abc"` → enthält `TOKEN=***`, nicht `abc` · `HOME=/root,PASSWORD=x;SECRET=y` → beide maskiert, `HOME=/root` bleibt · mehrere Zeilen, erste Zeile ohne führenden Trenner · `DATABASE_URL=postgres://u:p@h` bleibt · doppelte Anwendung ändert nichts · bestehende Fälle `:311-313` bleiben.

**Risiken.** Lookbehind braucht Node ≥ 10 (Electron 44: gegeben). Der Fallback greift ohnehin nur, wenn `inspect` kein reines JSON liefert.

### P5 · `reloadDock` mit aktuellem Stand

**Ursache.** `ContainerView.tsx:113` liest `state.selected` aus dem Render, in dem `run` erzeugt wurde; der Dialog ruft `run` erst später auf.

**Lösung.** Nach `:48`: `const stateRef = useRef(state); stateRef.current = state;` und in `:113` `stateRef.current.selected`. Kein weiterer Umbau (`confirm` `:121` liest synchron beim Klick, das ist korrekt).

**Tests.** Komponente, kein Test (wie T9). Manuell: Stoppen bestätigen, während der Aktion eine andere Zeile wählen → das Dock lädt nicht für die alte Zeile neu.

**Risiken.** Keine.

### P6 · Fester Tab: kein Fallback im Main

**Ursache.** `discovery.ts:112` fällt still auf `runtimes[0]` zurück (so von B8 Schritt 3 verlangt). Der Renderer lehnt das Ergebnis ab (`container-view.ts:86-88`), pollt aber weiter (`useContainerInventory.ts:46`). E1 der Entries-Validierung hat das akzeptiert.

**Lösung.** Angeforderte Laufzeit heißt strenger Modus. In `build` vor der Prüfung `runtimes.length === 0` (`:111`):
```ts
if (runtime && !runtimes.includes(runtime)) throw new HostAccessError(`${RUNTIME_LABEL[runtime]} wurde auf diesem Host nicht gefunden.`);
```
`RUNTIME_LABEL` aus `shared/containers.ts:123`. Die Reihenfolge ergibt für einen festen Tab immer den laufzeitspezifischen Text, für die freie Ansicht ohne Parameter weiter „Auf diesem Host wurde weder Docker noch Podman gefunden.“ Danach `const rt = runtime ?? runtimes[0]`. `InventoryRequestSchema` (`validation.ts`) bleibt, `runtime` ist dort schon optional. Kein neues Feld, keine IPC-Änderung.

Renderer: **keine Änderung.** Der Hook dispatcht `fail`; der Text kommt über `ipcMessage` (`container-tree.ts:85-87`) unverändert an und ist derselbe, den der Reducer heute selbst erzeugt. Statuszeile mit „Erneut versuchen“ wie heute, `tabStatus` `error` ohne Inventar. Der Reducer-Zweig `:86-88` bleibt als zweite Verteidigungslinie. Das Polling läuft weiter, aber Main führt dann nur noch die Probe aus (ohne sudo, `discovery.ts:130`) – damit ist „pollt nicht die andere Laufzeit“ erfüllt, und der Tab erholt sich von selbst, sobald die Laufzeit wieder da ist.

Freie Ansicht: Der Umschalter erscheint nur bei zwei Laufzeiten (`ContainerView.tsx:251`). Verschwindet eine davon, nachdem der Nutzer sie gewählt hat, zeigt die Ansicht den Fehler, behält den alten Stand samt Umschalter und lässt zurückschalten. Das ist akzeptiert.

**Tests** (`discovery.test.ts`): SSH – Probe `has:docker` und Parameter `podman` → wirft „Podman wurde auf diesem Host nicht gefunden.“, `host.commands` ist genau `[PROBE]` (keine Liste, kein sudo) – ersetzt `:382-384`. Probe `has:pct` ohne Parameter → bisheriger Text `:388`; mit Parameter `docker` → „Docker wurde auf diesem Host nicht gefunden.“ Lokal – `podman` `notFound`, Parameter `podman` → derselbe Text; `runLocal` wurde nur mit den Container-Listen (Probe-Ersatz) aufgerufen.

**Risiken.** Die bindenden Texte B8 Schritt 3 („Es gibt keinen Fehler“) und E1 werden abgelöst (Abschnitt 9). Alte README-Grenze `:167-168` wird falsch → T6.

### P7 · README-Umbruch

`README.md:149` (103 Zeichen) wird zu zwei Zeilen: „aktualisiert sich alle 10 Sekunden, solange der Tab sichtbar ist, sowie nach jeder“ / „Aktion und mit `F5`.“

## 3. Doku-Texte (wörtlich)

README `:165-166` → „- Ein zweiter Tab desselben Hosts pollt doppelt. Mit `sudo` im Passwortmodus meldet“ / „  sich jeder Poll einmal per sudo an; das steht im Auth-Log des Hosts.“
README `:167-168` → „- Fehlt die Laufzeit eines festen Tabs auf dem Host, zeigt der Tab einen Fehler. Im“ / „  Hintergrund prüft er nur noch ohne sudo, ob sie wieder da ist.“

CHANGELOG `## [0.9.0]` (nach `:12`, vor dem Design-Punkt), ein Punkt:
„- Container-Ansicht: Mit `sudo` im Passwortmodus meldet sich jeder Poll nur noch einmal an, die vier Listen laufen in einem Befehl. Ein fester Docker- oder Podman-Tab zeigt bei fehlender Laufzeit einen Fehler, statt im Hintergrund die andere Laufzeit abzufragen. Inspect maskiert in nicht parsbarer Ausgabe auch Geheimnisse hinter anderen Einträgen derselben Zeile.“

Version bleibt 0.9.0 (S8), kein `version:minor`.

## 4. Regeln und Risiken – was ausdrücklich nicht getan wird

- Kein neues IPC-Feld, kein Schema-Umbau, Preload unverändert. P6 nutzt den vorhandenen Parameter `runtime`.
- `remoteCommand` bleibt wörtlich; `remoteScript` kommt daneben. Lokal läuft das Inventar weiter mit vier `runLocal`.
- Jeder Befehl im Batch ist `sudo -n <programm> …`, nie `sudo -n sh -c …`, damit sudoers-Regeln auf das Programm passen. Kein `-f`, `--force`, `-v` (außer `sudo -v`), `prune`.
- Befehle bestehen nur aus festen Teilen: `inventoryArgv` (feste Arrays), `INVENTORY_KINDS`, eine Marke aus `randomBytes`, geprüft gegen `LIST_MARKER`, jedes Token durch `shellJoin`. Kein Wert aus Vault, Renderer oder Host-Ausgabe fließt in den Befehl.
- Marken sind je Poll zufällig (64 Bit) und zeilenverankert. Docker-Zeilen beginnen mit `{`, Podman-Arrays mit `[` und eingerückten Objekten, Namen dürfen kein `[` enthalten (`CONTAINER_REF`): Host-Ausgabe kann keine Marke fälschen.
- Passwortpfad unverändert (`runner.ts:90-99`, `SudoRejections`). Durch P1 wird das Gate je Poll einmal statt viermal gehalten; Terminal-Tabs warten kürzer.
- Nicht jetzt: `OUTPUT_LIMIT` anheben; seltener pollen im Passwortmodus; Polling im Renderer bei Fehler stoppen; `remoteCommand` auf `remoteScript` umstellen; Komponententests für `ContainerView`; ein `strict`-Flag im Request; Kube-Dateien, `session.ts`, `TerminalPanel.tsx`, `containers-schema.ts`, `validation.ts`, `ipc.ts` anfassen.

## 5. Zerlegung in Tasks (Dateien je Welle disjunkt)

Gate nach jeder Welle: `npm run typecheck` und `npx vitest run` grün. Ein Commit je Task.

| Welle | Task | Punkte | Dateien (exakt) | Hängt ab von |
|---|---|---|---|---|
| 1 | **T1** Batch-Bausteine | P1 | `src/main/containers/sudo.ts`, `sudo.test.ts`, `commands.ts`, `commands.test.ts`, **neu** `inventory-batch.ts`, **neu** `inventory-batch.test.ts`, `sudo-run.ts`, `sudo-run.test.ts` | – |
| 1 | **T2** Scheduler | P2 | **neu** `src/renderer/src/inventory-scheduler.ts`, **neu** `inventory-scheduler.test.ts`, `src/renderer/src/hooks/useContainerInventory.ts` | – |
| 1 | **T3** Trefferwahl | P3 | `src/renderer/src/terminal-tabs.ts`, `terminal-tabs.test.ts`, `src/renderer/src/App.tsx` | – |
| 1 | **T4** Fallback-Maske | P4 | `src/main/containers/inventory-parsers.ts`, `inventory-parsers.test.ts` | – |
| 1 | **T5** stateRef | P5 | `src/renderer/src/components/containers/ContainerView.tsx` | – |
| 1 | **T6** Doku | P7, Texte zu P1/P6 | `README.md`, `CHANGELOG.md` | – (Texte stehen in Abschnitt 3) |
| 2 | **T7** Discovery | P1 (Verdrahtung), P6 | `src/main/containers/discovery.ts`, `discovery.test.ts` | T1 |

Warum es kompiliert: Welle 1 fügt nur Exporte hinzu (`remoteScript`, `inventory-batch.ts`, Marker-Kind `'list'`, `runWithSudo` mit Union-Parameter – der Array-Aufruf bleibt gültig). `discovery.ts` ruft die neuen Exporte erst in Welle 2 auf. T2 behält die Hook-Signatur, T3 ändert nur `App.tsx` und `terminal-tabs.ts`. Nach Welle 2 greift ein Grep: `rg "run\(rt, kind\)|runtimes\[0\] : " src/main/containers/discovery.ts` ergibt keinen Treffer für den alten Fallback.

## 6. Minimale erste Stufe gegenüber Extras

**Minimal (dieser Auftrag):** T1–T7 wie oben. Alle sieben Punkte sind damit geschlossen, und die beiden „An den Nutzer melden“-Befunde (M6, M8) sowie die akzeptierten Grenzen (E1, M5) werden zu getestetem Verhalten.

**Extras, nicht jetzt:** `OUTPUT_LIMIT` je Batch dynamisch; Polling im Passwortmodus auf 30 s strecken; `remoteCommand` als Spezialfall von `remoteScript`; `hasSh`-Rundreise auch für den Prompt-Modus des Batches; Renderer stoppt Polling nach „nicht gefunden“ und bietet nur „Erneut versuchen“ (spart die Probe alle 10 s, kostet die Selbstheilung).

## 7. Manuelle Prüfung nach Welle 2 (im PR nennen)

- SSH-Host mit `sudo` und Passwort: Auth-Log zeigt je Poll **einen** `sudo -v`-Eintrag und vier `sudo -n`-Befehle ohne Passwortabfrage; Statuszeile zeigt „geladen vor n s“ ohne Flackern.
- Fester Podman-Tab auf einem Host nur mit Docker: Fehlertext „Podman wurde auf diesem Host nicht gefunden.“, „Erneut versuchen“; im Auth-Log kein sudo mehr; nach Installation von Podman erholt sich der Tab beim nächsten Poll.
- `images` künstlich scheitern lassen (z. B. Rechte auf `/var/lib/docker/image`): nur der Reiter Images zeigt die Meldung, die drei anderen laden.
- Seitenleiste bei 16 offenen Tabs: Klick auf „Docker-Ansicht“ fokussiert, Menü meldet das Limit.
- Stoppen bestätigen, währenddessen andere Zeile wählen: Dock lädt nicht für die alte Zeile neu.

## 8. Fundstellen (Kurzliste)

`discovery.ts:95-135` (inventory), `:111-112` (Fallback), `:115-119` (Schleife), `:123-127` (lokal), `:130-132` (Probe, runWithSudo je Art) · `sudo-run.ts:14-32` · `commands.ts:10` (PATH_PREFIX), `:13-16` (shellJoin), `:27` (SUDO_MARKER), `:29-38` (remoteCommand), `:94-105` (inventoryArgv) · `sudo.ts:4-6` · `runner.ts:9`, `:58-104` · `parsers.ts:3-18` (RunResult), `:53-69` (describeFailure) · `inventory-parsers.ts:7-19` (records), `:254-282` (Maske) · `useContainerInventory.ts:29-48`, `:50-64` · `App.tsx:591-595` (navigateEditor), `:671-689` · `terminal-tabs.ts:36-38`, `:60-63` · `ContainerView.tsx:48-49`, `:103-115`, `:251` · `container-view.ts:84-88`, `:94` · `container-tree.ts:85-87` (ipcMessage) · `shared/containers.ts:123` (RUNTIME_LABEL) · `discovery.test.ts:14-22` (fakeHost), `:113-138` (sudo-Muster), `:356-427` · `commands.test.ts:51-77` · `inventory-parsers.test.ts:289-324` · `terminal-tabs.test.ts:130-163` · `README.md:149`, `:158-168` · `CHANGELOG.md:7-13`.

## 9. Was diese Recherche an den bindenden Specs ablöst (vom Prüfer als Ruling festhalten)

1. `2026-10-18-container-view-validation.md` B8 Schritt 3 („Ist der Parameter in `runtimes`, gilt er, sonst `runtimes[0]`. Es gibt keinen Fehler.“) → angeforderte, fehlende Laufzeit wirft `HostAccessError('<Docker|Podman> wurde auf diesem Host nicht gefunden.')`.
2. Dieselbe Validierung B8 Schritt 4 („per SSH über `runWithSudo` … jede mit `LIST_TIMEOUT`“) und C32 („meldet sich jeder Poll viermal per sudo an“) → per SSH ein Batch mit einer Anmeldung, `LIST_TIMEOUT` für den Batch; README-Satz „einmal“.
3. `2026-10-18-container-view-entries-validation.md` E1 („Main bleibt bei `discovery.ts:116`“, Fallback akzeptiert) → aufgehoben durch P6.

Alles Übrige (R1–R9, S1–S9, B1–B10, C1–C31, K1–K14) bleibt unverändert gültig.
