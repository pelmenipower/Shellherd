# Log-Viewer (Automatisch scrollen, Suche in Logs): Validierung (bindend)

Prüfer: Opus, 2026-11-15. Geprüft wurden `2026-11-15-log-viewer-design.md` und das Konzept `.superpowers/sdd/2026-11-15-log-viewer-research.md` (K) gegen den Code auf `claude/feature/log-viewer` (`348a384`, Vorab-Fix `f1dbd0e` enthalten). Gelesen wurden `src/renderer/src/components/{TerminalPanel,TerminalSearchBar}.tsx`, `components/kubernetes/{DetailDock,WorkloadLogs,ClusterView}.tsx`, `components/containers/{ContainerDock,ContainerView}.tsx`, `src/renderer/src/{kube-logs,terminal-theme,terminal-access,terminal-prefs,shortcut-match,kube-commands,container-view,kube-view,container-menus,i18n}.ts`, `hooks/useShortcut.ts`, `tokens.css`, `kubernetes-ui.css`, `kubernetes-dock.css`, `terminal-comfort-ui.css`, `design-tokens.test.ts`, `terminal-theme.test.ts`, `src/shared/locales/i18n-catalog.test.ts`, die Locale-Dateien `common`, `terminal` und `kubernetes`, `src/shared/{windows,kubernetes,containers}.ts`, `src/main/containers/commands.ts`, `src/main/ssh/session.ts` (exec mit pty), `.claude/skills/run-app/{screens,sshd,kube-fake,fakes.test}.mjs` und `SKILL.md`, `docs/design-system.md`, `docs/handbuch.md` sowie `README.md`. Für xterm wurden die Quellen in `node_modules/@xterm/xterm/src` (6.0.0) und die Sourcemap-Quellen von `@xterm/addon-search` 0.16.0 gelesen (`SearchAddon.ts`, `SearchEngine.ts`, `SearchState.ts`, `SearchResultTracker.ts`, `DecorationManager.ts`).

Ausgangslage: `npm run typecheck` ist grün. `npx vitest run`: 240 Dateien, 3891 Tests grün, 36 übersprungen.

**Urteil: ready after corrections.** Es gibt 4 Blocker, 19 Korrekturen und 12 Entscheidungen bzw. Ergänzungen.

Dieser Anhang geht Spec und Konzept vor. Was hier nicht steht, gilt aus Spec und K weiter. §2 ersetzt K §4.1 „TerminalPanel-Vertrag“ und „Halten der Position“, die Typen in K §4.2 und den Suchlogik-Vertrag. §5 ersetzt K §4.5. §6 ersetzt K §6 und Spec „Wellen“.

---

## 0. Geprüfte Fakten (Grundlage der Befunde)

| Behauptung in K | Befund im Code | Folge |
|---|---|---|
| Decorations brauchen `allowProposedApi` | Stimmt. `Terminal.registerDecoration` ruft `_checkProposedApi()` und wirft ohne die Option (`xterm/src/browser/public/Terminal.ts:175-178`). Das Addon ruft `this._terminal.registerDecoration` (`DecorationManager.ts`). `registerMarker` ist öffentlich (`:171`). | Ruling `allowProposedApi: true` bleibt. |
| `onDidChangeResults` liefert Zähler | Feuert nur, wenn `decorations` übergeben werden (`SearchResultTracker.fireResultsChanged(hasDecorations)`). Es feuert **synchron** in `findNext`/`findPrevious`. `resultCount` ist auf `highlightLimit` gekappt (`updateResults(results.slice(0, max))`). `resultIndex` ist -1, wenn der aktive Treffer nicht unter den ersten 1 000 gesammelten Treffern liegt **oder** gar keine aktive Decoration existiert. | K3 |
| 200-ms-Refresh hält den Zähler aktuell | `_updateMatches` läuft bei jedem `onWriteParsed` **und** `onResize`, löscht den Timer und setzt ihn neu (Debounce). Der Refresh läuft also erst 200 ms **nach der letzten** Ausgabe. Bei Dauerausgabe läuft er nie. Er ruft `findPrevious(term, {...last, incremental: true}, { noScroll: true })`. Weil `cachedSearchTerm` vorher gelöscht wird, sucht `findPreviousWithSelection` zuerst nach rechts ab dem Auswahlanfang und findet damit denselben Treffer wieder. Dabei ruft das Addon `clearSelection()` und `select()`. | K9, B4 |
| Ungültiger Regex wirft | Stimmt: `RegExp(searchTerm, caseSensitive ? 'g' : 'gi')` in `SearchEngine._findInLine`, ohne `try`. Ein Wurf im Refresh-Timer läge außerhalb jedes `try/catch` im Panel. | B4, K6 |
| Optionsänderung sucht neu | **Falsch.** `findNext` setzt `lastSearchOptions = searchOptions` **vor** `shouldUpdateHighlighting` (`SearchAddon.ts:101-105`), also vergleicht `didOptionsChange` die neuen Optionen mit sich selbst. Bei gleichem Begriff werden die Markierungen und der Zähler nicht neu berechnet. | B3 |
| `incremental` | Wird in 0.16 nicht ausgewertet. Der Startpunkt hängt nur an `cachedSearchTerm === term` (gleich: ab Auswahlende, sonst ab Auswahlanfang). | K11 |
| wholeWord | Das Addon prüft die Nachbarzeichen gegen `NON_WORD_CHARACTERS = ' ~!@#$%^&*()+\`-=[]{}\|\\;:"\',./<>?'` und **nicht** gegen `\b`. Scheitert der erste Fund einer Zeile an der Prüfung, verwirft das Addon die ganze Zeile. | K6, K3 |
| Scroll-Mechanik | `BufferService.scroll` feuert `onScroll` bei **jeder** Ausgabezeile, auch ohne Positionsänderung. Bei `isUserScrolling` und vollem Puffer gilt `ydisp - 1`. `scrollLines(disp<0)` setzt `isUserScrolling = true`, `disp + ydisp >= ybase` setzt es auf `false`. Programmatisches `term.scrollLines/scrollToLine` läuft über `Viewport.scrollLines` → Scrollable (`smoothScrollDuration` 0 = synchron) → `_handleScroll` → `super.scrollLines` → `onScroll`. Das ist synchron und reentrant. | B1 |
| `term.write` an einer Stelle | Zwei Stellen: `TerminalPanel.tsx:174` (Daten) und `:230` (Snapshot beim Adoptieren). `write` ist asynchron. Der `WriteBuffer` verarbeitet in Scheiben zu 12 ms per `setTimeout`, Callbacks laufen je Write, `onWriteParsed` feuert am Ende jeder Scheibe in derselben Task. | B1 |
| Strg+F ist frei | Stimmt. Kein `KeyF` außer `TerminalPanel.tsx:121` und dem Dateifilter `FilePane.tsx:172` (eigene Liste). Es gibt kein Electron-Menü-Accelerator für Strg+F oder F3. `ClusterView.tsx:341-353` und `ContainerView.tsx:212-226` lassen Tasten mit Ziel in `.kube-dock` unbehandelt durch (außer `Ctrl+j`, `Ctrl+Shift+T`). `useCtrlShortcut` ist nur für `Comma` und `Tab` belegt. | – |
| Modus-Erkennung | `TabConnection.kube?: KubeTerminalTarget` mit `mode: 'logs' \| 'previous' \| 'shell'` (`shared/kubernetes.ts:222-225`). `TabConnection.target?: TerminalTarget` mit `mode: 'shell' \| 'logs'` (`shared/containers.ts:27-28`). `terminalTargetOf(row, mode)` setzt den Modus (`container-menus.ts:37-39`). Der Ausdruck aus K typisiert. | E1 |
| `WorkloadLogs` Reihenfolge | `mergeLines` sortiert nach **Zeit** und nicht nach `seq` (`kube-logs.ts:12-20`). Zeilen ohne Zeit hängen am Ende. „nach `seq`, dann `start`“ (K §4.2) ist deshalb keine Listenreihenfolge. | K5 |
| Locale-Texte | `--color-text-code` hell ist `#221e1a` und nicht `#1d1915`. `{{count}}` wird über `COUNT_KEYS` automatisch formatiert und löst bei Zahlen die Plural-Suche aus (`i18n.ts:9-13`). | K4, K13 |

---

## 1. Blocker (jeder mit Fix, bindend)

**B1: Der Follow-Controller aus K §4.1 hält die Position nicht zuverlässig und schaltet bei Dauerausgabe nicht aus.**
- Beleg:
  - `writing` soll zwischen `writeStart` und dem `term.write`-Callback gelten. `term.write` ist aber asynchron. Jeder Write hat einen eigenen Callback (`WriteBuffer.ts:100-130, 220-245`), und Writes überlappen, weil jedes `data`-Ereignis schreibt (`TerminalPanel.tsx:174`). Der erste Callback setzt `writing = false`, obwohl spätere Writes noch ausstehen. Gleichzeitig gibt der WriteBuffer per `setTimeout` zwischen den Scheiben ab. In dieser Zeit laufen Rad- und Tastatur-Scrolls des Nutzers, und `writing` ist dann `true`. Bei einem geschwätzigen `docker logs -f` steht fast immer ein Write aus, also wird Hochscrollen als Ausgabe gewertet. Das Häkchen bleibt dann an, während xterm wegen `isUserScrolling` stehen bleibt. Ansicht und Häkchen widersprechen sich.
  - Der Rücksprung `scrollToLine(marker)` direkt im `onScroll` läuft innerhalb von `BufferService.scroll`, bevor der Viewport seinen eigenen `onScroll`-Listener abgearbeitet hat. `CoreTerminal` ist vor dem `Viewport` registriert (`CoreTerminal.ts:136`, `Viewport.ts:103`). `Viewport.scrollLines` rechnet von der veralteten Scroll-Position aus (`Viewport.ts:107-113`) und landet deshalb um die Zahl der neuen Zeilen zu hoch. Außerdem feuert der Aufruf ein reentrantes `onScroll`.
- Folge: R-LV-1 und R-LV-2 sind mit dem Entwurf nicht erfüllbar.
- Fix: Es gilt der Vertrag in §2.1 (ersetzt K §4.1 „Halten der Position“). Die Kernpunkte:
  - Es gibt **kein** `writeStart/writeEnd`. Die Herkunft eines Scrolls ergibt sich aus dem Zustand. Ist der Controller an, kann `ydisp < baseY` nur vom Nutzer oder von einem Sprung kommen, weil xterm bei `!isUserScrolling` immer `ydisp = ybase` setzt. Ist er aus, ist `ydisp < baseY` immer harmlos (der Marker folgt). `ydisp === baseY` kommt nur dann von der Ausgabe, wenn die Ansicht davor schon unten stand. Von unten kann der Nutzer nicht weiter nach unten scrollen, `scrollLines` feuert dann nicht (`BufferService.ts:144-147`).
  - Der Rücksprung wird im `onScroll` nur vorgemerkt und in `onWriteParsed` ausgeführt. Das liegt in derselben Task vor dem nächsten Frame, also ohne Flackern, und der Viewport ist dann synchron.
  - Eigene Scrolls laufen unter einem `busy`-Schutz und werden in `onScroll` ignoriert.
  - Gibt `onScroll` `'off'` zurück, schaltet der Controller **selbst** sofort aus. `setFollow` ist idempotent.

**B2: Nach Welle 1 ist der Typecheck rot, weil die Suchtypen in einer Welle-2-Datei liegen.**
- Beleg: K §4.2 legt `SearchOptions` (und `SearchStatus`) in den Vertrag von `TerminalSearchBar` (Task D, Welle 2). `log-search.ts` (Task B, Welle 1) braucht `SearchOptions` in `compileSearch`.
- Fix: `SearchOptions`, `SearchStatus`, `DEFAULT_SEARCH_OPTIONS` und `SEARCH_LIMIT` stehen in `src/renderer/src/log-search.ts` (§2.3). `TerminalSearchBar.tsx`, `TerminalPanel.tsx` und `WorkloadLogs.tsx` importieren sie von dort. Die Leiste exportiert keine eigenen Kopien.

**B3: Ein Wechsel von `Aa`, `.*` oder `ab` aktualisiert weder Markierungen noch Zähler.**
- Beleg: `SearchAddon.findNext` setzt `this._state.lastSearchOptions = searchOptions` vor `shouldUpdateHighlighting(term, searchOptions)`, deshalb liefert `didOptionsChange` immer `false` (`SearchAddon.ts:101-105`, `SearchState.ts:didOptionsChange`). Bei gleichem Begriff bleiben die alten Decorations und `resultCount` stehen, während die Auswahl schon mit den neuen Optionen sucht.
- Folge: Der Zähler „1 von 100“ und die Markierung sind nach jeder Optionsänderung falsch (R-LV-3).
- Fix (D): Das Panel merkt sich die Optionen des letzten Addon-Aufrufs (`lastAddonOptions`). Weicht eines der drei Flags ab, ruft es **vor** `findNext`/`findPrevious` zuerst `addon.clearDecorations()` auf. Das löscht auch `cachedSearchTerm`, und das Addon berechnet alles neu.

**B4: Die Copy-on-Select-Regel aus K §4.2 schützt die Zwischenablage nicht. Leere und ungültige Eingaben lassen den Refresh mit dem alten Begriff weiterlaufen.**
- Beleg:
  - K setzt `pointerSelecting` beim `mousedown` und kopiert in `onSelectionChange`, solange das Flag gesetzt ist. Kommt während eines Mausziehens Log-Ausgabe, führt der Addon-Refresh `clearSelection()` und `select(match)` aus. `onSelectionChange` feuert dann mit `pointerSelecting === true`, und der Treffertext landet in der Zwischenablage. Genau das soll R-LV-6 verhindern.
  - `onFind('')` ruft heute nur `term.clearSelection()` (`TerminalPanel.tsx:324`). Ein ungültiger Regex ruft nach K das Addon nicht. In beiden Fällen bleiben `cachedSearchTerm` und die Decorations des alten Begriffs stehen, und der Refresh markiert und selektiert weiter den alten Begriff.
- Fix (D), bindend:
  - Ist die Suchleiste offen (`searchOpenRef.current`), kopiert `onSelectionChange` **nie**.
  - Kopiert wird dann nur beim Loslassen der Maus. Ein `mousedown` (Capture, am vorhandenen `terminalElement`) mit `button === 0` setzt `pointerDown = true`. Ein `window`-Listener für `mouseup` (Bubble) prüft `pointerDown && button === 0`, setzt das Flag zurück und arbeitet nur bei offener Suche weiter. Er liest per `setTimeout(0)` `term.getSelection()`. Ist der Text nicht leer und das Panel sichtbar und nicht verworfen, wird er über `pendingSelection` und `flushCopy()` kopiert, also über denselben Weg wie heute.
  - Die Textvergleichsregel R3 (`:151`) und der Ref `searchQuery` entfallen.
  - Leere Eingabe: `addon.clearDecorations()` und `term.clearSelection()`, Status `idle`. Ungültiges Muster (Vorprüfung `null` **oder** ein Wurf im `try/catch`): ebenfalls `addon.clearDecorations()` und `term.clearSelection()`, Status `invalid`. Schließen: `addon.clearDecorations()` (wie K), Status `idle`.
  - Restrisiko: Bleibt die Maustaste ohne Ziehen gedrückt, während genau dann der Refresh läuft, wird beim Loslassen der Treffer kopiert. Das ist sichtbar selektiert und wird in Kauf genommen (§7).

---

## 2. Vertrag (wörtlich umsetzen)

### 2.1 `src/renderer/src/terminal-follow.ts` (neu, Task A, Welle 1)

```ts
import type { Terminal } from '@xterm/xterm';

/** The few terminal calls the controller needs; a fake implements it in tests. */
export interface FollowTerminal {
  viewportY(): number;
  baseY(): number;
  /** Marker on an absolute buffer line; line() is -1 once the line was trimmed. */
  markLine(line: number): { line(): number; dispose(): void };
  scrollToLine(line: number): void;
  scrollToBottom(): void;
}

export interface FollowController {
  /** Current state; switches to false by itself when onScroll returns 'off'. */
  readonly on: boolean;
  /** From term.onScroll. 'off' when this scroll switched auto-scroll off (scroll up or search jump while on). */
  onScroll(ydisp: number): 'off' | null;
  /** From term.onWriteParsed: puts a held view back after output moved it. */
  onWriteParsed(): void;
  /** Dock checkbox or search jump. Idempotent: the same state does nothing. */
  setFollow(on: boolean): void;
  dispose(): void;
}

export function followController(term: FollowTerminal, initialOn: boolean): FollowController;

/** Adapter for a real xterm: marker offset relative to the cursor line (registerMarker is public API). */
export function xtermFollowTerminal(term: Terminal): FollowTerminal;
```

`xtermFollowTerminal`: `viewportY = term.buffer.active.viewportY`, `baseY = term.buffer.active.baseY`. Für `markLine(line)` gilt `const b = term.buffer.active; const m = term.registerMarker(line - b.baseY - b.cursorY); return { line: () => m.line, dispose: () => m.dispose() }`. Dazu `scrollToLine` und `scrollToBottom` direkt.

**Regeln (bindend).** Zustand: `on`, `marker | null`, `atBottom` (zuletzt beobachtet `viewportY === baseY`), `pending` (Rücksprung vorgemerkt), `busy` (eigener Scroll läuft), `disposed`.

- `setMarker(line)`: Den alten Marker verwerfen und `markLine(line)` setzen. Hat der vorhandene Marker schon `line() === line`, passiert nichts. Das verhindert einen neuen Marker je Ausgabezeile.
- Erzeugung: `on = initialOn`. Ist `initialOn` falsch, folgt `setMarker(viewportY())`. Dann gilt `atBottom = viewportY() === baseY()`.
- `onScroll(ydisp)`: Bei `disposed` oder `busy` → `null`. Sonst `base = baseY()`:
  - **an:** Bei `ydisp < base` folgen `on = false`, `setMarker(ydisp)`, `atBottom = false` und die Rückgabe `'off'`. Sonst gilt `atBottom = true`, Rückgabe `null`.
  - **aus, `ydisp < base`:** `setMarker(ydisp)` (No-op bei gleicher Zeile, also auch bei Ausgabe mit `isUserScrolling` und beim Trimmen), dann `atBottom = false`, Rückgabe `null`.
  - **aus, `ydisp === base`:** Gilt `atBottom` und ein Marker mit `line() < base` existiert, hat die Ausgabe die Ansicht nach unten gezogen. Dann wird `pending = true` gesetzt (`atBottom` bleibt), Rückgabe `null`. Sonst hat der Nutzer bis ans Ende gescrollt: `setMarker(ydisp)`, `atBottom = true`, Rückgabe `null`.
- `onWriteParsed()`: Nur bei `!on && pending && marker`. Dann gilt `pending = false; busy = true; scrollToLine(Math.max(0, marker.line())); busy = false; atBottom = viewportY() === baseY()`.
- `setFollow(next)`: Ist `next === on` oder `disposed`, passiert nichts.
  - `true`: Marker verwerfen, `pending = false`, dann `busy` mit `scrollToBottom()` und `atBottom = true`.
  - `false`: `setMarker(viewportY())` und `atBottom = viewportY() === baseY()`.
- `dispose()`: Marker verwerfen und `disposed = true`. Danach sind alle Methoden No-ops.
- Kommentar im Modul (Englisch): Die Logik setzt `smoothScrollDuration` 0 voraus (xterm-Standard; `terminal-prefs.ts` setzt die Option nicht), weil Scrolls dann synchron `onScroll` feuern.

**Tests (`terminal-follow.test.ts`, Fake mit `viewportY/baseY`, Marker mit Trim-Simulation und Aufrufzählern):**
1. an, `onScroll(y < base)` → `'off'`, `on === false`, Marker auf `y`.
2. an, `onScroll(base)` → `null`, kein Scroll-Aufruf.
3. aus und unten: Ausgabe (`base` +1, `onScroll(base)`) → kein Scroll im `onScroll`. `onWriteParsed` → `scrollToLine(alteZeile)`. Ein reentrantes `onScroll` während des Rücksprungs wird ignoriert.
4. aus und nicht unten: Der Nutzer scrollt bis `base`, der Marker wandert auf `base`. Die nächste Ausgabe springt beim nächsten `onWriteParsed` auf diese Zeile zurück.
5. aus, `onScroll(y)` mit `y === marker.line()` → kein neuer `markLine`-Aufruf.
6. `setFollow(true)` → `scrollToBottom` einmal. Ein zweites `setFollow(true)` ruft nichts.
7. `setFollow(false)` → `markLine(viewportY)`. Ein zweites `setFollow(false)` ruft nichts.
8. Getrimmter Marker (`line() === -1`) → Rücksprung auf `scrollToLine(0)`.
9. `followController(term, false)` setzt den Marker sofort.
10. Nach `dispose` passieren keine Aufrufe mehr, und der Marker ist verworfen.

### 2.2 `TerminalPanel` (Task D, Welle 2)

```ts
interface TerminalPanelProps {
  … // unchanged
  /** Log panels in a dock: auto-scroll state owned by the dock; the panel reports scroll-up and search jumps as false. */
  follow?: { on: boolean; onChange: (on: boolean) => void };
  /** Log panels in a dock: a value different from the one at mount opens and focuses the search bar. */
  searchRequest?: number;
}
```

- `follow` und `searchRequest` sind **keine** Abhängigkeiten des Sitzungs-Effekts (`:282`), sonst verbindet das Panel neu. Sie werden über `followRef.current = follow` gelesen.
- Im Sitzungs-Effekt nach `term.open` gilt: `const controller = followRef.current ? followController(xtermFollowTerminal(term), followRef.current.on) : null; controllerRef.current = controller;`. Dazu kommen `term.onScroll(y => { if (controller?.onScroll(y) === 'off') followRef.current?.onChange(false); })` und `term.onWriteParsed(() => controller?.onWriteParsed())`. Im Cleanup werden beide Abos und `controller?.dispose()` aufgeräumt sowie `controllerRef.current = null` gesetzt.
- Ein eigener Effekt gilt: `useEffect(() => { controllerRef.current?.setFollow(follow?.on ?? true); }, [follow?.on])`. Er steht **nach** dem Sitzungs-Effekt.
- `searchRequest`: `const firstSearchRequest = useRef(searchRequest)`. Der Effekt `[searchRequest]` öffnet nur, wenn `searchRequest !== undefined && searchRequest !== firstSearchRequest.current`. Er setzt `searchOpenRef.current = true`, ruft `setSearchOpen(true)` und `setSearchFocus(n => n + 1)` auf (K8).
- `logPanel = connection.kube ? connection.kube.mode !== 'shell' : connection.target?.mode === 'logs'` gilt **ohne** `embedded` (E1). Der Wert wird bei jedem Render berechnet und über `logPanelRef` im Key-Handler gelesen.
- `allowProposedApi: true` (`:106`) mit Kommentar: „Search decorations (match highlights, result count) need the proposed decoration API. Nothing else may use proposed APIs.“
- Key-Handler (`attachCustomKeyEventHandler`, nur `keydown`, sonst `true`):
  - `matchesShortcut(event, { ctrl: true, shift: true, code: 'KeyF' })` öffnet in **jedem** Panel außer eingebetteten Shells (heutiges Verhalten plus Log-Docks).
  - `matchesShortcut(event, { ctrl: true, shift: false, code: 'KeyF' })` öffnet nur bei `logPanelRef.current`.
  - `event.key === 'F3'` ohne Strg und Alt geht nur bei `logPanelRef.current && searchOpenRef.current` mit Umschalt rückwärts, sonst vorwärts. Aufgerufen wird `runFindRef.current(last.query, last.options, …, false)`.
  - `event.key === 'Escape'` ohne Modifier schließt nur bei `logPanelRef.current && searchOpenRef.current`.
  - In allen behandelten Fällen folgen `event.preventDefault()` und `return false`. Shells im Hauptfenster bekommen weder F3 noch Esc (vim, less).
- Render: `{searchOpen && (!embedded || logPanel) && <TerminalSearchBar onFind={runFind} onClose={closeSearch} focusRequest={searchFocus} status={searchStatus} />}`.
- `runFind(query, options, direction, incremental)` (über `runFindRef` auch für den Key-Handler):
  1. `lastSearch.current = { query, options }`.
  2. `query === ''`: `activeQuery.current = ''`, `addon.clearDecorations()`, `term.clearSelection()`, Status `idle`, Ende.
  3. `compileSearch(query, options) === null`: `activeQuery.current = ''`, `clearDecorations()`, `clearSelection()`, Status `invalid`, Ende.
  4. Weichen die Optionen von `lastAddonOptions.current` ab, folgt `addon.clearDecorations()` (B3). Danach `lastAddonOptions.current = options` und `activeQuery.current = query`.
  5. `const styles = getComputedStyle(document.documentElement)` und `const opts = { ...options, incremental, decorations: xtermSearchDecorations(name => styles.getPropertyValue(name)) }`.
  6. `try { found = direction === 'next' ? addon.findNext(query, opts) : addon.findPrevious(query, opts); } catch { activeQuery.current = ''; clearDecorations(); clearSelection(); status invalid; return; }`
  7. Nach `found === true` folgen `controllerRef.current?.setFollow(false)` und `followRef.current?.onChange(false)` (K2).
- `search.onDidChangeResults(event => …)` wird im Sitzungs-Effekt abonniert. Ereignisse zählen nur bei `searchOpenRef.current && activeQuery.current !== ''`. Sie setzen `setSearchStatus(searchStatusOf(event))` über `report(…)` (K19).
- `closeSearch`: `searchOpenRef.current = false`, `activeQuery.current = ''`, `searchAddon.current?.clearDecorations()`, Status `idle`, `setSearchOpen(false)`, `clearSelection()`, `focus()`.
- Copy-on-Select nach B4.

### 2.3 `src/renderer/src/log-search.ts` (neu, Task B, Welle 1)

```ts
import type { LogEntry } from './kube-logs';

export interface SearchOptions { regex: boolean; caseSensitive: boolean; wholeWord: boolean }
export const DEFAULT_SEARCH_OPTIONS: Readonly<SearchOptions> = { regex: false, caseSensitive: false, wholeWord: false };
/** Same as the xterm search addon's default highlight limit. */
export const SEARCH_LIMIT = 1000;

export type SearchStatus =
  | { kind: 'idle' }                                   // empty query
  | { kind: 'count'; index: number; count: number }    // index 0-based; shown as "1 von 100"
  | { kind: 'many'; count: number }                    // at least SEARCH_LIMIT matches; count === SEARCH_LIMIT
  | { kind: 'total'; count: number }                   // matches, but no current one known
  | { kind: 'none' }                                   // no match
  | { kind: 'invalid' };                               // regex does not compile

/** Global RegExp ('g' or 'gi', never 'u'), or null for '' and for a regex that does not compile. */
export function compileSearch(query: string, options: SearchOptions): RegExp | null;

export interface LineMatch { seq: number; start: number; end: number }
/** Non-empty matches in the order of `lines`, only in `line.text`; at most `limit`, truncated when one more exists. */
export function findMatches(lines: readonly LogEntry[], pattern: RegExp, limit?: number): { matches: LineMatch[]; truncated: boolean };
/** Matches grouped by line, for rendering. */
export function matchesBySeq(matches: readonly LineMatch[]): ReadonlyMap<number, readonly LineMatch[]>;
/** Text split around the matches of one line; `current` is marked 'current', the others 'match'. */
export function markParts(text: string, lineMatches: readonly LineMatch[], current: LineMatch | null): { text: string; mark: 'match' | 'current' | null }[];
/** Next index, cyclic; from -1, 'next' gives 0 and 'previous' gives count - 1; -1 when count is 0. */
export function stepMatch(index: number, count: number, direction: 'next' | 'previous'): number;
/** Index of the remembered match after the matches changed: exact (seq, start), else the first match of the same line, else min(lastIndex, count - 1); -1 when there is no match or nothing is remembered. */
export function refindMatch(matches: readonly LineMatch[], current: { seq: number; start: number } | null, lastIndex: number): number;
/** Status from the xterm addon's onDidChangeResults. */
export function searchStatusOf(result: { resultIndex: number; resultCount: number }, limit?: number): SearchStatus;
/** Status of the log list. */
export function listSearchStatus(query: string, pattern: RegExp | null, matchCount: number, truncated: boolean, currentIndex: number): SearchStatus;
```

Regeln:
- `compileSearch`:
  - `''` → `null`.
  - Flags: `caseSensitive ? 'g' : 'gi'`.
  - Bei Regex zuerst `new RegExp(query, flags)` im `try`. Wirft das, gilt `null`. Die **rohe** Eingabe wird geprüft, bevor sie eingeklammert wird (K6): `a)(?:b` ist allein ungültig und wäre in `(?:…)` gültig, das Addon würde daran werfen.
  - Klartext wird mit `/[.*+?^${}()|[\]\\]/g` → `'\\$&'` maskiert.
  - Ganzes Wort umschließt den Quelltext mit `(?<=^|[WORD_SEP])(?:…)(?=$|[WORD_SEP])`. `WORD_SEP` ist die Zeichenmenge des Addons ` ~!@#$%^&*()+\`-=[]{}|\;:"',./<>?` plus Tab, korrekt für eine Zeichenklasse maskiert und als benannte Konstante mit Kommentar „mirrors NON_WORD_CHARACTERS of @xterm/addon-search 0.16“.
- `findMatches`: Vor jeder Zeile gilt `pattern.lastIndex = 0`. Bei einem leeren Treffer folgt `pattern.lastIndex++`, und der Treffer wird nicht aufgenommen. `truncated` ist wahr, sobald ein `(limit + 1)`-ter Treffer gefunden wird, dann bricht die Suche ab.
- `searchStatusOf`:
  - `resultCount === 0` → `none`.
  - `resultCount >= limit` → `many` mit `count: limit`.
  - `resultIndex < 0` → `total`.
  - Sonst `count`.
- `listSearchStatus`:
  - `query === ''` → `idle`.
  - `pattern === null` → `invalid`.
  - `matchCount === 0` → `none`.
  - `truncated` → `many` mit `count: SEARCH_LIMIT`.
  - `currentIndex < 0` → `total`.
  - Sonst `count`.
- Tests (`log-search.test.ts`):
  - Escape von `a.b`, `(x)` und `[`.
  - Flags `g` und `gi`, nie `u`.
  - `''` und ungültig → `null`, außerdem `a)(?:b` → `null`.
  - Wort: `foo` trifft `foo bar` und `x.foo`, aber nicht `foobar` und `foo_bar`.
  - Reihenfolge, Limit und `truncated` bei genau 1 000 und bei 1 001 Treffern.
  - `a*` auf `baaa` liefert genau `aaa`.
  - Zwei Treffer in einer Zeile.
  - `markParts` mit `current`.
  - `stepMatch` zyklisch und ab -1.
  - `refindMatch` für die Fälle exakt, gleiche Zeile, Fallback und leer.
  - `searchStatusOf` und `listSearchStatus` je Zweig.

### 2.4 `TerminalSearchBar` (Task D, Welle 2)

```ts
import type { SearchOptions, SearchStatus } from '../log-search';
export interface TerminalSearchBarProps {
  /** One search step; '' clears. The host reports the outcome through `status`. */
  onFind: (query: string, options: SearchOptions, direction: 'next' | 'previous', incremental: boolean) => void;
  onClose: () => void;
  /** A change focuses and selects the input. */
  focusRequest: number;
  status: SearchStatus;
  /** aria-label of the bar; default t('terminal:search.label'). */
  label?: string;
}
```

- Die Leiste ist unkontrolliert: Begriff und Optionen leben in ihr. Sie startet mit `DEFAULT_SEARCH_OPTIONS`.
- Reihenfolge der Elemente: Eingabe, `Aa`, `.*`, `ab`, Status, Zurück, Weiter, Schließen.
- Die Optionsknöpfe haben `type="button"`, `className="terminal-search-option"`, `aria-pressed` und `aria-label`/`title` aus `terminal:search.caseSensitive|regex|wholeWord`. Beschriftet sind sie mit `Aa`, `.*` und `ab`. Ein Klick sucht sofort mit `onFind(value, nextOptions, 'next', true)` (K11).
- Tippen löst `onFind(query, options, 'next', true)` aus.
- Tasten im Eingabefeld:
  - Enter oder F3: weiter, mit Umschalt zurück, mit `incremental: false`.
  - Esc schließt (`preventDefault`, `stopPropagation`).
  - Strg+F und Strg+Umschalt+F wählen den Text im Feld aus (`preventDefault`, `stopPropagation`).
- Statustext:
  - `idle` → `''`
  - `count` → `t('terminal:search.count', { index: formatNumber(index + 1), total: count })`
  - `many` → `t('terminal:search.many', { total: count })`
  - `total` → `t('terminal:search.total', { count })`
  - `none` → `t('terminal:search.none')`
  - `invalid` → `t('terminal:search.invalidRegex')`
  - `formatNumber` kommt aus `../../../shared/format`.
  - `aria-invalid={status.kind === 'invalid' || undefined}` steht an der Eingabe.
- `import '../terminal-comfort-ui.css';` steht in der Leiste selbst, weil `WorkloadLogs` sie ohne `TerminalPanel` rendert.

### 2.5 Docks und `WorkloadLogs` (Task E, Welle 2)

**Zustand je Dock (beide Docks gleich):**

```ts
const [followOff, setFollowOff] = useState<string | null>(null);
// A new log target starts with auto-scroll on, also when the user comes back to an earlier one.
if (followOff !== null && followOff !== logKey) setFollowOff(null);
const follow = logKey === null || followOff !== logKey;
const setFollow = (on: boolean): void => setFollowOff(on ? null : logKey);
const [searchRequest, setSearchRequest] = useState(0);
```

`logKey` (K1):
- `ContainerDock`: `terminalMode === 'logs' && terminalConnection && row ? \`ctr:${dockTerminalKey(row, 'logs', epoch)}\` : null`.
- `DetailDock`: `const workloadKey = workload ? \`${refKey(workload.ref)}/${logFormat}/${epoch}\` : null`. Dieser Wert ersetzt auch den heutigen `WorkloadLogs`-Key (`:187`). Damit gilt `logKey = workloadShown ? (logsAllArmed && workloadKey ? \`all:${workloadKey}\` : null) : ((terminalKind === 'logs' || terminalKind === 'previous') && target && podRef && container ? \`pod:${dockTerminalKey(refKey(podRef), container, terminalKind, epoch, target.format ?? 'compact')}\` : null)`.

**Leiste:** Häkchen und Lupe stehen nur bei `open && logKey !== null`, nach dem Hinweis und „Als Tab öffnen“, vor `Kompakt/Roh` bzw. `Kopieren`:

```tsx
<label className="kube-dock-follow">
  <input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} />
  {t('common:logs.autoScroll')}
</label>
<button type="button" className="kube-dock-search" aria-label={t('common:logs.search')} title={t('common:logs.search')}
  onClick={() => setSearchRequest(value => value + 1)}>
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
</button>
```

**An `TerminalPanel`:** `follow={logKey ? { on: follow, onChange: setFollow } : undefined}` und `searchRequest={logKey ? searchRequest : undefined}`. Shell-Panels bekommen beides nicht.

**`WorkloadLogs`:**

```ts
interface WorkloadLogsProps {
  … // unchanged
  /** Auto-scroll checkbox of the dock. */
  follow: boolean;
  onFollow: (on: boolean) => void;
  /** A value different from the one at mount opens and focuses the search bar (dock button). */
  searchRequest: number;
}
```

- Folgen (K7):
  - Die Layout-Wirkung „ans Ende“ hängt an `follow` und nicht an `frozen === null`: `useLayoutEffect(() => { if (follow && list) list.scrollTop = list.scrollHeight; }, [lines, follow])`.
  - `useEffect(() => { if (follow) setFrozen(null); else setFrozen(previous => previous ?? { entries: log.entries, received: log.received }); }, [follow])`. Die Regel zu `log` dokumentiert die Abhängigkeit mit einem `eslint-disable-next-line react-hooks/exhaustive-deps` und dem Kommentar „snapshot at the moment auto-scroll went off“.
  - `onScroll` lautet `if (follow && list && list.scrollHeight - list.scrollTop - list.clientHeight > SCROLL_SLACK) onFollow(false)`.
  - Eine Filteränderung friert bei `frozen` wie heute neu ein.
  - Der Knopf `.kube-logs-follow` entfällt.
  - `stateText` hängt `...(!follow && newer > 0 ? [t('kubernetes:logsAll.newer', { count: newer })] : [])` nach `summary` an.
- Suche:
  - Zustand: `searchOpen`, `query`, `options`, `cursor: { seq: number; start: number; index: number } | null`, `scrollTick: number`.
  - `pattern = useMemo(() => compileSearch(query, options), …)`.
  - `{ matches, truncated } = useMemo(() => pattern ? findMatches(lines, pattern) : { matches: [], truncated: false }, …)`.
  - `byLine = useMemo(() => matchesBySeq(matches), …)`.
  - `currentIndex = refindMatch(matches, cursor, cursor?.index ?? -1)`.
  - `current = currentIndex >= 0 ? matches[currentIndex] : null`.
  - `status = listSearchStatus(query, pattern, matches.length, truncated, currentIndex)`.
- `onFind(q, o, direction, incremental)`:
  1. `setQuery(q); setOptions(o)`.
  2. Lokal rechnen: `p = compileSearch(q, o)`, `m = p ? findMatches(lines, p).matches : []`.
  3. Ist `m` leer, folgen `setCursor(null)` und das Ende. Follow bleibt unverändert.
  4. `base = refindMatch(m, cursor, cursor?.index ?? -1)`.
  5. `index = incremental ? (base >= 0 ? base : (direction === 'next' ? 0 : m.length - 1)) : stepMatch(base, m.length, direction)`.
  6. `setCursor({ seq: m[index].seq, start: m[index].start, index })`, `onFollow(false)`, `setScrollTick(n => n + 1)`.
- Sprung: `useLayoutEffect(() => { listRef.current?.querySelector('mark.is-current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [scrollTick])`. Es gibt kein `behavior` (Motion-Gate, K14).
- Zeilen: Bei `searchOpen && pattern && byLine.has(line.seq)` rendert `markParts(line.text, byLine.get(line.seq)!, current)` als `<mark className="is-match">` bzw. `<mark className="is-match is-current">`. Sonst gilt das heutige `highlightParts` (Filtermarken).
- Leiste: Unter `.kube-logs-bar` und über `.kube-logs-sources` steht `<TerminalSearchBar onFind={onFind} onClose={close} focusRequest={searchFocus} status={status} label={t('kubernetes:logsAll.search')} />`.
- `close` setzt `searchOpen = false`, `query = ''` und `cursor = null`, dann `listRef.current?.focus()`.
- Tasten: `onKeyDown` am Wurzel-`div.kube-logs`.
  - Strg+F und Strg+Umschalt+F (über `matchesShortcut`) öffnen und fokussieren mit `preventDefault`.
  - F3 und Umschalt+F3 springen bei offener Leiste mit dem letzten Begriff und den letzten Optionen (E3).
- `searchRequest`: Die Erst-Wert-Regel wie in §2.2 gilt (K8).
- `kube-logs.ts` bleibt unverändert.

---

## 3. Korrekturen (bindend)

- **K1 Zustand je Log-Ziel:** Das `followOff`-Muster aus K §4.1 startet beim Wechsel zurück zu einem früheren Ziel wieder mit „aus“ (A aus → B → A). Das verletzt R-LV-1. Fix: Rücksetzen im Render wie in §2.5. Die `logKey`-Formeln und die Sichtbarkeit (`open && logKey !== null`) gelten wie in §2.5, mit den Präfixen `ctr:`, `pod:` und `all:`, damit sich die Schlüssel nicht überschneiden.
- **K2 Sprung schaltet aus, aber erst nach dem Fund:** K ruft `follow.onChange(false)` **vor** `findNext`. Bei einer Eingabe ohne Treffer würde das Autoscroll trotzdem ausschalten (Widerspruch zu K §4.3). Fix: nach `found === true` folgen `controller.setFollow(false)` (synchron) und `follow.onChange(false)`. Scrollt das Addon beim Sprung, meldet der Controller schon vorher `'off'`. Beides ist idempotent.
- **K3 Status aus dem Addon:** Die Zuordnung `resultIndex === -1 → many` ist falsch. -1 tritt auch bei weniger als 1 000 Treffern auf, etwa bei „Ganzes Wort“, wenn die Rückwärtssuche einen Treffer findet, den die Vorwärtssammlung wegen des Zeilenverwerfens nicht hat. Ab 1 000 Treffern bleibt `resultIndex` oft ≥ 0. Fix: `searchStatusOf` in §2.3, mit neuer Art `total`.
- **K4 Platzhalter:** `{{count}}` mit einem String unterdrückt zwar die Plural-Suche, umgeht aber die Formatierung über `COUNT_KEYS`. Mit einer Zahl sucht i18next dagegen `_one`/`_other`. Fix: `search.count` = `{{index}} von {{total}}`, `search.many` = `mehr als {{total}} Treffer` (`total` ist ein `COUNT_KEY`, deshalb gibt es keine Plural-Suche). `index` wird mit `formatNumber` vorformatiert. `search.total_one/_other` und `logsAll.newer_one/_other` laufen mit der Zahl `count`. Die Texte stehen in §5.
- **K5 Wiederfinden des aktuellen Treffers:** „Position nach `seq`, dann `start`“ setzt eine Liste voraus, die nach `seq` geordnet ist. `mergeLines` ordnet aber nach Zeit. Fix: `refindMatch` aus §2.3 (exakt, dann gleiche Zeile, dann letzter Index). Der Cursor merkt sich `index`.
- **K6 `compileSearch`:** Erst wird die rohe Eingabe geprüft, dann eingeklammert. „Ganzes Wort“ folgt der Zeichenmenge des Addons und nicht `\b`. Ohne `u` würde `\b` zum Beispiel `ber` in `über` als ganzes Wort treffen, das Addon tut das nicht. `''` → `null`, die Aufrufer prüfen `''` zuerst. Die Details stehen in §2.3.
- **K7 Folgen in `WorkloadLogs`:** Hinge „ans Ende“ an `frozen === null`, käme ein Log-Ereignis zwischen `onFollow(false)` und dem Einfrier-Effekt, und die Liste spränge trotz Hochscrollen ans Ende. Fix: `follow` steuert direkt (§2.5).
- **K8 `searchRequest` beim Remount:** Der Dock-Zähler bleibt beim Zielwechsel erhalten. Ein neu gemountetes Panel mit `searchRequest > 0` würde die Suche sofort öffnen. Fix: Es öffnet nur ein Wert, der sich vom Wert beim Mount unterscheidet (§2.2, §2.5).
- **K9 Refresh-Verhalten richtig beschreiben:** Der Zähler aktualisiert sich bei wachsenden Logs erst 200 ms nach der letzten Ausgabe (Debounce) und auch nach einer Größenänderung. Bei Dauerausgabe bleibt er stehen, bis eine Pause kommt. Der aktive Treffer bleibt erhalten. Das kommt so ins Handbuch, und K §4.3 gilt entsprechend.
- **K10 Key-Handler mit Refs:** Der Handler wird einmal im Sitzungs-Effekt angehängt. `searchOpen`, `runFind`, `logPanel` und die letzte Suche liest er über `searchOpenRef`, `runFindRef`, `logPanelRef` und `lastSearch` (§2.2). F3 und Esc gelten nur in Log-Panels.
- **K11 Optionswechsel sucht inkrementell:** K schreibt `incremental: false`. Im Addon ist `incremental` wirkungslos (§0), entscheidend ist B3. In der Liste würde `false` aber zum **nächsten** Treffer springen. Fix: `incremental: true` (bleibt auf dem aktuellen Treffer, wenn er noch passt).
- **K12 CSS-Spezifität und Tokens:**
  - `.terminal-search button` (0,1,1) setzt `border: 0`, Breite und Farbe aller Knöpfe der Leiste. Die gedrückten Optionen brauchen deshalb `.terminal-search .terminal-search-option[aria-pressed="true"] { border: 1px solid var(--color-accent); background: var(--color-bg-selected); color: var(--color-text); }`.
  - Der Status bekommt `min-width: var(--width-search-status)` mit dem neuen Token `--width-search-status: 12ch` (Rolle „Breite des Trefferzählers der Suchleiste“) in `tokens.css`. Er ist nicht im hellen Block, weil er keine Farbe ist.
  - `.terminal-search input[aria-invalid="true"] { border-color: var(--color-danger); }`, Vorbild `editor-ui.css:30`.
  - `.kube-dock-follow { display: inline-flex; align-items: center; gap: var(--space-4); font-size: var(--fs-sm); white-space: nowrap; }`.
  - `.kube-dock-search` hat dieselben Maße wie `.kube-dock-toggle` (`min-height: var(--control-xs); width: var(--control-sm); padding: 0;` plus `display: grid; place-items: center;`).
  - Die Regeln `.kube-logs-follow` und `[aria-pressed="true"]` (`kubernetes-dock.css:12-13`) werden entfernt.
  - Die Dock-Flex-Regeln sind schon da (`kubernetes-ui.css:114-117`), C fasst sie nicht an.
- **K13 Kontraste neu gerechnet (WCAG 2.x):** Die Token-Werte aus K §4.4 bleiben. In die Doku kommen die gerechneten Werte:

  | Paar | dunkel | hell |
  |---|---|---|
  | `--color-text-code` auf `--color-match-bg` | 8,09 (`#e6e2dc`/`#4a3f12`) | 14,50 (`#221e1a`/`#fff1a8`) |
  | `--color-text-code` auf `--color-match-current-bg` | 4,84 (`/#7a5c08`) | 11,57 (`/#ffd34d`) |
  | `--color-match-current-border` gegen aktuellen Treffer | 4,08 | 4,45 |
  | `--color-match-current-border` gegen `--color-bg-stage` | 12,45 | 6,36 |
  | `--color-match-bg` gegen `--color-bg-stage` | 1,83 | 1,14 |
  | aktueller gegen übrigen Treffer (Fläche) | 1,67 | 1,25 |

  Den aktuellen Treffer unterscheidet der Rand (≥ 3:1 gegen Fläche und Bühne). Die Fläche „alle Treffer“ ist eine zusätzliche Hervorhebung, die Information tragen Zähler und Rand. Das ist E6. K nannte für hell `#1d1915`, der Text der Bühne ist aber `--color-text-code` `#221e1a`.
- **K14 Sprung in der Liste:** `scrollIntoView` gilt für `mark.is-current` und nicht für die Zeile, mit `block: 'nearest', inline: 'nearest'`, weil `.kube-logs-line` `white-space: pre` hat und Treffer rechts außerhalb liegen können. Es gibt kein `behavior`.
- **K15 Dateizuordnung und Doku:**
  - E fasst `kube-logs.ts` nicht an.
  - F bekommt zusätzlich `.claude/skills/run-app/fakes.test.mjs` und `.claude/skills/run-app/SKILL.md` (Szenenliste `:25`, Shot-Liste `:35`, Fake-Beschreibung bei `:206`).
  - F fasst `CHANGELOG.md`, `package.json` und `package-lock.json` nicht an (Spec-Ruling).
  - Veraltete Verweise in K: `terminal-access.ts:74` → `:77`, `screens.mjs` `terminal-search` liegt bei `:871-886` (das `waitFor` bei `:883`), `kube-logs` bei `:393-430`.
- **K16 Pflichtfelder der Decorations:** `xtermSearchDecorations` gibt `NonNullable<ISearchOptions['decorations']>` zurück (Typimport aus `@xterm/addon-search`; `ISearchDecorationOptions` ist dort nicht exportiert). Die Werte: `matchBackground` und `matchOverviewRuler` = match, `activeMatchBackground` und `activeMatchColorOverviewRuler` = activeMatch, `activeMatchBorder` = activeBorder. Kein `matchBorder`.
- **K17 Hex-Pflicht prüfen:** `terminal-theme.test.ts` prüft für `XTERM_SEARCH_TOKENS` wie bisher, dass die Fallbacks dem ersten (dunklen) Vorkommen entsprechen. Zusätzlich prüft der Test, dass **beide** Vorkommen jedes Such-Tokens in `tokens.css` dem Muster `/^#[0-9a-f]{6}$/i` folgen, weil xterm `#RRGGBB` verlangt.
- **K18 Farbwechsel:** Neue Farben greifen bei der nächsten Suchaktion (Tippen, Enter, F3, Option). Der Addon-Refresh nutzt die Farben des letzten Aufrufs. Das ist hinnehmbar und kommt in die Spec-Doku. Ein Live-Umfärben gibt es nicht.
- **K19 Veraltete Statusereignisse:** Nach `clearDecorations` feuert der noch laufende Addon-Timer einmal mit `resultCount: 0`. Ohne Schutz würde das `invalid` oder `idle` mit `none` überschreiben. Fix: Der `activeQuery`-Schutz aus §2.2.

---

## 4. Entscheidungen und Ergänzungen

- **E1 Ruling: Strg+F in jedem Log-Panel, auch im Hauptfenster** — Ein per „Als Tab öffnen“ geöffneter Log-Tab ist ebenfalls ein Log-Panel. `docker logs` und `pods/log` werten Eingaben nicht aus. — Kosten: keine bekannten. Shells (Hauptfenster und Dock) behalten Strg+F (R1). Das Häkchen gibt es nur im Dock, Hauptfenster-Tabs haben keinen Controller (xterm-Standard).
- **E2 Standardoptionen:** Alle drei sind aus, wie heute (Groß/Klein egal, kein Regex). Die Reihenfolge der Leiste steht in §2.4.
- **E3 F3 in „Logs aller Pods“:** Bei offener Leiste auch mit Fokus in der Liste (§2.5).
- **E4 Ruling: README-Bilder werden nicht neu erzeugt** — `screenshot-containers.png` entsteht vor dem Öffnen des Docks (`screens.mjs:276-281`), `screenshot-kubernetes.png` ohne Auswahl (`:304-308`). Ohne Log-Ziel zeigt die Dock-Leiste weder Häkchen noch Lupe. — Kosten: keine.
- **E5 Token-Liste im Lint:** C nimmt `match-bg`, `match-current-bg` und `match-current-border` in `COLORS` von `design-tokens.test.ts` auf. R9 und R19 schützen sie damit.
- **E6 Ruling: Die helle Fläche „alle Treffer“ hat nur 1,14:1 gegen Weiß** — Die Information tragen Zähler und Rand des aktuellen Treffers (≥ 4,45:1). Eine dunklere Fläche würde sich vom aktuellen Treffer und der Kupfer-Auswahl schlechter abheben (§3 K13). — Kosten: Im hellen Modus sind nicht-aktuelle Treffer dezent.
- **E7 Ruling: Gelb für Suchtreffer** — Ein Treffer ist ein Zustand („gefunden“, „aktuell“) und kein Akzent. Kupfer bleibt bei Fokus, gedrückten Optionen und Auswahl. — Kosten: Gelb erscheint neben Warnungen. Die Doku nennt die Rolle ausdrücklich: Zustandstabelle „Suchtreffer“, Token-Tabellen dunkel und hell, Motion-Gate-Zeile „Treffer-Sprung (xterm-Scroll, `scrollIntoView`): nicht, ohne `smooth`“. Zeile `:297` heißt jetzt „„Automatisch scrollen“ setzt `scrollTop` ohne `smooth`“. „Gedrückt“ (`:246`) ersetzt „`Folgen` an“ durch „Suchoptionen `.terminal-search-option`: Rand `--color-accent` + `--color-bg-selected`“. `:321` nennt die Suchleiste in Dock-Terminals und in „Logs aller Pods“.
- **E8 Abnahme-Szenen (F):**
  - `sshd.mjs`: Ein Exec, dessen Befehl auf `/(?:^|\s)docker logs -f --tail 500 ([A-Za-z0-9_.-]+)$/` passt (tatsächlicher Befehl: `PATH="$PATH:/usr/sbin:/sbin" docker logs -f --tail 500 api`), liefert für Namen aus `CONTAINERS` 60 Zeilen mit **CRLF**. Der Exec läuft mit pty, nacktes `\n` würde in xterm treppen. Jede zehnte Zeile ist `ERROR …`, die übrigen sind `GET /api/orders 200 …`. Danach folgt jede Sekunde eine weitere Zeile, bis `stream` schließt (`close` räumt das Intervall). Unbekannte Namen bekommen `Error: No such container: <name>` auf stderr mit Exit 1.
  - Die Zeilenerzeugung ist eine exportierte reine Funktion (`dockerLogLine(name, n)`), der Befehlsabgleich ebenfalls (`dockerLogsRef(command)`). `fakes.test.mjs` prüft beide.
  - `containers`: Die Höhenprüfung bleibt und läuft jetzt mit echtem Log-Inhalt.
  - Neue Szene `container-logs`:
    - web-01 Container-Ansicht, Zeile `api`, Taste `l`.
    - `waitFor` auf `.kube-dock-terminal .xterm-rows` mit `GET`.
    - Fokus ins Terminal, dann `Control+F`, tippen `ERROR`.
    - `waitFor` auf Status mit ` von ` und `.xterm-find-active-result-decoration` (Decorations aktiv, also `allowProposedApi`).
    - Häkchen `.kube-dock-follow input` ist nach dem Sprung aus.
    - Text der ersten Zeile in `.xterm-rows` merken, 2,5 s warten, er ist unverändert.
    - Häkchen an, dann `waitFor` darauf, dass die letzte Zeile die neueste ist.
    - Ein `WheelEvent` (`deltaY: -400`) auf `.kube-dock-terminal .xterm-screen` schaltet das Häkchen aus.
    - Shot `container-logs-search`.
    - Danach hell nach dem Muster von `theme-light` (`setTheme('light')` mit Rücksetzen im `finally` wie dort): Shot `container-logs-search-light`.
  - `kube-logs`:
    - Nach dem Filter folgen Lupe `.kube-dock-search`, `.*` an, tippen `ERR(OR|)`.
    - `waitFor` auf Status mit ` von ` und genau einen `mark.is-current`.
    - Das Häkchen ist aus. Nach 2,5 s ist die Zeilenzahl gleich, und `.kube-logs-state` enthält `neue Zeile`.
    - Shot `kube-logs-search`.
  - `terminal-search`: Das `waitFor` bei `:883` prüft `textContent.includes(' von ')` und `.xterm-find-active-result-decoration`.
  - `SKILL.md` wird nachgezogen.
- **E9 Reine Helfer in `log-search.ts`:** `stepMatch`, `refindMatch`, `searchStatusOf`, `listSearchStatus` und `matchesBySeq` liegen in B (getestet). D und E bleiben dünn.
- **E10 Adapter im Controller-Modul:** `xtermFollowTerminal` gehört zu A, damit D nur verdrahtet.
- **E11 Proposed-API-Grenze für das Review:** `grep -rn "registerDecoration\|\.markers\b\|\.unicode\b\|registerCharacterJoiner" src/renderer/src` darf außer Tests nichts finden. Heute ist die Liste leer.
- **E12 Handbuch (F):**
  - `:87` wird neu gefasst. Strg+Umschalt+F im Terminal, Strg+F und Strg+Umschalt+F in Logs und Log-Docks. Enter/F3 weiter, Umschalt+Enter/Umschalt+F3 zurück, Esc schließt. Optionen `Aa`, `.*` und `ab`. Zähler „1 von 100“, ab 1 000 „mehr als 1.000 Treffer“. Bei offener Suche kopiert nur eine Mausauswahl.
  - `:114` bekommt eine Tabellenzeile `Strg+F` | „Suche in Logs“.
  - Neuer Unterabschnitt „Automatisch scrollen“ (Häkchen je Ziel, Hochscrollen schaltet aus, ein Sprung schaltet aus, Einschalten springt ans Ende, ein neues Ziel startet an).
  - `:627-635`: „Folgen“ wird durch das Häkchen und „n neue Zeilen“ in der Statuszeile ersetzt. Dazu kommen die Suche (nur angezeigte Zeilen, nur Zeilentext, eine Markierungsart je Zeile), das Refresh-Verhalten nach K9 und ReDoS (ein katastrophales Muster kann die Oberfläche blockieren).
  - README: Eine neue Zeile in der Feature-Liste: `- **Log viewer** – search container and pod logs with match count, case, whole-word and regex options, and turn auto-scroll off per log with a checkbox.` Die Zeile „Terminal comfort“ (`:46`) bleibt.

---

## 5. Texte (wörtlich; ersetzt K §4.5)

| Datei (Task) | Key | de-DE | en-US |
|---|---|---|---|
| terminal (D) | `search.next` (ändern) | Nächster Treffer (Eingabe, F3) | Next match (Enter, F3) |
| terminal (D) | `search.previous` (ändern) | Vorheriger Treffer (Umschalt+Eingabe, Umschalt+F3) | Previous match (Shift+Enter, Shift+F3) |
| terminal (D) | `search.count` | {{index}} von {{total}} | {{index}} of {{total}} |
| terminal (D) | `search.many` | mehr als {{total}} Treffer | more than {{total}} matches |
| terminal (D) | `search.total_one` | 1 Treffer | 1 match |
| terminal (D) | `search.total_other` | {{count}} Treffer | {{count}} matches |
| terminal (D) | `search.invalidRegex` | Ungültiger regulärer Ausdruck | Invalid regular expression |
| terminal (D) | `search.caseSensitive` | Groß-/Kleinschreibung beachten | Match case |
| terminal (D) | `search.regex` | Regulärer Ausdruck | Regular expression |
| terminal (D) | `search.wholeWord` | Ganzes Wort | Whole word |
| terminal (D) | `layoutMenu.shortcutsHint` (ändern) | Strg+Umschalt+F sucht im Terminal, Strg+F in Logs. Strg+Tab und Strg+Umschalt+Tab wechseln den Tab, Strg+Umschalt+T öffnet eine Verbindung, Strg+Umschalt+W schließt den Tab. | Ctrl+Shift+F searches the terminal, Ctrl+F searches logs. Ctrl+Tab and Ctrl+Shift+Tab switch tabs, Ctrl+Shift+T opens a connection, Ctrl+Shift+W closes the tab. |
| common (E) | `logs.autoScroll` | Automatisch scrollen | Auto-scroll |
| common (E) | `logs.search` | In Logs suchen (Strg+F) | Search logs (Ctrl+F) |
| kubernetes (E) | `logsAll.newer_one` | 1 neue Zeile | 1 new line |
| kubernetes (E) | `logsAll.newer_other` | {{count}} neue Zeilen | {{count}} new lines |
| kubernetes (E) | `logsAll.search` | Suche in den Logs aller Pods | Search the logs of all pods |
| kubernetes (E) | entfernen | `logsAll.follow`, `logsAll.followNew` | ebenso |

`search.label`, `search.input`, `search.placeholder`, `search.close` und `search.none` bleiben. Im Code stehen die Keys nur als volle Literale, zum Beispiel `t('terminal:search.total', { count })` und `t('kubernetes:logsAll.newer', { count: newer })` (Waisen-Test (d) entfernt `_one/_other`). `Aa`, `.*` und `ab` lösen den Test (g) nicht aus, ein `i18n-ignore` ist unnötig.

---

## 6. Wellen und Tasks (ersetzt K §6 und Spec „Wellen“; dateidisjunkt je Welle)

| Welle | Task | Dateien (ausschließlich) | Inhalt | grün nach |
|---|---|---|---|---|
| 1 | **A Follow-Controller** | `src/renderer/src/terminal-follow.ts` (neu), `src/renderer/src/terminal-follow.test.ts` (neu) | §2.1 inkl. `xtermFollowTerminal`, 10 Tests | Task |
| 1 | **B Suchlogik** | `src/renderer/src/log-search.ts` (neu), `src/renderer/src/log-search.test.ts` (neu) | §2.3 (Typen-Heimat, B2), K6, E9 | Task |
| 1 | **C Tokens, CSS, Doku** | `src/renderer/src/tokens.css`, `src/renderer/src/terminal-theme.ts`, `src/renderer/src/terminal-theme.test.ts`, `src/renderer/src/design-tokens.test.ts`, `src/renderer/src/terminal-comfort-ui.css`, `src/renderer/src/kubernetes-dock.css`, `src/renderer/src/kubernetes-ui.css`, `docs/design-system.md` | Tokens K §4.4 dunkel und hell plus `--width-search-status`. `XTERM_SEARCH_TOKENS/FALLBACKS` und `xtermSearchDecorations` (K16, K17). Klassen K12, `mark.is-match`/`.is-current` nach K §4.4 (Text `--color-text-code`, Rand per `outline: 1px solid var(--color-match-current-border)`). `.kube-logs-follow` entfernen. `COLORS` (E5). Doku E7, K13 | Task |
| 2 | **D Terminal-Seite** | `src/renderer/src/components/TerminalSearchBar.tsx`, `src/renderer/src/components/TerminalPanel.tsx`, `src/shared/locales/de-DE/terminal.json`, `src/shared/locales/en-US/terminal.json` | §2.2, §2.4, B1-Verdrahtung, B3, B4, K2, K3, K8 bis K11, K19, Texte §5 (terminal) | Welle |
| 2 | **E Dock-Seite** | `src/renderer/src/components/containers/ContainerDock.tsx`, `src/renderer/src/components/kubernetes/DetailDock.tsx`, `src/renderer/src/components/kubernetes/WorkloadLogs.tsx`, `src/shared/locales/{de-DE,en-US}/common.json`, `src/shared/locales/{de-DE,en-US}/kubernetes.json` | §2.5, K1, K5, K7, K8, K14, E3, Texte §5 (common, kubernetes) | Welle |
| 3 | **F Abnahme und Doku** | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/sshd.mjs`, `.claude/skills/run-app/fakes.test.mjs`, `.claude/skills/run-app/SKILL.md`, `docs/handbuch.md`, `README.md` | E8, E12. Kein `CHANGELOG.md`, `package.json` oder `package-lock.json` | Task |

**Abhängigkeiten und Typecheck:**
- Welle 1 ist rein additiv. A, B und C sind unabhängig, nichts Bestehendes wird entfernt, und nach jeder Task sind `npm run typecheck` und `npx vitest run` grün. Die neuen Exporte (`xtermSearchDecorations`, `log-search`, `terminal-follow`) sind bis Welle 2 unbenutzt. Das ist zulässig, weil der Waisen-Test nur Locale-Keys prüft.
- Welle 2: D und E arbeiten gleichzeitig gegen die Verträge in §2.2, §2.4 und §2.5. **D** ist allein typisierbar, weil es nur Welle-1-Module nutzt. **E** sieht bis zum Abschluss von D erwartbare Typfehler in den eigenen Dateien, nämlich unbekannte Props `follow`/`searchRequest` an `TerminalPanel` sowie `status`/`label` und die neue `onFind`-Signatur an `TerminalSearchBar`. E meldet sie und behebt sie **nicht** in D-Dateien. Grün ist erst das Wellenende, der Orchestrator prüft dann `npm run typecheck` und `npx vitest run`. Der Waisen-Test ist am Wellenende grün, weil jeder Namespace genau einer Task gehört und Keys in derselben Task wie ihre Verwendung entstehen (D: terminal; E: common, kubernetes, einschließlich der Entfernung von `logsAll.follow*` zusammen mit dem Knopf).
- Welle 3 braucht D und E. F startet die App nach Skill `run-app` und prüft die Szenen `containers`, `kube-logs`, `container-logs` und `terminal-search`. Die Screenshots werden angesehen (dunkel und mindestens einmal hell).

---

## 7. Restrisiken (zur Kenntnis, keine Aufgabe)

- Läuft der Addon-Refresh, während die Maustaste ohne Ziehen gedrückt ist, kopiert das Loslassen den sichtbar selektierten Treffer (B4).
- Im dunklen Modus (`minimumContrastRatio` 1) können ANSI-farbige Logzeilen auf `--color-match-current-bg` schwach wirken.
- Ändert sich die Dock-Höhe bei „aus“ und Ansicht ganz unten, verschiebt xterm die Ansicht um die Zeilendifferenz. Der Controller korrigiert erst bei der nächsten Ausgabe.
- Ein katastrophaler Regex blockiert den Renderer. Das Addon führt ihn bei jedem Refresh über den ganzen Scrollback aus, die Liste über höchstens 2 000 Zeilen (Spec-Nicht-Ziel, im Handbuch benannt).
- Mehr als 1 000 Treffer: In der Liste reicht die Navigation nur über die ersten 1 000 in Listenreihenfolge, im Terminal springt das Addon weiter. Der Status sagt in beiden Fällen „mehr als 1.000 Treffer“.
