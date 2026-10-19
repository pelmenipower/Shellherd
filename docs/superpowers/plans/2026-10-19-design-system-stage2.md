# Designsystem Stufe 2 – Recherche

Stand: 2026-10-19 · Basis `claude/feature/design-system` (HEAD `81f2ad2`) · Umsetzung auf `claude/feature/design-system-stage2` · Version bleibt 0.9.0

> „schließe die offenen punkte ab“ – S1 Lint-Keyframes dateiübergreifend · S2 Maße falten + Lint · S3 Toast statt `.app-error` · S4 xterm-Theme aus Tokens · S5 Aliase entfernen + Lint

Maßstab (bindend): `animate/SKILL.md`, `emil-design-eng/SKILL.md`, Spec `docs/superpowers/specs/2026-10-19-design-system-design.md` (D1–D10), Validierung `…-validation.md` (bindend), Plan `docs/superpowers/plans/2026-10-19-design-system.md` 6.2, Reviews `.superpowers/sdd/ds-final-review.md` und `ds-final-rereview.md` (N1). Alle Sicherheitsregeln früherer Specs gelten weiter. Diese Stufe ändert keine Main-, Preload- oder Shared-Datei, keinen IPC und keine Klasse. Messwerte stammen aus der Electron-Layout-Probe (`…\scratchpad\layout-probe\stage2.cjs`, `stage2b.cjs`): echtes CSS in Bundle-Reihenfolge, Vorher/Nachher per Override-Stylesheet.

## 0. Empfehlung in einem Absatz

Alle fünf Punkte sind reine Renderer-Arbeit und lassen sich in drei Wellen schließen. **S2** ist der größte: Elf Control-Höhen werden zu vier (24/28/32/36), sieben Leistenhöhen zu drei (24/32/44), elf Schriftgrößen zu sechs, und die Abstände bekommen eine **Skala mit zehn Stufen (2–32 px, benannt nach ihrem Wert: `--space-2` … `--space-32`)**, weil der Bestand 54-mal 10 px nutzt und die T-Shirt-Skala aus Stufe 1 dafür keinen Platz hat (sie ist bisher nirgends in Gebrauch, Umbenennung kostet nichts). Jede wertändernde Faltung steht unten mit Datei:Zeile und Messwert; die größten sichtbaren Änderungen sind View-Leiste 30 → 32 (Bühne −2 px), Editor- und Assistent-Kopf 40 → 32, Chip-Leiste 41 → 33. Drei Kopplungen zwischen CSS und TSX (Pane-Kopf 32, Tabellenzeile 24, Statusleiste/App-Kopf 24/44) werden **nicht** angefasst, sondern durch eine Lint-Regel festgeschrieben. Danach verbietet der Lint literale Pixel in `height`, `min-height`, `font-size`, `font`, `padding*`, `gap`, `margin*` – mit präzisen Ausnahmen (0, 1 px, negative Werte, Dekorgeometrie ≤ 16 px, Flächen ≥ 48 px, alles in `calc()`/`min()`/`max()`/`clamp()`). **S3** ersetzt den Fluss-Balken durch einen Toast unten rechts über der Statusleiste: Transitions statt Keyframes, Eintritt per `@starting-style`, Exit auf demselben Weg (`translateY(100%)`, 220 ms `--ease-out`), kein Fokusraub, kein Zeitlimit, Schließen nur per Knopf, `role="alert"` wie heute. Weil die native RDP-Fläche über dem DOM liegt, blockiert der Toast sie wie Menüs und Dialoge. **S4** liest die vier xterm-Farben per `getComputedStyle` vor dem Konstruktor (kein Flackern, gilt in beiden Fenstern), mit Fallback auf die heutigen Literale, deren Gleichheit mit `tokens.css` ein Test prüft. **S5** streicht die 18 Aliase; der Lint verbietet Deklaration und Nutzung. **S1** sammelt bewegte Keyframes über alle Dateien.

## 1. Bestand und Lücken

### 1.1 S1 – Lint R7b nur dateiintern

| Befund | Wo |
|---|---|
| `movingKeyframes` entsteht pro `lint(file, css)`; ein bewegter Keyframe in `tokens.css` (dort liegt `tm-pulse`) und seine ungegatete Nutzung in einer anderen Datei bleiben grün | `src/renderer/src/design-tokens.test.ts:80-84,111-112` |
| Heute ungefährlich: `tm-pulse` ändert nur Opazität, `workspace-menu-in` liegt und wirkt in `navigation-ui.css:41,43` | `tokens.css:88`, `navigation-ui.css:39-43` |

### 1.2 S2 – Maße

**Control-Höhen (acht Werte außerhalb der Skala 24/28/32/36):**

| Wert | Wo |
|---|---|
| 20 | `styles.css:132` `.version-button` |
| 22 | `terminal-ui.css:83` `.view-close/.view-add`, `:85` `.view-rename`; `files-ui.css:19` `.file-path nav button`, `:32` `.file-action-error button`; `kubernetes-ui.css:70` `.kube-chipbar-reset/.kube-empty-action`, `:136` `.kube-col-filter-clear` (Geometrie: 24 − 2), `:141` `.kube-group-by select` |
| 26 | `terminal-ui.css:11` `.terminal-tab` (Geometrie: 28 − 2); `files-ui.css:12` `.file-pane-tools button/select`, `:47` `.file-row-head`, `:84` `.transfer-job button`; `kubernetes-ui.css:23` `.kube-ns select`, `:28` `.kube-help-button`; `assistant-ui.css:29` `.assistant-status button`; `workflows-ui.css:30` `.workflow-footer button` |
| 30 | `files-ui.css:26,27` `.file-prompt input/button`, `:107` `.permissions-octal input` |
| 32 (Chips) | `.kube-filter-chip` ist ein `button` ohne eigene `min-height`, also 32 hoch (`kubernetes-ui.css:19,63`, global `styles.css:11`); die Chip-Leiste misst 41 px, die Art-Tabs daneben 33 px (gemessen) |

**Leistenhöhen (außerhalb 24/32/44):** View-Leiste 30 (`terminal-ui.css:77`), Dateikopf 34 (`files-ui.css:8`), Transfer-Kopf 30 (`files-ui.css:66`), Dock-Leiste 30 (`kubernetes-ui.css:92`), Editor-Kopf 40 (`styles.css:83`), Assistent-Kopf 40 (`assistant-ui.css:3`).

**Schriftgrößen (außerhalb 11/12/13/14/18/22):** 10 (`terminal-ui.css:80`, `kubernetes-ui.css:43,73,96`, `navigation-ui.css:44,59`), 15 (`styles.css:46`, `kubernetes-ui.css:112`), 16 (`assistant-ui.css:6`, Glyphen ⚙ und ×), 17 (`files-ui.css:88`), 20 (`styles.css:80`), 24 (`styles.css:25`). Zwei `font`-Kurzformen mit Literal: `kubernetes-ui.css:76` `12px/24px`, `:104` `12px/1.45`, dazu `styles.css:3` `13px/1.45`.

**Abstände:** 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 24, 28, 32 und 72. Außerhalb jeder 2er-Skala: 3 (`terminal-ui.css:7,8`, `files-ui.css:72`, `kubernetes-ui.css:119,136`, `editor-ui.css:12,22,28`, `navigation-ui.css:53`, `workflows-ui.css:11`), 5 (`styles.css:11`, `editor-ui.css:4,10,15,29`, `navigation-ui.css:48`), 7 (`styles.css:15`, `editor-ui.css:5`, `kubernetes-ui.css:19,39`, `terminal-ui.css:65`), 9 (`styles.css:15`, `editor-ui.css:5`), 14 (`styles.css:121,136`, `kubernetes-ui.css:110,135`, `files-ui.css:89`, `assistant-ui.css:40,42`, `workflows-ui.css:7,9,22,28,29`), 18 (`styles.css:99,114,123,130`), 28 (`styles.css:104,121`). **10 px steht 54-mal** (`gap: 10px` elfmal, `padding: 8px 10px` neunmal, `padding: 0 10px` siebenmal …) und fehlt in der Stufe-1-Skala `--space-2xs…4xl` (`tokens.css:47-48`). Kein CSS nutzt bisher `--space-*` (Grep: 0 Treffer außerhalb `tokens.css`).

**Kopplungen CSS ↔ TSX (dürfen sich nicht verschieben):**

| Maß | CSS | TSX |
|---|---|---|
| Pane-Kopf 32 | `terminal-ui.css:5,7,19,33,35,50` | `SplitTerminalArea.tsx:209,226` (`y - top < 32`), `:395` (`calc(${top}% + 32px)`, `calc(${height}% - 32px)`) |
| Tabellenzeile 24 | `kubernetes-ui.css:76-78,131,133,135` | `ResourceTable.tsx:9` `ROW_HEIGHT = 24`, `ContainerTable.tsx:12` (Fensterung, Spacer-Höhen `:215,242` / `:179,208`) |
| App-Kopf 44, Statusleiste 24 | `styles.css:59,84` | keins, aber `styles.css:97` `top: 44px; bottom: 24px` (schmale Seitenleiste) |
| Layout-Menü unter dem Kopf | `terminal-ui.css:35` `top: 32px` | – |
| Workspace-Menü unter Summary | `navigation-ui.css:32` `top: 36px` = Summary 32 + 4 | – |

xterm fittet über `ResizeObserver` (`TerminalPanel.tsx:134`), RDP synchronisiert über `ResizeObserver` plus `useLayoutEffect` (`RdpPanel.tsx:101-108`). Eine Leistenänderung in der Flex-Spalte ändert die Bühnengröße und löst beides aus.

### 1.3 S3 – `.app-error`

| Befund | Wo |
|---|---|
| Fluss-Element zwischen Arbeitsfläche und Statusleiste: `display:flex; padding: 6px 12px`, Knopf 32 hoch → der Balken ist 44 px hoch und **verkleinert die Bühne** (xterm-Fit, RDP-Resync) | `styles.css:87`, `App.tsx:859`, `SecondaryWindow.tsx:112-113` |
| Verhalten: `role="alert"`, Text + Knopf „Schließen“ (`aria-label="Fehlermeldung schließen"`), **kein** Zeitlimit, **kein** Escape, **kein** Fokuswechsel, nächste Aktion ersetzt oder löscht den Text (`setError(null)` an rund 15 Stellen) | `App.tsx:131,278-726`, `SecondaryWindow.tsx:22,38,71-81` |
| Statusleiste zeigt parallel „Aktion fehlgeschlagen“, solange `error` gesetzt ist | `App.tsx:860` |
| Quellen: Vault-/Workspace-Fehler, `MAX_SSH_SESSIONS`, deaktivierte Verbindungen, Tab-Transfer (`useTabTransfer`), Drop einer Nicht-`.term`-Datei | `App.tsx:229,555-562,608-726`, `useTabTransfer.ts:60,76` |
| Zweitfenster: gleiche Markup, aber ohne Statusleiste | `SecondaryWindow.tsx:97-114` |
| Die native RDP-Fläche liegt **über** dem DOM; jedes HTML-Overlay blockiert sie (14 Aufrufer von `useNativeSurfaceBlock`, u. a. Picker, Kontextmenü, alle Dialoge, Palette) | `native-surface.ts`, `RdpPanel.tsx:35-36,124-126` |
| Gate-Tabelle: „Stufe 2: eigener Toast“ | `docs/design-system.md:184` |

### 1.4 S4 – xterm-Theme

`TerminalPanel.tsx:49-51`: `theme: { background: '#070b14', foreground: '#dce9f8', cursor: '#67e8f9', selectionBackground: '#164e63' }` – Literale von `--color-bg-stage`, `--color-text-code`, `--color-accent`, `--color-selection-bg` (E4-Ausnahme, `docs/design-system.md:219`). Der Terminal-Font `Consolas, "Cascadia Mono", monospace` weicht bewusst von `--font-mono` ab (`ui-monospace` zuerst). Beide Fenster laden denselben Bundle (`main.tsx:4-6,13`), `styles.css` wird vor dem React-Render importiert. Der Kube-Dock-Terminal nutzt dieselbe Komponente.

### 1.5 S5 – Aliase

18 Aliase in `tokens.css:79-85`, von R9 **verlangt** (`design-tokens.test.ts:61-63,139-141`), von R12 außerhalb `tokens.css` verboten. Nutzung: 0 Treffer in CSS außerhalb `tokens.css`, 0 Treffer `var(--`/`setProperty` in TS/TSX, `index.html` ohne Inline-CSS. Entfernen ist gefahrlos.

## 2. Entscheidungen (Rulings dieser Stufe)

| # | Ruling | Warum | Kosten, falls falsch |
|---|---|---|---|
| S2-1 | **Abstands-Skala wird numerisch:** `--space-2, -4, -6, -8, -10, -12, -16, -20, -24, -32` ersetzt `--space-2xs…4xl`. | 10 px ist der dritthäufigste Abstand; die T-Shirt-Skala hat keinen Platz dafür, und sechs parallele Umsetzer brauchen eine Zuordnung ohne Deutung. Die alten Namen sind unbenutzt. | eine Doku-Tabelle |
| S2-2 | **Kopplungen bleiben literal im TSX** (32 Pane-Kopf, 24 Zeile). Der Lint schreibt `--bar-md: 32px`, `--control-xs: 24px`, `--bar-sm: 24px`, `--bar-lg: 44px` fest (R17). | Fensterung und Drop-Zonen rechnen mit den Zahlen. Ein Token im CSS ohne Guard wäre eine stille Falle. | Wer die Höhen ändern will, ändert Token und TSX zusammen; der Test sagt es ihm |
| S2-3 | Geometrie, die sich aus einem Container ergibt, steht als `calc(var(--…) ± n px)`: Terminal-Tab 26 = `calc(var(--control-sm) - 2px)`, Filter-Clear 22 = `calc(var(--control-xs) - 2px)`, Workspace-Menü `top` = `calc(var(--control-md) + var(--space-4))`. | Sie sind keine eigenen Höhen, sondern Folgen einer anderen. | keine |
| S2-4 | **Nicht gefaltet:** `line-height: 18px/20px/22px` (nicht im Umfang), `width` (nur quadratische Knöpfe folgen der Höhe), `max-height`, `top/left/right/bottom`, Dekorgeometrie ≤ 16 px (Punkte, Griffe, Meter, Trenner, Icons, Hairlines), Flächen ≥ 48 px (`textarea` 60/64, Palette `margin-top` 72, `clamp()`-Grenzen). | Keine Skala dafür, kein Nutzen, kein Risiko. | keine |
| S2-5 | Chips in der Chip-Leiste bekommen `min-height: var(--control-xs)`; die Leiste wird 41 → 33 px und gleich hoch wie die Art-Tabs (33). | Roter Faden Punkt 5 wörtlich („24 in Tabellen und Chip-Leisten“), gemessen ohne Überlauf (Text 18 + Rand 2 = 20 < 24). | 8 px Dichte in Cluster- und Container-Ansicht; eine Zeile |
| S2-6 | Editor- und Assistent-Kopf 40 → 32 (`--bar-md`). | Plan 6.2 „Leisten 40 → 32“; Inhalt (Icon-Knopf 32, Select 28) passt, gemessen. | 8 px Dichte in zwei Panels |
| S3-1 | **Toast ohne Zeitlimit, ohne Escape, Schließen nur per Knopf.** | Verhalten von heute; Fehler sind der einzige Kanal für fehlgeschlagene Aktionen, und Escape gehört dem Terminal und den Dialogen. Der Toast nimmt nie Fokus. | keine |
| S3-2 | Der Toast **blockiert die native RDP-Fläche** (`useNativeSurfaceBlock`), solange er sichtbar ist. Der Platzhaltertext bleibt („… solange ein Menü geöffnet ist.“, gilt heute auch für Dialoge). | Sonst läge der Toast hinter dem RDP-Fenster und die Fehlermeldung wäre unsichtbar – schlechter als heute. Menüs und Dialoge machen es genauso. | RDP ist ausgeblendet, bis der Nutzer „Schließen“ klickt; heute verkleinert der Balken die RDP-Fläche |
| S3-3 | Position unten rechts über der Statusleiste (`right: var(--space-12); bottom: calc(var(--bar-sm) + var(--space-12))`), im Zweitfenster `bottom: var(--space-12)`. Breite `min(520px, 100vw − 24px)`. | Verschiebt kein Layout, deckt die Statusleiste nicht ab, liegt dort, wo heute die Meldung erscheint. | keine |
| S3-4 | Transitions, Eintritt per `@starting-style`, Exit über die Klasse `.is-closing` und `transitionend` (Fallback-Timer 300 ms); ein neuer Fehler während des Ausblendens retargetet (kein Neustart). Dauer `--dur-toast: 220ms` (neuer Token, ≤ 300). | `animate` Schritt 6: Transitions statt Keyframes bei schnell wiederholbaren Elementen, Exit = Enter-Pfad. | keine |
| S3-5 | Toast-Zustand als reine Funktion `toast-state.ts` mit Test; die Komponente ist dünn. | Das Repo testet Logik ohne DOM (`vitest` ohne jsdom). | keine |
| S4-1 | Vier Farben per `getComputedStyle(document.documentElement)` **vor** `new Terminal`, Fallback auf die heutigen Literale; `terminal-theme.test.ts` prüft, dass die Fallbacks den Werten in `tokens.css` entsprechen. Font und `fontSize` bleiben. | Kein Flackern (Theme steht vor dem ersten Paint), kein weißer Blitz, falls das Stylesheet einmal fehlt; die Doppelpflege ist durch den Test abgesichert. Ein anderer Terminal-Font wäre eine Funktionsänderung. | keine |
| S5-1 | Aliase werden gelöscht; R9 verlangt, dass **keiner** der 18 Namen deklariert ist; R12 gilt auch für `tokens.css`. | D2 („entfallen in 1.0“) vorgezogen, weil nichts sie nutzt. | keine |
| S1-1 | `movingKeyframes` wird einmal über alle `FILES` gesammelt und an `lint` übergeben; Fixtures bleiben lokal. | N1 | keine |
| ALLG | Keine neue Farbe, kein neuer UI-Text, keine Klassen-Umbenennung, kein Main/Preload/Shared, Version 0.9.0, CHANGELOG-Eintrag ergänzt. | D1, D8, D9 | – |

## 3. S2 – Faltungstabellen

### 3.1 Tokens (`tokens.css`, ersetzt Zeilen 46-48, 79-85; ergänzt Motion)

```css
  /* Spacing, named by value. The lint allows literal px only for 0, 1px, negatives, ≥ 48px and inside calc()/min()/max()/clamp(). */
  --space-2: 2px; --space-4: 4px; --space-6: 6px; --space-8: 8px; --space-10: 10px;
  --space-12: 12px; --space-16: 16px; --space-20: 20px; --space-24: 24px; --space-32: 32px;
  …
  --dur-press: 120ms; --dur-fade: 150ms; --dur-popover: 160ms; --dur-hint: 180ms; --dur-modal: 200ms; --dur-toast: 220ms;
```

Der Alias-Block (Zeilen 79-85) entfällt ersatzlos. `--control-*`, `--bar-*`, `--fs-*`, `--radius-*` bleiben wörtlich.

### 3.2 Mechanische Zuordnung (gilt in jeder Datei)

| Literal | Token |
|---|---|
| Höhe/Min-Höhe 24, 28, 32, 36 an Controls | `--control-xs/-sm/-md/-lg` |
| Leistenhöhe 24, 32, 44 (`height`, `min-height`, `flex: 0 0 …`, `top`/`bottom` als Leistenabstand) | `--bar-sm/-md/-lg` |
| `font-size` 11, 12, 13, 14, 18, 22 | `--fs-xs/-sm/-md/-lg/-xl/-2xl` |
| `font: 13px/1.45 …` → `font: var(--fs-md)/1.45 …`; `12px/24px` → `var(--fs-sm)/var(--control-xs)`; `12px/1.45` → `var(--fs-sm)/1.45` | `--fs-*` in der Kurzform |
| Abstände 2, 4, 6, 8, 10, 12, 16, 20, 24, 32 in `padding*`, `gap`, `margin*` | `--space-<Wert>` |
| Quadratische Knöpfe: `width`/`flex-basis` gleich der Höhe (z. B. `.icon-button` 32, `.pane-action` 28, `.terminal-tab-add` 28, `.assistant-icon` 28, `.kube-help-button`, `.kube-dock-toggle`) | gleicher `--control-*`-Token (Empfehlung, nicht geprüft) |

### 3.3 Wertändernde Faltungen (vollständig, Datei:Zeile, vorher → nachher, Messung)

**`styles.css` (T1)**

| Zeile | Vorher | Nachher | Wirkung (gemessen) |
|---|---|---|---|
| 11 | `button padding: 5px 10px` | `var(--space-4) var(--space-10)` | Knopfhöhe bleibt 32 (`min-height` greift) |
| 15 | `input, textarea, select padding: 7px 9px` | `var(--space-8)` | Höhe 36 fest, Textarea 64 unverändert; Text 1 px weiter innen |
| 25 | `h1 font-size: 24px` | `var(--fs-2xl)` (22) | Welcome-Karte 122.8 → 120.4 |
| 46 | `.brand font-size: 15px` | `var(--fs-lg)` (14) | Marke 99.5 → 95.4 breit |
| 80 | `.workspace-placeholder h1 20px` | `var(--fs-2xl)` (22) | Platzhaltertitel +2 |
| 83 | `.properties-heading height: 40px` | `var(--bar-md)` (32) | Editor-Kopf 40 → 32, Icon-Knopf 32 passt (S2-6) |
| 99 | `.welcome-card padding: 18px` (≤ 700 px) | `var(--space-20)` | – |
| 104 | `.welcome-page header margin-bottom: 28px` | `var(--space-24)` | – |
| 114, 123, 130 | `padding-left: 18px` (Listen) | `var(--space-20)` | Einzug +2 |
| 121 | `.whats-new margin: 0 0 28px; padding: 14px 16px` | `0 0 var(--space-24)`; `var(--space-16)` | – |
| 132 | `.version-button height: 20px` | `var(--control-xs)` (24) | füllt die 24-Statusleiste, bleibt innerhalb (gemessen) |
| 136 | `.file-drop-hint padding: 8px 14px` | `var(--space-8) var(--space-16)` | – |
| 87 | `.app-error …` | **gelöscht** (durch T8 in Welle 2) | – |

Dazu Kopplungen: 59 `flex: 0 0 var(--bar-lg)`, 84 `flex: 0 0 var(--bar-sm)`, 97 `top: var(--bar-lg); bottom: var(--bar-sm)`, 36 `.icon-button width/flex var(--control-md)`, 47 `.brand-mark var(--control-sm)`.

**`terminal-ui.css` (T3)**

| Zeile | Vorher | Nachher | Wirkung |
|---|---|---|---|
| 7 | `.terminal-tab-bar gap: 3px` | `var(--space-4)` | Tab-Abstand +1 |
| 8 | `.terminal-tab-item padding-right: 3px` | `var(--space-4)` | Tab 104.5 → 105.5 breit |
| 11 | `.terminal-tab height/min-height: 26px` | `calc(var(--control-sm) - 2px)` | unverändert (S2-3); **nicht** 28, sonst überlagert der Knopf den 1-px-Rand des Items |
| 65 | `.connection-picker-option padding: 7px 8px` | `var(--space-8)` | Option +2 hoch |
| 77 | `.view-bar flex: 0 0 30px; min-height: 30px` | `var(--bar-md)` (32) | Bühne 718 → 716; xterm und RDP folgen per ResizeObserver |
| 80 | `small font-size: 10px` | `var(--fs-xs)` (11) | – |
| 83 | `.view-close, .view-add 22px` | `var(--control-xs)` (24) | füllen den 24-Tab |
| 85 | `.view-rename height: 22px` | `var(--control-xs)` | – |

Kopplungen: 5, 7 `var(--bar-md)`; 19 `.pane-action height/min-height var(--bar-md)`, Breite `var(--control-sm)`; 33 `.empty-pane top: var(--bar-md)`; 35 `.pane-layout-menu top: var(--bar-md)`; 50 `.tab-drop-marker height: var(--bar-md)`; 20 `var(--control-xs)`; 24 `var(--control-sm)`. `.rdp-surface` und `.terminal-panel` bleiben ohne Höhenliteral (R13 unberührt).

**`files-ui.css` (T5)**

| Zeile | Vorher | Nachher | Wirkung |
|---|---|---|---|
| 8 | `.file-pane-header min-height: 34px` | `var(--bar-md)` (32) | 34 → 32 |
| 12 | `.file-pane-tools button/select 26px` | `var(--control-sm)` (28) | passt in 32 |
| 19 | `.file-path nav button 22px` | `var(--control-xs)` (24) | Pfadzeile bleibt 29 |
| 26, 27 | `.file-prompt input/button 30px` | `var(--control-md)` (32) | Eingabezeile +2 |
| 32 | `.file-action-error button 22px` (+ `width`) | `var(--control-xs)` | Fehlerzeile 35 → 37 |
| 47 | `.file-row-head min-height: 26px` | `var(--control-sm)` (28) | 26 → 28; **nicht** 24, das ergäbe 25 (Knopf 24 + Rand 1) |
| 66 | `.transfer-queue header min-height: 30px` | `var(--bar-md)` | 30 → 32 |
| 72 | `.transfer-main gap: 3px` | `var(--space-2)` | – |
| 84 | `.transfer-job button 26px` | `var(--control-sm)` | Job 39 → 41 |
| 88 | `.conflict-dialog h2 17px` | `var(--fs-xl)` (18) | – |
| 89 | `margin: 0 0 14px` | `0 0 var(--space-12)` | – |
| 107 | `.permissions-octal input 30px` | `var(--control-md)` | – |

`progress height: 4px` (78), `input 16px` (105), sr-only `1px` (110) bleiben literal (≤ 16).

**`kubernetes-ui.css`, `kubernetes-dock.css`, `containers-ui.css` (T6)**

| Zeile | Vorher | Nachher | Wirkung |
|---|---|---|---|
| 19 | `.kube-chip padding: 0 7px` | `0 var(--space-8)` | Chip +2 breit |
| 23 | `.kube-ns select height: 26px` | `var(--control-sm)` | Kopf bleibt 79 (Knöpfe 32 bestimmen) |
| 28 | `.kube-help-button min-height/width: 26px` | `var(--control-sm)` | 26 → 28, quadratisch |
| 39 | `.kube-node padding: 4px 7px` | `var(--space-4) var(--space-8)` | – |
| 43 | `.kube-dot font-size: 10px` | `var(--fs-xs)` | Punkt 6 → 6.7 breit, Kachel unverändert |
| 63 | `.kube-filter-chip` | zusätzlich `min-height: var(--control-xs)` | Chip 32 → 24, Leiste 41 → 33 (S2-5) |
| 70 | `.kube-chipbar-reset, .kube-empty-action 22px` | `var(--control-xs)` | – |
| 73, 96 | `kbd font-size: 10px` | `var(--fs-xs)` | – |
| 76 | `font: 12px/24px var(--font-mono)` | `var(--fs-sm)/var(--control-xs) var(--font-mono)` | unverändert |
| 92 | `.kube-dock-bar min-height: 30px` | `var(--bar-md)` | 30 → 32, Dock-Körper −2 |
| 104 | `font: 12px/1.45` | `var(--fs-sm)/1.45` | – |
| 110 | `.kube-modal padding: 14px` | `var(--space-16)` | – |
| 112 | `.kube-help-head h2 15px` | `var(--fs-lg)` (14) | – |
| 119 | `.kube-help-row dt gap: 3px` | `var(--space-4)` | – |
| 131 | `.kube-filter-row th top: 24px` | `var(--control-xs)` | Kopplung an Kopfzeile |
| 135 | Filterfeld `height: 24px; padding: 0 14px 0 4px; line-height: 22px; font-size: 11px` | `var(--control-xs)`; `0 var(--space-16) 0 var(--space-4)`; `calc(var(--control-xs) - 2px)`; `var(--fs-xs)` | Text endet 2 px früher, Clear-Knopf hat Platz |
| 136 | `.kube-col-filter-clear height: 22px; padding: 0 3px` | `calc(var(--control-xs) - 2px)`; `0 var(--space-4)` | Knopf 13 → 15 breit |
| 141 | `.kube-group-by select height: 22px` | `var(--control-xs)` | – |

`th/td height: 24px` (77, 78), `.kube-col-filter height` (133) → `var(--control-xs)` (R17 hält 24 fest, `ROW_HEIGHT` bleibt). `.kube-meter-bar 5px`, `.kube-chip-sep 14px`, `.kube-dock-handle 6px` bleiben literal. `kubernetes-dock.css`: 24 → `--control-xs`, 12 → `--fs-sm`, `2px 8px` → `var(--space-2) var(--space-8)`. `containers-ui.css:4`: `gap: var(--space-4) var(--space-10)`.

**`assistant-ui.css`, `workflows-ui.css` (T7)**

| Zeile | Vorher | Nachher | Wirkung |
|---|---|---|---|
| a:3 | `.assistant-header min-height: 40px` | `var(--bar-md)` | 40 → 32, Select 28 + Icons 28 passen (S2-6) |
| a:6 | `.assistant-icon font-size: 16px` | `var(--fs-xl)` (18) | Glyphen ⚙/× etwas größer, Knopf bleibt 28 |
| a:29 | `.assistant-status button 26px` | `var(--control-sm)` | – |
| a:40, 42 | `margin: 0 0 14px` | `0 0 var(--space-12)` | – |
| w:7 | `.workflow-title padding: 12px 14px 0` | `var(--space-12) var(--space-16) 0` | – |
| w:9 | `.workflow-search margin: 10px 14px; height: 36px` | `var(--space-10) var(--space-16)`; `var(--control-lg)` | – |
| w:11 | `.workflow-list li gap: 3px` | `var(--space-2)` | Eintrag 55.2 → 54.2 |
| w:22 | `.workflow-params padding: 12px 14px` | `var(--space-12) var(--space-16)` | – |
| w:28 | `.field-error margin: 0 14px 8px` | `0 var(--space-16) var(--space-8)` | – |
| w:29 | `.workflow-footer padding: 8px 14px` | `var(--space-8) var(--space-16)` | – |
| w:30 | `.workflow-footer button 26px` | `var(--control-sm)` | – |

`.assistant-input textarea min-height: 60px` (a:31) und `.workflow-palette margin: 72px auto auto` (w:3) bleiben literal (≥ 48). `line-height: 18px` (w:18) bleibt.

**`components/editor-ui.css`, `components/navigation-ui.css` (T4)**

| Zeile | Vorher | Nachher | Wirkung |
|---|---|---|---|
| e:4 | `label gap: 5px` | `var(--space-4)` | – |
| e:5 | `padding: 7px 9px` | `var(--space-8)` | Höhe 36 fest (e:6), Textarea 64 |
| e:10 | `legend padding: 0 0 5px` | `0 0 var(--space-4)` | – |
| e:12 | `.connection-icon-options gap: 3px` | `var(--space-4)` | – |
| e:15 | `margin-bottom: 5px` | `var(--space-4)` | – |
| e:22 | `summary padding: 3px 0` | `var(--space-4) 0` | Summary +2 |
| e:28 | `input[type=color] padding: 3px` | `var(--space-4)` | Farbfeld 2 px kleiner innen |
| e:29 | `.field-error margin: 5px 0 0` | `var(--space-4) 0 0` | – |
| n:32 | `.workspace-menu-content top: 36px` | `calc(var(--control-md) + var(--space-4))` | unverändert |
| n:44 | `.workspace-dirty font-size: 10px` (≤ 1000 px) | Deklaration **löschen** (Basis 11 gilt) | – |
| n:48 | `.context-menu padding: 5px` | `var(--space-4)` | Menü 79 → 77 |
| n:53 | `.context-menu-heading padding: 6px 10px 3px` | `var(--space-6) var(--space-10) var(--space-2)` | – |
| n:59 | `.tree-node-badge font-size: 10px` | `var(--fs-xs)` | – |

`.tree-toggle width/min-width: 26px` und `.tree-toggle-spacer` (n:9, 10) bleiben (Breite, nicht im Umfang). `e:32,40 min-height: 32px` → `var(--control-md)`, `line-height: 18px` bleibt.

### 3.4 Neue Lint-Regeln (präzise)

Wert-Tokenizer: Der Deklarationswert wird auf oberster Ebene an Leerzeichen und Kommas getrennt; Klammerinhalte (`calc(`, `min(`, `max(`, `clamp(`, `var(`) zählen als **ein** Token und werden nicht geprüft. Ein Literal ist `/^-?(?:\d+\.?\d*|\.\d+)px$/`.

| ID | Regel (T = nicht für `tokens.css`) |
|---|---|
| R14 (T) | In `height` und `min-height` ist ein Literal nur erlaubt, wenn `n ≤ 16` (Punkte, Icons, Griffe, Meter, Trenner, Hairlines) oder `n ≥ 48` (Textareas, Flächen). 17–47 muss `var(--control-*)`, `var(--bar-*)` oder `calc(…)` sein. |
| R15 (T) | `font-size` enthält kein Literal. In `font` (Kurzform) enthält kein Token vor dem Schrägstrich bzw. das Größen-Token ein Literal (`/(^|\s)\d+\.?\d*px(\/|\s|$)/`). `inherit`, `em`, `%` sind erlaubt. |
| R16 (T) | In `padding`, `padding-*`, `gap`, `row-gap`, `column-gap`, `margin`, `margin-*` ist ein Literal nur erlaubt, wenn es `0`, `1px`, negativ oder `≥ 48px` ist. Alles von 2 bis 47 muss `var(--space-*)` oder eine Funktion sein. `auto` ist erlaubt. |
| R17 | `tokens.css` deklariert `--control-xs: 24px`, `--bar-sm: 24px`, `--bar-md: 32px`, `--bar-lg: 44px` (TSX rechnet mit 24 in `ResourceTable.tsx:9`/`ContainerTable.tsx:12` und mit 32 in `SplitTerminalArea.tsx:209,226,395`), dazu alle zehn `--space-*` mit ihrem Namenswert und `--dur-toast`. |
| R9 (neu) | Keiner der 18 Aliasnamen ist deklariert. Die Prüfung der Kurven, Farben, Ebenen und `tm-pulse` bleibt. |
| R12 (neu) | gilt für **alle** Dateien, auch `tokens.css`. |
| R7b (neu) | Bewegte Keyframes werden über alle `FILES` gesammelt (`collectMovingKeyframes(FILES)`) und als dritter Parameter an `lint(file, css, shared)` übergeben; Fixtures linten ohne `shared` lokal. Neuer Test: Keyframe in Fixture A, ungegatete `animation` in Fixture B → R7b. |
| R0 (neu) | plus `components/toast-ui.css`. |

Selbsttest-Fixture ergänzt um je einen Verstoß gegen R14 (`height: 30px`), R15 (`font-size: 10px`, `font: 12px/1.4 x`), R16 (`padding: 5px 10px`), und die Negativ-Fixture um erlaubte Fälle: `height: 6px`, `min-height: 64px`, `margin: -1px`, `padding: 0 1px`, `padding: clamp(24px, 5vw, 56px)`, `height: calc(var(--control-xs) - 2px)`, `gap: var(--space-8)`, `font: var(--fs-sm)/1.45 var(--font-mono)`.

Wellen-Gate wie in Stufe 1 (B4): R14–R16 laufen in Welle 1 und 2 nur für `GEOMETRY_MIGRATED = ['tokens.css', 'styles.css']`, mit `DESIGN_LINT_ALL=1` für alle. Jeder Welle-2-Task meldet 0 Verstöße in seinen Dateien:

```powershell
$env:DESIGN_LINT_ALL='1'; npx vitest run src/renderer/src/design-tokens.test.ts; Remove-Item Env:DESIGN_LINT_ALL
```

Welle 3 entfernt den Schalter.

## 4. S3 – Toast

### 4.1 Gate

| Kandidat | Häufigkeit | Entscheidung | Zweck | Eigenschaften, Kurve, Dauer | Reduced motion |
|---|---|---|---|---|---|
| Fehlermeldung (`.toast`) | gelegentlich, nur durch Ereignisse, nie per Taste | **animieren** | harten Wechsel vermeiden, Herkunft zeigen (von unten) | Transitions `opacity 0→1`, `transform: translateY(100%)→0`, `--ease-out`, `--dur-toast` 220 ms; Eintritt per `@starting-style`, **Exit derselbe Weg** über `.is-closing`; Origin unten | nur `opacity` |

Kein Zeitlimit, kein Escape, kein Fokus (S3-1). Werkzeug CSS-Transitions (Schritt 3: Zustandswechsel per Klasse). Eigenschaften nur `transform` und `opacity`.

### 4.2 Dateien

**`src/renderer/src/toast-state.ts`** (neu, rein):

```ts
export interface ToastState { message: string | null; closing: boolean }
export const EMPTY_TOAST: ToastState = { message: null, closing: false };
/** A new message shows at once (and cancels a running exit); null starts the exit if something is shown. */
export function nextToast(state: ToastState, message: string | null): ToastState {
  if (message) return { message, closing: false };
  return state.message ? { ...state, closing: true } : state;
}
export const exitedToast = (): ToastState => EMPTY_TOAST;
```

Test `toast-state.test.ts`: neuer Text → sichtbar; `null` bei sichtbar → `closing`; `null` bei leer → unverändert (gleiche Referenz); neuer Text während `closing` → sichtbar, nicht `closing`.

**`src/renderer/src/components/Toast.tsx`** (neu):

```tsx
import { useEffect, useState } from 'react';
import './toast-ui.css';
import { useNativeSurfaceBlock } from '../native-surface';
import { EMPTY_TOAST, exitedToast, nextToast } from '../toast-state';

const EXIT_FALLBACK_MS = 300; // transitionend may not fire in a hidden window

export function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  const [state, setState] = useState(() => nextToast(EMPTY_TOAST, message));
  useEffect(() => { setState(current => nextToast(current, message)); }, [message]);
  useNativeSurfaceBlock(state.message !== null);
  useEffect(() => {
    if (!state.closing) return;
    const timer = setTimeout(() => setState(exitedToast), EXIT_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [state.closing]);
  if (!state.message) return null;
  return (
    <div className={`toast${state.closing ? ' is-closing' : ''}`} role="alert"
      onTransitionEnd={event => { if (state.closing && event.propertyName === 'opacity') setState(exitedToast); }}>
      <span>{state.message}</span>
      <button type="button" className="toast-close" aria-label="Fehlermeldung schließen" onClick={onClose}>Schließen</button>
    </div>
  );
}
```

**`src/renderer/src/components/toast-ui.css`** (neu, Präfix `.toast`):

```css
/* Error toast: fixed above the status bar, never takes focus, closed by its button only. Gate: docs/design-system.md. */
.toast { position: fixed; right: var(--space-12); bottom: calc(var(--bar-sm) + var(--space-12)); z-index: var(--layer-toast); display: flex; align-items: center; gap: var(--space-12); width: min(520px, calc(100vw - 2 * var(--space-12))); padding: var(--space-10) var(--space-12); border: 1px solid var(--color-danger-border); border-radius: var(--radius-lg); background: var(--color-danger-bg); color: var(--color-danger-text); box-shadow: var(--shadow-overlay); transition: opacity var(--dur-toast) var(--ease-out); }
.secondary-shell .toast { bottom: var(--space-12); }
.toast > span { flex: 1; min-width: 0; line-height: 1.5; overflow-wrap: anywhere; }
.toast-close { flex: 0 0 auto; min-height: var(--control-sm); padding: 0 var(--space-10); font-size: var(--fs-sm); }
@starting-style { .toast { opacity: 0; } }
.toast.is-closing { opacity: 0; }
@media (prefers-reduced-motion: no-preference) {
  .toast { transition: opacity var(--dur-toast) var(--ease-out), transform var(--dur-toast) var(--ease-out); }
  @starting-style { .toast { transform: translateY(100%); } }
  .toast.is-closing { transform: translateY(100%); }
}
```

Im Endzustand gibt es kein `transform` (kein Containing Block). `translateY(100%)` ist relativ zur eigenen Höhe (Skill: Prozent statt Pixel). Die Datei erfüllt R7 (Block unter `prefers-reduced-motion`), R7b (Transform nur gegatet), R13 (keine Bühnenfläche).

**`App.tsx:859`** → `<Toast message={error} onClose={() => setError(null)} />` (Import ergänzen). Zeile 860 („Aktion fehlgeschlagen“) bleibt. **`SecondaryWindow.tsx:112-113`** ebenso. **`styles.css:87`** `.app-error` wird gelöscht (T8, Welle 2).

### 4.3 Verhalten gegen heute

| Heute | Neu | Warum |
|---|---|---|
| Balken im Fluss, 44 px, Bühne schrumpft, xterm fittet, RDP misst neu | Overlay unten rechts, kein Layoutwechsel | Terminalgröße bleibt stabil; `animate`: nur `transform`/`opacity` |
| erscheint hart, verschwindet hart | 220 ms ein, auf demselben Weg aus; neuer Fehler während des Ausblendens retargetet | Transitions statt Keyframes |
| `role="alert"`, „Schließen“, kein Timer, kein Escape, kein Fokus | identisch | Verhalten erhalten (S3-1) |
| RDP sichtbar, Fläche kleiner | RDP ausgeblendet, solange der Toast steht (wie Menüs) | sonst wäre der Toast unsichtbar (S3-2) |

## 5. S4 – xterm-Theme aus Tokens

**`src/renderer/src/terminal-theme.ts`** (neu):

```ts
/** xterm colours come from tokens.css; the fallbacks are the token values and are checked by terminal-theme.test.ts. */
export const XTERM_FALLBACKS = { background: '#070b14', foreground: '#dce9f8', cursor: '#67e8f9', selectionBackground: '#164e63' } as const;
const TOKENS = { background: '--color-bg-stage', foreground: '--color-text-code', cursor: '--color-accent', selectionBackground: '--color-selection-bg' } as const;
export function xtermTheme(read: (name: string) => string): typeof XTERM_FALLBACKS {
  const pick = (key: keyof typeof TOKENS): string => read(TOKENS[key]).trim() || XTERM_FALLBACKS[key];
  return { background: pick('background'), foreground: pick('foreground'), cursor: pick('cursor'), selectionBackground: pick('selectionBackground') };
}
```

`TerminalPanel.tsx:49-51`: vor `new Terminal` `const styles = getComputedStyle(document.documentElement);` und `theme: xtermTheme(name => styles.getPropertyValue(name))`. Font und `fontSize: 14` bleiben (S4-1). Kein Flackern: der Wert steht vor `term.open`; `styles.css` ist in beiden Fenstern vor dem React-Render geladen (`main.tsx:6`), und `getComputedStyle` erzwingt die Auflösung.

Test `terminal-theme.test.ts`: (1) liest `tokens.css`, parst die vier Deklarationen und erwartet Gleichheit mit `XTERM_FALLBACKS`; (2) `xtermTheme(() => '')` liefert die Fallbacks; (3) `xtermTheme(() => ' #123456 ')` trimmt. Damit ist „wer eines ändert, ändert beide“ nicht mehr Doku, sondern Test; die Doku-Ausnahme E4 wird zu „Fallback, vom Test gegen `tokens.css` geprüft“.

## 6. S5 – Aliase

`tokens.css:79-85` löschen. `design-tokens.test.ts`: `ALIASES` bleibt als Liste, R9 meldet jeden **deklarierten** Alias (`declared.has(name)` → Verstoß „alias still declared“); R12 ohne `!isTokens`. Fixture „flags a broken tokens file“ bekommt `--ui-text: var(--color-text);` und erwartet R9. Grep-Nachweis für den Prüfer: `rg "var\(--(ui-|surface|border\)|text\)|text-muted|accent\))" src/renderer` → 0 Treffer. Doku: Abschnitt „Aliase“ in `docs/design-system.md` wird „Aliase: entfernt in Stufe 2; die Namen `--ui-*`, `--surface*`, `--border`, `--text`, `--text-muted`, `--accent`, `--ui-radius`, `--ui-control-height`, `--ui-input-height` dürfen weder deklariert noch genutzt werden (R9, R12).“

## 7. S1 – Keyframes dateiübergreifend

```ts
function movingKeyframesOf(css: string): Set<string> { /* heutige Schleife über tokenize(css) */ }
const SHARED_MOVING = new Set(FILES.flatMap(file => [...movingKeyframesOf(readFileSync(`${ROOT}${file}`, 'utf8'))]));
function lint(file: string, css: string, shared: ReadonlySet<string> = new Set()): string[] {
  const movingKeyframes = new Set([...shared, ...movingKeyframesOf(css)]);
  …
}
// it(file) → lint(file, css, SHARED_MOVING)
```

Test: `lint('b.css', '.x { animation: tm-slide var(--dur-popover) var(--ease-out); } @media (prefers-reduced-motion: reduce) { .x { animation: none; } }', movingKeyframesOf('@keyframes tm-slide { from { transform: translateY(-4px); } }'))` → enthält ` R7b .x `. Ohne `shared` → leer.

## 8. Was ausdrücklich nicht getan wird

- Keine neue Farbe, kein neuer UI-Text (auch der RDP-Platzhalter bleibt), keine Klassen-Umbenennung, kein Main/Preload/Shared, keine Abhängigkeit, kein Framework.
- `ROW_HEIGHT` und die 32 in `SplitTerminalArea.tsx` bleiben Zahlen (S2-2). `ResourceTable.tsx`, `ContainerTable.tsx`, `SplitTerminalArea.tsx`, `RdpPanel.tsx`, `native-surface.ts` werden nicht angefasst.
- Kein Token für `line-height`, `width`, `max-height`, `top/left/right/bottom`, Dekorgeometrie ≤ 16 px, Flächen ≥ 48 px (S2-4). Der Terminal-Tab wird nicht 28 (3.3).
- Terminal-Font und `fontSize` bleiben; nur die vier Farben kommen aus Tokens.
- Toast: kein Auto-Dismiss, kein Escape, kein Stapeln (eine Meldung, die nächste ersetzt), keine Positionswahl.
- `.kube-stale`-Opazitätsübergang, `.connection-test`- und `.transfer-job`-Einblendung (Plan 6.2, letzte Zeile) bleiben „nicht jetzt“: nicht Teil des Auftrags, kein Gate-Eintrag.
- Keine `transition` auf Layout-Eigenschaften; `<progress>` bleibt die einzige Duldung.

## 9. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Visuelle Regression durch Faltung | Jede wertändernde Faltung steht in 3.3 mit Messwert; alles Übrige ist wertgleich. Die drei größten (View-Leiste, Panelköpfe, Chip-Leiste) sind je eine Zeile und einzeln rückholbar. Prüfer geht die Bereiche aus 12 durch. |
| `calc(var(--control-sm) - 2px)` wird von einem Umsetzer „vereinfacht“ | Die Tabelle nennt den Grund; R14 erlaubt `calc()`. |
| Lint R16 trifft Werte, die keiner vorhergesehen hat | `DESIGN_LINT_ALL=1` zeigt sie in Welle 2 mit Datei, Selektor und Wert; Zuordnung nach 3.2, Rest nach S2-4. |
| Toast hinter dem RDP-Fenster | S3-2 blockiert die Fläche; Abnahme 12.6 prüft es. |
| `transitionend` bleibt aus (Fenster im Hintergrund, `display` wechselt) | Fallback-Timer 300 ms räumt auf. |
| `@starting-style` greift beim Toast nicht, weil das Element gemountet bleibt | Der Toast wird bedingt gerendert (`null` bei leer) und nach dem Exit entfernt; ein Folgefehler während `closing` nimmt den Transition-Pfad zurück, nicht den Starting-Style. |
| `getComputedStyle` liefert leer, bevor das Stylesheet steht | Fallbacks = Tokenwerte, vom Test geprüft. |
| Alias-Nutzung in einem vergessenen Inline-Style | Grep: 0 Treffer in TS/TSX und `index.html`; R12 schützt CSS. |
| Welle-2-Gate blind für Geometrie | B4-Schalter `DESIGN_LINT_ALL`, Pflicht-Selbstprüfung je Task. |

## 10. Tests

| Task | Pflicht |
|---|---|
| T1 | Lint grün für `tokens.css`, `styles.css`; Selbsttest weist R1–R17 nach, Negativ-Fixture 0 Treffer; dateiübergreifender R7b-Test; Alias-Fixture meldet R9; `DESIGN_LINT_ALL=1` zeigt nur Treffer in nicht umgestellten Dateien. `npm run typecheck` grün. |
| T2 | `terminal-theme.test.ts` grün (Fallbacks = Tokens, leere Werte → Fallback). |
| T3–T7 | Selbstprüfung mit Schalter: 0 Verstöße in eigenen Dateien; Ledger nennt Vorher/Nachher aus 3.3. |
| T8 | `toast-state.test.ts` grün; `rg "app-error" src` → 0 Treffer; Lint für `components/toast-ui.css` mit Schalter grün. |
| T9 | Ohne Schalter alle zwölf Dateien grün; `version.test.ts` grün; `rg "--space-(2xs|xs|sm|md|lg|xl|2xl|3xl|4xl)\b" src docs` → 0 Treffer. |

Gate je Welle: `npm run typecheck`, `npx vitest run`.

## 11. Tasks in Wellen (disjunkte Dateien)

| Welle | Task | Dateien (nur diese) | Hängt ab von | Inhalt |
|---|---|---|---|---|
| 1 | **T1 Tokens, Lint, Shell** | `src/renderer/src/tokens.css`, `src/renderer/src/styles.css`, `src/renderer/src/design-tokens.test.ts` | – | 3.1 (Skala, `--dur-toast`, Aliase weg), S1 (7), S5-Lint (6), R14–R17 mit `GEOMETRY_MIGRATED`/`DESIGN_LINT_ALL`, Fixtures (3.4); `styles.css` nach 3.2 und 3.3 (**`.app-error` bleibt vorerst**) |
| 1 | **T2 xterm** | `src/renderer/src/terminal-theme.ts` (neu), `src/renderer/src/terminal-theme.test.ts` (neu), `src/renderer/src/components/TerminalPanel.tsx` | – | Abschnitt 5 |
| 2 | **T3 Terminal** | `src/renderer/src/terminal-ui.css` | T1 | 3.2, 3.3 |
| 2 | **T4 Navigation, Editor** | `src/renderer/src/components/navigation-ui.css`, `src/renderer/src/components/editor-ui.css` | T1 | 3.2, 3.3 |
| 2 | **T5 Dateien** | `src/renderer/src/files-ui.css` | T1 | 3.2, 3.3 |
| 2 | **T6 Kubernetes, Container** | `src/renderer/src/kubernetes-ui.css`, `src/renderer/src/kubernetes-dock.css`, `src/renderer/src/containers-ui.css` | T1 | 3.2, 3.3 inkl. S2-5 |
| 2 | **T7 Assistent, Workflows** | `src/renderer/src/assistant-ui.css`, `src/renderer/src/workflows-ui.css` | T1 | 3.2, 3.3 |
| 2 | **T8 Toast** | `src/renderer/src/toast-state.ts` (neu), `src/renderer/src/toast-state.test.ts` (neu), `src/renderer/src/components/Toast.tsx` (neu), `src/renderer/src/components/toast-ui.css` (neu), `src/renderer/src/App.tsx`, `src/renderer/src/SecondaryWindow.tsx`, `src/renderer/src/styles.css` (nur Zeile 87 löschen) | T1 (`--dur-toast`) | Abschnitt 4 |
| 3 | **T9 Lint auf alle, Doku** | `src/renderer/src/design-tokens.test.ts`, `docs/design-system.md`, `README.md`, `CHANGELOG.md` | T3–T8 | Schalter entfernen, R0 + `components/toast-ui.css`; Doku nach 13 |

`styles.css` wird in Welle 1 (T1) und Welle 2 (T8, eine Zeile) berührt, nie von zwei Tasks derselben Welle. Keine Main-, Preload-, Shared- oder `package.json`-Änderung.

## 12. Manuelle Abnahme (`npm run dev`)

1. **Leisten:** View-Leiste 32, Pane-Kopf 32, Dateikopf 32, Transfer-Kopf 32, Dock-Leiste 32, Editor- und Assistent-Kopf 32, App-Kopf 44, Status 24. Terminal fittet nach Umschalten der Ansicht ohne Rest.
2. **Controls:** Tabs 26 im 28-Item, View-Schließen 24, Pfad-Knöpfe 24, Dateiwerkzeuge 28, Prompt 32, Filter-Chips 24 (Leiste gleich hoch wie Art-Tabs), Reset 24, Namespace-Select und „?“ 28, Versionsknopf füllt die Statusleiste.
3. **Tabellen:** Kube-/Container-Tabelle scrollt mit 2000 Zeilen ohne Sprung, Spaltenfilter 24, Clear-Knopf innen, Gruppierzeilen 24.
4. **Schrift:** Welcome-Titel 22, Marke 14, Hilfe-Titel 14, Konflikt-Titel 18, Badges und Zähler 11, Assistent-Icons 18.
5. **Toast:** Fehler auslösen (z. B. 9. Session bei Limit 8): Toast gleitet unten rechts 220 ms herauf, Statusleiste zeigt „Aktion fehlgeschlagen“, Terminal ändert die Größe nicht; „Schließen“ lässt ihn auf demselben Weg verschwinden; ein zweiter Fehler während des Ausblendens kehrt um; Fokus bleibt im Terminal; Escape tut nichts. Zweitfenster: Toast sitzt 12 px über dem Rand.
6. **RDP:** Bei offener RDP-Sitzung erscheint mit dem Toast der Platzhalter; nach „Schließen“ kommt die Fläche pixelgenau zurück.
7. **Reduced Motion:** Toast blendet nur ein und aus, kein Gleiten.
8. **Feel-Check** im DevTools-Animations-Panel bei fünffacher Dauer: Der Toast kommt von unten und geht nach unten, Kurve `--ease-out`.
9. **xterm:** Terminalhintergrund, Text, Cursor und Auswahl sehen aus wie vorher (Haupt- und Zweitfenster, Kube-Dock-Shell). Ein testweise geänderter `--color-bg-stage` färbt das Terminal nach Neustart mit.

## 13. Doku-Änderungen

**`docs/design-system.md` (T9):**

- Roter Faden Punkt 5: „Vier Control-Höhen. 24 in Tabellen und Chip-Leisten, 28 in Leisten und Menüs, 32 Standard, 36 für Formulareingaben und Suche. Leisten sind 32 hoch (Pane, View, Datei, Dock, Transfer, Editor- und Assistent-Kopf), der App-Kopf 44, die Statusleiste 24.“
- Abschnitt „Tokens“: Satz „Geometrie bleibt in Stufe 1 literal …“ ersetzen durch „Maße stehen seit Stufe 2 nur noch als Token im CSS. Erlaubte Literale: 0, 1 px, negative Werte, Dekorgeometrie bis 16 px, Flächen ab 48 px, Werte in `calc()`/`min()`/`max()`/`clamp()`.“ Tabelle „Abstände“ auf `--space-2 … --space-32`. Tabelle „Bewegung“ + `--dur-toast` 220 ms. Neue Tabelle „Kopplungen“: `--bar-md` ↔ `SplitTerminalArea.tsx`, `--control-xs` ↔ `ROW_HEIGHT`, `--bar-lg/-sm` ↔ Seitenleiste.
- Abschnitt „Aliase“: wie in 6.
- Motion-Gate: Zeile `.app-error` ersetzen durch die Zeile aus 4.1; Ausnahmeliste unverändert (`.toast-close` darf drücken).
- „Regeln für neues CSS“: + „Höhen, Schriftgrößen und Abstände nur als Token (R14–R16).“ Farbausnahme `TerminalPanel.tsx` → „`terminal-theme.ts`: die xterm-Farben kommen aus den Tokens; die Fallbacks sind die Tokenwerte und werden vom Test geprüft.“
- „Prüfung“: R7b (dateiübergreifend), R9 (keine Aliase), R12 (alle Dateien), R14–R17 je ein Satz; R0 „zwölf Stylesheets“. Feel-Check + Toast.

**`README.md:24`** (T9), ein Satz geändert: „Farben, Maße, Radien, Ebenen, Schatten und Bewegung kommen aus einer Datei: `src/renderer/src/tokens.css`. … prüft alle CSS-Dateien auf harte Farben und Maße, eingebaute Easings, feste Dauern und z-index-Werte sowie auf Bewegung ohne `prefers-reduced-motion`.“

**`CHANGELOG.md`** (T9), neuer **letzter** Punkt unter `## [0.9.0] – 2026-10-18`, eine Zeile:

```markdown
- Fehlermeldungen erscheinen als Hinweis unten rechts und verschieben das Terminal nicht mehr; sie bleiben, bis man sie schließt. Leisten, Knöpfe, Schriftgrößen und Abstände folgen jetzt einer festen Skala, Chip-Leiste und Panelköpfe sind kompakter.
```

Kein neuer `## [x.y.z]`-Kopf (D9, `version.test.ts:9-13`).

## 14. Minimale erste Stufe gegenüber Extras

| Stufe | Inhalt | Wert | Aufwand |
|---|---|---|---|
| **Minimal (dieser Branch)** | S1, S5, S4 (T1, T2) | ★★★ | nur Renderer, drei Dateien plus zwei neue |
| **Minimal (dieser Branch)** | S2 vollständig nach 3.1–3.4 (T1, T3–T7, T9) | ★★ | nur Renderer, Layoutänderung je Datei, gemessen |
| **Minimal (dieser Branch)** | S3 Toast (T8) | ★★ | kleine Renderer-Änderung in `App.tsx`, `SecondaryWindow.tsx` |
| Extra, nicht jetzt | `.kube-stale` nur `opacity` 200 ms statt `filter` | ★ | nur Renderer, braucht Gate-Eintrag |
| Extra, nicht jetzt | `.connection-test`-, `.transfer-job`-Einblendung | ★ | nur Renderer, braucht Gate-Eintrag und Messung der Listenhöhe |
| Extra, nicht jetzt | `width` quadratischer Knöpfe per Lint an die Höhe binden | ★ | Lint-Regel, kein Nutzen ohne Breitenskala |
