# Shellherd-Designsystem

Alle Farben, Maße, Ebenen, Schatten und Bewegungswerte stehen in `src/renderer/src/tokens.css`. Jede andere Stylesheet-Datei nutzt nur `var(--…)`. Die Pipeline-Unterlagen sind `docs/superpowers/specs/2026-10-19-design-system-design.md`, die Validierung `…-validation.md` und der Plan unter `docs/superpowers/plans/`. Stufe 2: `docs/superpowers/specs/2026-10-19-design-system-stage2-design.md`, Validierung `docs/superpowers/specs/2026-10-19-design-system-stage2-validation.md`.

## Roter Faden

**Shellherd ist ein dichtes, dunkles Ops-Werkzeug. Es bewegt sich fast nichts, was leuchtet, ist Kupfer, und was gefärbt ist, ist ein Zustand.**

1. **Drei Flächenstufen, eine Linie.** Bühne `#0b1018` (Terminal, Code, Manifest), App-Grund `#0e141e` (Hintergrund, View-Leiste), Panel `#151d2a` (Leisten, Seitenleiste, Dialoge, Menüs), erhöht `#1c2635` (Controls, Zeilen-Hover), Hover `#253043`. Eine Linienfarbe `#2e3a4c`, eine stärkere `#4d5b70` für Hover-Ränder und aktive Tabs.
2. **Kupfer ist das einzige Signal.** `#e8935a` steht für Fokus, aktive Tabs, Links, Auswahl-Rand, Fortschritt und Primärbutton. Ausgewählt (dauerhaft, Zeilen) ist **ein** opakes dunkles Kupfer `#2e2620`. Aktiv in View-Tabs, Menüfokus und Badges ist **eine** Tönung `rgb(232 147 90 / 14%)`. Hover auf Buttons, Tabs und Chips ist `--color-bg-hover`. Ein einzelnes Drop-Ziel bekommt 22 %, eine ganze Ablagefläche 6 %. Mehr Stufen gibt es nicht.
3. **Ampel nur für Zustände.** Ein Grün `#4ade80`, ein Gelb `#facc15`, ein Rot `#fb7185` für Punkte und Icons. Gefahr-Text ist `#fda4af`, die Gefahr-Fläche `#341c25`, der Gefahr-Rand `#713442`. Nie dekorativ. **Kupfer ist nie ein Zustand, Gelb ist nie ein Akzent**: Kupfer bedeutet „hier bist du oder hier kannst du handeln“, Gelb bedeutet „Achtung, Zustand“. Ein Zustand steht nie auf einer Kupferfläche (Kontrast); deshalb behält der Punkt im „Gespeichert“-Label `currentColor`, und der Text trägt den Zustand. Zustandsflächen: Warnung `--color-warn-bg` `#2a2614`, Erfolg `--color-ok-bg` `#16261f`.
4. **Zwei Textstufen.** Text `#ebe7e2`, gedämpft `#aeb3bc`, dazu Code-Text `#e6e2dc`. Dunklere Grautöne gibt es nicht.
5. **Vier Control-Höhen.** 24 in Tabellen und Chip-Leisten, 28 in Leisten und Menüs, 32 Standard, 36 für Formulareingaben und Suche, 32 für die Inline-Eingaben im Datei-Prompt und im Rechte-Dialog. Die Umbenennen-Eingabe der View-Tabs und die Pfad-Eingabe im Dateibrowser sind 24 hoch. Leisten sind 32 hoch (Pane, View, Datei, Dock, Transfer, Editor- und Assistent-Kopf), der App-Kopf 44, die Statusleiste 24.
6. **Drei Radien.** 4 innen (Tabs, Zeilen, Menüeinträge, Icon-Knöpfe in Leisten), 5 Standard (Buttons, Eingaben, Popover, Menüs), 8 für Dialoge und Karten. Pillen nutzen `999px` (Chips, Badges). Ausnahme: Das Layout-Menü hat 4.
7. **Motion ist Ausnahme.** Druck (120 ms), Dialog (200 ms), Popover (160 ms), Hinweis (180 ms), Fehlerhinweis (220 ms ein, 150 ms aus), Puls (1 s), Meldungen und Fehlerkarte (180–220 ms), Getrennt-Leiste (220 ms). Die Verbindungskarte erscheint erst nach 400 ms und ohne Übergang; Cluster-Leiste und Schritt-Punkte wechseln ohne Übergang. Alles, was per Tastatur erreichbar ist, alle Listen, Tabs, Chips und die Terminalausgabe reagieren sofort. Hover-Farbwechsel haben keine Transition.

## Marke

Das Shellherd-Zeichen (`resources/mark-64.png`) ist das einzige Rasterbild der Oberfläche: 24 px im App-Kopf (`.brand-icon`), 36 px auf der Startkarte (`.brand-mark`). Keine CSS-Radien, Filter oder Schatten darauf; die runden Ecken stecken im Asset. Der Akzent `#e8935a` ist aus dem Kupfer der Wangen im Zeichen abgeleitet (Berner Kupfer); Zeichen und Oberfläche sprechen dieselbe Farbe. Das Zeichen selbst bleibt Bildinhalt. Erzeugung: `npm run icons` aus `resources/brand/shellherd-master.png` (48–256 px, Kopf- und Startzeichen) und den vereinfachten Kleinvarianten `resources/brand/shellherd-small-32.png` (24, 32 px) und `resources/brand/shellherd-small-16.png` (16 px).

## Tokens

Maße stehen seit Stufe 2 nur noch als Token im CSS. Erlaubte Literale: 0, 1 px, negative Werte, Dekorgeometrie bis 16 px, Flächen ab 48 px, Werte in `calc()`/`min()`/`max()`/`clamp()`.

### Farben (`--color-*`)

| Name | Rolle | Wert | Beispiel |
|---|---|---|---|
| `--color-bg-stage` | Terminal, Code, Manifest | `#0b1018` | `.terminal-panel` |
| `--color-bg-app` | Fensterhintergrund, View-Leiste | `#0e141e` | `body` |
| `--color-bg-panel` | Leisten, Seitenleiste, Dialoge, Menüs | `#151d2a` | `.confirm-dialog` |
| `--color-bg-raised` | Controls, Zeilen-Hover | `#1c2635` | `button` |
| `--color-bg-hover` | Button-, Tab-Hover, „an“-Chips | `#253043` | `button:hover` |
| `--color-bg-input` | Eingabefelder | `#0f1520` | `input` |
| `--color-bg-selected` | dauerhafte Auswahl, `aria-pressed` | `#2e2620` | `.root-row[aria-pressed='true']` |
| `--color-bg-active` | aktiver View-Tab, Menüfokus, Badges | `rgb(232 147 90 / 14%)` | `[role='menuitem']:hover` |
| `--color-bg-drop` | einzelnes Drop-Ziel | `rgb(232 147 90 / 22%)` | `.dock-preview` |
| `--color-bg-tint` | weiche Hervorhebung, ganze Ablagefläche | `rgb(232 147 90 / 6%)` | Release-Box |
| `--color-overlay` | neutraler Hover auf dichten Zeilen | `rgb(255 255 255 / 8%)` | Dateizeile |
| `--color-backdrop` | Hintergrund hinter Dialogen | `rgb(5 8 13 / 72%)` | `.confirm-dialog::backdrop` |
| `--color-border` | Standardlinie | `#2e3a4c` | Leistenränder |
| `--color-border-strong` | Hover-Rand, aktiver Tab | `#4d5b70` | `button:hover` |
| `--color-text` | Text | `#ebe7e2` | Fließtext |
| `--color-text-muted` | gedämpfter Text | `#aeb3bc` | Beschriftungen |
| `--color-text-code` | Code-Text | `#e6e2dc` | Manifest |
| `--color-accent` | Signalfarbe | `#e8935a` | Fokusring |
| `--color-accent-hover` | Akzent beim Hover | `#f0a673` | Links |
| `--color-on-accent` | Text auf Akzentfläche | `#2a1406` | `.primary-button` |
| `--color-selection-bg` | Textauswahl | `#3f2e22` | `::selection` |
| `--color-selection-text` | Text der Auswahl | `#fbf5ef` | `::selection` |
| `--color-ok` | Zustand gut | `#4ade80` | Status-Punkt |
| `--color-warn` | Zustand Warnung | `#facc15` | Status-Punkt |
| `--color-warn-border` | Rand einer Warnung | `#6b5a12` | Banner |
| `--color-warn-bg` | Warn-Fläche (Cluster-Leiste beim Neuverbinden) | `#2a2614` | `.kube-connbar-warn` |
| `--color-ok-bg` | Erfolgs-Fläche (Cluster-Leiste „Wieder verbunden“) | `#16261f` | `.kube-connbar-ok` |
| `--color-danger` | Gefahr (Text) | `#fda4af` | Fehlertext |
| `--color-danger-strong` | Gefahr (Punkte, Icons) | `#fb7185` | Status-Punkt |
| `--color-danger-text` | Text auf Gefahr-Fläche | `#fecdd3` | Gefahr-Button |
| `--color-danger-bg` | Gefahr-Fläche | `#341c25` | Gefahr-Button |
| `--color-danger-bg-hover` | Gefahr-Fläche beim Hover | `#512333` | Gefahr-Button |
| `--color-danger-border` | Gefahr-Rand | `#713442` | Gefahr-Button |

### Abstände (`--space-*`)

| Name | Wert |
|---|---|
| `--space-2` | `2px` |
| `--space-4` | `4px` |
| `--space-6` | `6px` |
| `--space-8` | `8px` |
| `--space-10` | `10px` |
| `--space-12` | `12px` |
| `--space-16` | `16px` |
| `--space-20` | `20px` |
| `--space-24` | `24px` |
| `--space-32` | `32px` |

### Statuspunkt und Meldungsdauer (`--size-dot`, `--notice-ttl-*`)

| Name | Rolle | Wert | Beispiel |
|---|---|---|---|
| `--size-dot` | das eine Statuspunkt-Maß | `8px` | `.toast-dot`, `.connect-error-dot`, `.kube-dot`, Terminal-Tab-Punkt |
| `--toast-text-min` | Mindestbreite des Meldungstexts, bevor die Knöpfe in eine zweite Zeile rücken | `200px` | `.toast-text` |
| `--input-number` | Breite kurzer Zahlenfelder in den Einstellungen | `calc(6ch + 2 * var(--space-8) + 2px)` | `.settings-number input` |
| `--notice-ttl-info` | Anzeigedauer einer Info-Meldung (Ablaufbalken) | `5000ms` | `.toast[data-tone='info'] .toast-bar` |
| `--notice-ttl-ok` | Anzeigedauer einer Erfolgs-Meldung | `3000ms` | `.toast[data-tone='ok'] .toast-bar` |

Die Meldungsdauern heißen bewusst nicht `--dur-*`, denn R4 begrenzt jedes `--dur-*` auf 300 ms; sie sind keine Bewegung, sondern Anzeigezeit. Fehler bleiben stehen, bis man sie schließt.

### Radien (`--radius-*`)

| Name | Rolle | Wert | Beispiel |
|---|---|---|---|
| `--radius-sm` | innen | `4px` | Tabs, Zeilen, Menüeinträge |
| `--radius-md` | Standard | `5px` | Buttons, Eingaben, Popover |
| `--radius-lg` | groß | `8px` | Dialoge, Karten |
| `--radius-pill` | Pille | `999px` | Chips, Badges |

### Schrift (`--font-*`, `--fs-*`)

| Name | Wert |
|---|---|
| `--font-ui` | `'Inter Variable', system-ui, sans-serif` |
| `--font-mono` | `ui-monospace, 'Cascadia Mono', Consolas, monospace` |
| `--fs-xs` | `11px` |
| `--fs-sm` | `12px` |
| `--fs-md` | `13px` |
| `--fs-lg` | `14px` |
| `--fs-xl` | `18px` |
| `--fs-2xl` | `22px` |

### Controls und Leisten (`--control-*`, `--bar-*`)

| Name | Wert |
|---|---|
| `--control-xs` | `24px` |
| `--control-sm` | `28px` |
| `--control-md` | `32px` |
| `--control-lg` | `36px` |
| `--bar-sm` | `24px` |
| `--bar-md` | `32px` |
| `--bar-lg` | `44px` |
| `--import-list-max` | `320px` (Höhe der Vorschauliste im Import, danach scrollt sie) |
| `--import-name-min` | `200px` (Basisbreite der Namensspalte in einer Import-Zeile, darunter bricht die Zeile um) |

### Kopplungen

Diese Werte stehen zusätzlich als Zahl im TSX. Wer einen ändert, ändert die TSX-Stelle mit; R17 schlägt sonst an.

| Token | Wert | gekoppelt an |
|---|---|---|
| `--bar-md` | `32px` | Pane-Kopf in `SplitTerminalArea.tsx` (Drop-Zonen, Panel-Rechteck `calc(… + 32px)`) |
| `--control-xs` | `24px` | `ROW_HEIGHT` in `ResourceTable.tsx` und `ContainerTable.tsx` (Fensterung) |
| `--bar-lg`, `--bar-sm` | `44px`, `24px` | schmale Seitenleiste (`top`/`bottom` in `styles.css`), Abstand des Fehlerhinweises |

### Ebenen (`--layer-*`)

Die Reihenfolge `header < popover < menu < modal < toast` ist verbindlich.

| Name | Wert | Rolle |
|---|---|---|
| `--layer-sticky` | `1` | klebende Tabellenköpfe |
| `--layer-handle` | `10` | Griffe |
| `--layer-chrome` | `25` | Pane-Chrome, Layout-Menü (+5) |
| `--layer-drag` | `45` | Drag-Vorschau, Marker (+1), schmale Seitenleiste |
| `--layer-header` | `60` | App-Kopf |
| `--layer-popover` | `70` | Workspace-Menü und andere DOM-Popover (native `popover` liegt im Top-Layer) |
| `--layer-menu` | `80` | Menüs |
| `--layer-modal` | `90` | Dialoge und Hilfe |
| `--layer-toast` | `100` | Hinweise |

Der Sperrbildschirm ist ein modaler `<dialog>` im Top-Layer und liegt über allen Ebenen, auch über `--layer-toast`. Öffnet während der Sperre ein anderer modaler Dialog, hebt der Sperrbildschirm sich sofort wieder an die Spitze des Top-Layers.

Beispiel: `z-index: var(--layer-modal)` oder `z-index: calc(var(--layer-chrome) + 5)`.

### Schatten und Fokus (`--shadow-*`, `--focus-*`)

| Name | Wert | Beispiel |
|---|---|---|
| `--shadow-overlay` | `0 10px 28px rgb(0 0 0 / 45%)` | Menüs, Popover |
| `--focus-outline` | `2px solid var(--color-accent)` | `outline: var(--focus-outline)` |
| `--focus-offset` | `2px` | `outline-offset: var(--focus-offset)` |
| `--focus-inset` | `inset 0 0 0 1px var(--color-accent)` | Listenfokus, Cursorzeile |

### Bewegung (`--ease-*`, `--dur-*`)

| Name | Rolle | Wert | Beispiel |
|---|---|---|---|
| `--ease-out` | Standard fürs Einblenden | `cubic-bezier(0.23, 1, 0.32, 1)` | Dialog, Popover |
| `--ease-in-out` | Bewegung im Bild | `cubic-bezier(0.77, 0, 0.175, 1)` | `tm-pulse` |
| `--ease-drawer` | Schubladen | `cubic-bezier(0.32, 0.72, 0, 1)` | reserviert |
| `--dur-press` | Druck-Feedback | `120ms` | `button:active` |
| `--dur-fade` | kurzes Einblenden, Fortschritt | `150ms` | `progress` |
| `--dur-popover` | Popover und Menüs | `160ms` | Picker, Layout-Menü |
| `--dur-hint` | Hinweise | `180ms` | `.file-drop-hint` |
| `--dur-modal` | Dialoge | `200ms` | `.confirm-dialog` |
| `--dur-toast` | Meldung (Eintritt; Austritt mit `--dur-fade`), Getrennt-Leiste | `220ms` | `.toast` |
| `--dur-pulse` | Puls (einzige Dauer über 300 ms) | `1000ms` | `tm-pulse` |

### Aliase

Aliase: entfernt in Stufe 2; die Namen `--ui-*`, `--surface*`, `--border`, `--text`, `--text-muted`, `--accent`, `--ui-radius`, `--ui-control-height`, `--ui-input-height` dürfen weder deklariert noch genutzt werden (R9, R12).

## Zustände

| Zustand | Regel in Stufe 1 |
|---|---|
| Hover Button (alle, auch Tabs, Chips und Picker-Option) | `--color-bg-hover` plus `--color-border-strong`, ohne Transition |
| Hover Menüeintrag `[role=menuitem]` | `--color-bg-active` |
| Hover Zeile | Baum und Kube-Tabelle `--color-bg-raised`, Dateizeile `--color-overlay` |
| Aktiv/an | View-Tab `--color-bg-active`. Kube-Art, Chip und Dock-Tab `--color-bg-hover` + `--color-border-strong` + Akzenttext. Terminal-Tab `--color-bg-stage` + `--color-border-strong` + Akzent-Unterkante |
| Ausgewählt (dauerhaft) | `--color-bg-selected`, Cursor `box-shadow: var(--focus-inset)` |
| Gedrückt (`aria-pressed`) | Icon-Wahl: Rand `--color-accent` + `--color-bg-selected`. `.assistant-toggle` bekommt zusätzlich `background: var(--color-bg-selected)`. `.root-row` hat nur `--color-bg-selected`. Der Dock-Format-Umschalter behält `--color-accent` + `--color-on-accent` |
| Drop-Ziel | einzelnes Ziel (Zeile, Tab, Pane-Vorschau, Ordner) `--color-bg-drop`, ganze Fläche (Dateiliste) `--color-bg-tint` + Akzent-Inset |
| Disabled | `.45` global, Menüeintrag und deaktivierte Baumzeile `.5` |
| Fokus | `outline: var(--focus-outline); outline-offset: var(--focus-offset)`, Listen `var(--focus-inset)`, Split-Griff und View-Drop `outline-offset: -2px`, Controls in den Köpfen von Editor und Assistent `outline-offset: calc(-1 * var(--focus-offset))` |
| Druck | `scale(.97)` über 120 ms, siehe Motion-Gate |

## Motion-Gate

Werkzeug ist immer CSS (Transition, `@starting-style` oder Keyframes), nie eine Bibliothek. Electron 44 kennt `@starting-style` und `:not()` mit Selektorliste. Jede Regel mit `transform` steht hinter `@media (prefers-reduced-motion: no-preference)` und liefert bei `reduce` nur Opazität. Hover-Transformationen gibt es nicht.

Neue Bewegung braucht einen Eintrag in dieser Tabelle. Maßstab sind Häufigkeit und Tastaturbedienung: Was oft oder per Tastatur ausgelöst wird, bewegt sich nicht.

| Kandidat | Häufigkeit | Entscheidung | Zweck | Eigenschaften, Kurve, Dauer, Origin | Reduced motion |
|---|---|---|---|---|---|
| Button `:active` (alle außer Ausnahmeliste) | zig/Tag | animieren, minimal | Feedback | `transform: scale(.97)`, `--ease-out`, `--dur-press` | kein Druck |
| Flache Druckelemente (siehe Ausnahmeliste unten) | 100+/Tag, teils Tastatur | nicht | Breite Flächen skalieren sichtbar, Listen- und Tabnavigation | eine `:not()`-Liste in `styles.css` | – |
| Übrige Dialoge: Bestätigungs-, KI-, Konflikt-, Release-Notes-Dialog (`.confirm-dialog`), Auto-Upload-Dialog (`.file-sync-dialog`) | gelegentlich | animieren | harten Wechsel vermeiden | `opacity 0→1`, `scale(.97)→1`, `--ease-out`, `--dur-modal`, `::backdrop` nur `opacity`, Origin `center`, kein Exit | nur `opacity` |
| Bestätigungen, die eine Taste auslösen kann (Kube-/Container-Aktionen `.kube-confirm`, Datei-Löschen `[data-instant]`) | Tastatur, Entf | nicht, erscheinen sofort | Tastatur-Aktionen werden nie animiert, ein Element hat ein Verhalten | die Ausnahme steht in den `:not(.kube-confirm):not([data-instant])` der Dialog-Regeln in `styles.css` | – |
| Einstellungen-Dialog (`.settings-dialog`) | gelegentlich, Klick oder `Strg+,` | per Klick animieren wie `.confirm-dialog`; per `Strg+,` und beim Zurück aus den KI-Anbietern sofort (`data-instant`) | harten Wechsel vermeiden, Tastatur bewegt nicht | keine eigene Regel: greift über `.confirm-dialog` und die Ausnahme `:not([data-instant])` in `styles.css` | nur `opacity` |
| Workflow-Palette (`.workflow-palette`) | Strg+Umschalt+Leertaste, 100+/Tag | nicht | Tastatur, Command-Palette | hat nicht die Klasse `.confirm-dialog` | – |
| Hilfe-Overlay Kube/Container (`.kube-modal`) | Taste `?` | nicht | Tastatur | liegt auf `--layer-modal`, über dem App-Kopf | – |
| Kontextmenü (`.context-menu`) | zig/Tag, Shift+F10 und Menütaste | nicht | Tastatur-erreichbar, hoher Takt | Schatten `--shadow-overlay` | – |
| Verbindungs-Picker (`.connection-picker`) | gelegentlich, nur Klick | animieren, nur Enter | Herkunft zeigen | `@starting-style` mit `opacity` und `scale(.97)`, `--ease-out`, `--dur-popover`. Der Origin ist der Auslöser: Mitte des „+“-Knopfes auf der zugewandten Kante, nach unten `top`, nach oben `bottom`. Kein Exit, kein `overlay`, kein `display`-Übergang (K3, K4). Das native RDP-Fenster würde den Fade-out abschneiden | nur `opacity` |
| Workspace-Menü (`.workspace-menu-content`) | gelegentlich, Klick | animieren | harten Wechsel vermeiden | Keyframes `workspace-menu-in` (`opacity`, `translateY(-4px)`), `--ease-out`, `--dur-popover`. Der Inhalt bleibt im `<details>` gemountet, deshalb startet ein Keyframe bei jedem `[open]` verlässlich, `@starting-style` nicht (B1). Kein Exit | Keyframe `workspace-menu-fade`, nur `opacity` |
| Layout-Menü (`.pane-layout-menu`) | gelegentlich, Button | animieren | wie oben | `@starting-style` mit `opacity` und `scale(.97)`, `--ease-out`, `--dur-popover`, Origin `top right` | nur `opacity` |
| Datei-Drop-Hinweis (`.file-drop-hint`) | selten | animieren | harten Wechsel vermeiden | `@starting-style` mit `opacity` und `translate(-50%, -8px)`, `--ease-out`, `--dur-hint` | nur `opacity` |
| Meldung ein/aus (`.toast`, alle drei Stufen) | gelegentlich, Ereignisse, nie per Taste | animieren, Herkunft von unten | `opacity`, `translateY(100%)→0`, `--ease-out`, Eintritt per `@starting-style` mit `--dur-toast` (220 ms), Austritt über `.is-closing` mit `--dur-fade` (150 ms) | nur `opacity` |
| Ablaufbalken (`.toast-bar`) | laufend bei Hinweis und Erfolg | behalten, Zustand | Keyframe `toast-bar` (`translateX(-100%)`, `linear`, Dauer `--notice-ttl-info` bzw. `--notice-ttl-ok`; `scaleX(0)` wäre R5), `.toast` schneidet per `overflow: hidden` ab. Hover und `document.hidden` pausieren über `.toast-stack.is-held` (`animation-play-state`) | Keyframe `toast-bar-width` (`width`, geduldet wie `progress`), gleiche Dauer |
| Vierte Meldung | selten | animieren | die älteste geht über `.is-closing` | nur `opacity` |
| Fehlerkarte (`.connect-error`) | gelegentlich, Ereignis | animieren, harter Wechsel | `opacity 0→1`, `scale(.97)→1`, `--ease-out`, `--dur-modal`, Origin Mitte | nur `opacity` |
| Getrennt-Leiste (`.connect-closed`) | gelegentlich, Ereignis | animieren bei Server- und Leerlauf-Trennung, sofort nach Abbrechen/Esc (`data-instant`) | `opacity`, `translateY(100%)→0`, `--ease-out`, `--dur-toast` | nur `opacity` |
| Verbindungskarte (`.connect-card`) | Enter | Warteanzeige, **nicht animiert**: erscheint nach 400 ms (`WAIT_MS`, im TSX) | – | – |
| Schritt-Punkte (`.connect-ring`) | 4× je Verbindung | nicht | Farbe springt; ein Farbübergang wurde abgelehnt | – |
| Cluster-Leiste (`.kube-connbar`) | Ereignis | nicht | Platz reserviert (`min-height: var(--control-sm)`), kein Farbübergang | – |
| „Gespeichert“-Label (`.busy-button`) | gelegentlich | animieren, Zustand | `.busy-face.is-fresh`: `opacity .4→1`, `--dur-fade`, `--ease-out`, nur nach dem ersten Zustandswechsel; Punkt `tm-pulse` während busy | Einblenden bleibt, der Puls steht |
| Statustext unten | häufig | nicht | Textwechsel, keine Bewegung | – | – |
| Sperrbildschirm (`.lock-screen`) | Timer oder Klick, Entsperren per Enter | nicht | Sicherheitsfläche erscheint sofort, Tastatur schließt sie | – | – |
| Willkommens-Tab (`.welcome-panel`) | Tab | nicht | wie Tabs | – | – |
| Tabs: Wechsel, Hinzufügen, Schließen | 100+/Tag, Tastatur | nicht | Tastatur, Layout-Eigenschaften | – | – |
| Tab-Drag: `.dock-preview`, `.tab-drop-marker`, `.is-dragging-tab` | Geste | nicht | folgt dem Zeiger | – | – |
| Dock auf/zu (`.kube-dock`) | Strg+J | nicht | Tastatur, Höhe ist Layout, xterm fittet neu | – | – |
| Seitenleiste auf/zu | mehrmals/Tag | nicht | Breite ist Layout, jedes Zwischenbild löst xterm-Resize aus | – | – |
| Baum auf/zu, Zeilenaktionen bei Hover | zig/Tag, Tastatur | nicht | Listennavigation | – | – |
| Zeilenauswahl, Cursor (Baum, Datei, Kube) | 100+/Tag | nicht | Tastatur | – | – |
| Chips, Filter, Gruppieren | zig/Tag, Tasten `w`, `F` | nicht | Tastatur | – | – |
| Hover-Farbwechsel (alle) | zig/Tag | nicht | sofortiger Wechsel passt zu einem Terminal-Werkzeug | keine `transition` auf `background` oder `color` | – |
| „Beschäftigt“-Punkt, Tipp-Indikator | laufend | behalten, vereinheitlicht | Zustandsanzeige | `tm-pulse`, `--dur-pulse`, `--ease-in-out`, `infinite` | `animation: none` |
| Fortschrittsbalken (`progress`) | laufend | behalten | konstante Bewegung | `width`, `linear`, `--dur-fade`, geduldete Layout-Eigenschaft | `transition: none` |
| `.ctr-busy` | gelegentlich | nicht | Zustand, kein Übergang nötig; die Status-Zelle nennt den Zielzustand („stoppt“) statt Blässe | – | – |
| Tooltips | – | nicht | nur natives `title=` | – | – |
| Welcome-Liste, Release-Box | bei jedem leeren Workspace | nicht | kein Delight-Budget | – | – |
| Spinner, Skelette | – | nicht einführen | Warteanzeigen sind Text und Punkt nach 400 ms | – | – |
| Terminalausgabe, xterm-Cursor | – | nie | Terminal | xterm-Theme unangetastet | – |

### Ausnahmeliste für das Druck-Feedback

Das Druck-Feedback steht als eine einzige Regel am Ende von `styles.css`. Sie nimmt diese flachen Elemente per `:not()` aus: `:disabled`, `[role='tab']` (Terminal-Tab, View-Tab, Kube-Art, Dock-Tab), `[role='menuitem']`, `.tree-toggle`, `.tree-node-button`, `.root-row`, `.welcome-list button`, `.kube-crumb`, `.kube-link`, `.kube-filter-chip`, `.kube-node`, `.kube-dock-format button`, `.link-button`, `.version-button`, `.update-button`, `.connection-picker-option`, `.workspace-definition-actions button`, `.workspace-current-actions button`, `.pane-layout-menu button`, `.file-row-head button` und `.file-path nav button`. Es gibt keine Override-Regel und damit keinen Spezifitätswettlauf, denn `styles.css` steht im Bundle zuletzt. Neue flache Druckelemente kommen in diese Liste.

## Meldungen

Drei Muster, je nach Ort der Ursache.

| Muster | Wann | Bausteine |
|---|---|---|
| **Feld** | Eine Eingabe ist falsch | `.field-error` unter dem Feld, `aria-invalid` am Feld, Fokus zum Feld. Text im Du-Imperativ ohne „Bitte“ („Gib einen Namen ein.“) |
| **Bereich** | Ein Bereich (Seitenleiste, Menü, Terminal) kann etwas nicht | `.area-error` mit Gefahr-Fläche, Satz und Knopf; im Terminal die Fehlerkarte `.connect-error` mit Ursache, nächstem Schritt, Primär- und Sekundärknopf und aufklappbaren Details. `.tree-error` bleibt nur als Zeilenhinweis in den Container-Kindern |
| **Global** | Ein Hintergrundereignis ohne Ort | Meldung (`.toast`) unten rechts in drei Stufen: Fehler (bleibt, bis man sie schließt), Info (`--notice-ttl-info`), Erfolg (`--notice-ttl-ok`). Höchstens drei sichtbar, Titel plus Ursache, optional ein Knopf |

Jede Meldung beantwortet Was, Warum und Was jetzt. Der Verbindungszustand liegt im Bereich: Verbindungskarte mit Schritten (`.connect-card`, nach 400 ms), Fehlerkarte (`.connect-error`) und Getrennt-Leiste (`.connect-closed`) mit „Neu verbinden“. Der Cluster zeigt das Neuverbinden in der Leiste `.kube-connbar` statt durch Ausgrauen.

Die Leiste „Weiterleitungen“ (`.forward-bar`) steht unter der Ausgabe einer verbundenen SSH-Sitzung, mindestens `var(--control-sm)` hoch, ohne Bewegung.

Die Suchleiste (`.terminal-search`) sitzt oben im Terminal-Panel und hat keine Bewegung. Der Link-Hinweis (`.terminal-link-hint`) erscheint unten rechts im Terminal, solange die Maus über einem Link steht, ohne Bewegung. Der Aktivitäts-Ring (`.tab-activity`) steht nach dem Namen eines nicht sichtbaren Tabs mit neuer Ausgabe, neutral in `--color-text` und mit fettem Namen, ohne Animation. „An alle“ (`.broadcast-chip`) und die Warn-Linie (`.pane-chrome.is-broadcast`) zeigen, dass die Eingabe an mehrere Bereiche geht. Gelb ist hier Zustand, nie Kupfer.

## Regeln für neues CSS

- Jede Fläche hat ihre Datei mit eigenem Präfix (`.kube-`, `.ctr-`, `.file-`, `.assistant-`, `.workflow-`, `.tree-`/`.vault-`, `.pane-`/`.view-`).
- Es gilt nur `var(--…)` aus `tokens.css`. Keine Hex-, `rgb()`-, `hsl()`-Literale, kein `var(--x, #fallback)`, keine literalen `ms`, kein `cubic-bezier`, keine `z-index`-Zahlen und keine eigenen Custom Properties.
- Höhen, Schriftgrößen und Abstände nur als Token (R14–R16).
- Die Aliase sind entfernt; ihre Namen sind weder als Deklaration noch als `var()` erlaubt (R9, R12).
- Neue Motion braucht einen Eintrag in der Gate-Tabelle und `prefers-reduced-motion` in derselben Datei. Bewegung mit `transform` steht hinter `@media (prefers-reduced-motion: no-preference)`, `:hover`-Bewegung hinter `@media (hover: hover)`.
- Kein `transition: all`, keine Keyword-Easings außer `linear`.
- Inline-`style` gibt es nur für berechnete Geometrie (Einrückung, Breite, Position), nie für Farbe.
- Die Bühnenflächen `.terminal-panel`, `.terminal-container`, `.split-terminal-stage`, `.rdp-surface` und `.kube-dock-terminal` bekommen weder `transform` noch `transition`, `animation`, `filter` oder `will-change`.
- Warteanzeigen erscheinen erst nach 400 ms; was schneller fertig ist, flackert nicht.
- Kupfer ist nie ein Zustand, Gelb ist nie ein Akzent.
- Ein Statuspunkt-Maß: `--size-dot`. Punkte sind Kreise aus `currentColor` oder einer Zustandsfarbe, nie ein Textglyph „●“.
- Chevrons sind SVG (`<path d="m5 9 7 7 7-7"/>`, 12 px, `aria-hidden`); die Richtung kippt die Klasse `.chevron.is-up` (`rotate(180deg)`) ohne Transition. Sortier- und Gruppen-Glyphen in Tabellen bleiben Text.
- Erlaubte Farbausnahmen außerhalb von CSS:
  - `ConnectionIcon.tsx:17`: die vom Nutzer gewählte Verbindungsfarbe (Daten).
  - `ConnectionForm.tsx:136`: der Startwert `#aeb3bc` für `input[type=color]`, der Hex braucht und `--color-text-muted` entspricht.
  - `terminal-theme.ts`: die xterm-Farben kommen aus den Tokens; die Fallbacks sind die Tokenwerte und werden vom Test geprüft.
- Benannte Farben (`red`, `white` und so weiter) prüft der Lint nicht, sie sind trotzdem verboten.

## Prüfung

Der Test `src/renderer/src/design-tokens.test.ts` liest alle CSS-Dateien unter `src/renderer/src` und meldet Verstöße als `<Datei> <Regel> <Selektor> { <Eigenschaft>: <Wert> }`.

- **R0:** Der Test findet mindestens die zwölf bekannten Stylesheets.
- **R1:** Außerhalb von `tokens.css` steht in keinem Wert ein Hex- oder Farbfunktionsliteral und kein `var(--x, Fallback)`.
- **R2:** `transition` und `transition-property` enthalten kein `all`.
- **R3:** Bewegungswerte nutzen keine Keyword-Easings, und außerhalb von `tokens.css` steht weder `cubic-bezier(` noch `steps(`.
- **R4:** Außerhalb von `tokens.css` steht in Bewegungswerten keine literale Dauer, und in `tokens.css` ist jedes `--dur-*` höchstens 300 ms, außer `--dur-pulse`.
- **R5:** Kein Wert enthält `scale(0)`.
- **R6:** `z-index` ist nur `auto`, `var(--layer-*)` oder `calc(var(--layer-*) ± n)`, ein `!important` wird vorher abgetrennt.
- **R7:** Eine Datei mit Bewegung enthält einen Block unter einer `prefers-reduced-motion`-At-Rule (Kommentare zählen nicht).
- **R7b:** `transform`-Bewegung in `@starting-style`, bei `:active` oder in einem Transition-Wert liegt hinter `prefers-reduced-motion: no-preference`. Das gilt auch für `animation`/`animation-name` mit einem Keyframe, dessen Schritte `transform`, `translate`, `scale` oder `rotate` setzen. Bewegte Keyframes werden über alle Dateien gesammelt.
- **R8:** `:hover`-Regeln mit Bewegung liegen in `@media (hover: hover)`.
- **R9:** `tokens.css` deklariert die drei Kurven wörtlich, alle `--color-*`-Namen und `@keyframes tm-pulse`, keinen Alias, und die Ebenen sind nach `header < popover < menu < modal < toast` geordnet.
- **R10:** `styles.css` beginnt mit `@import './tokens.css';`, und keine andere Datei enthält `@import`.
- **R11:** Außerhalb von `tokens.css` deklariert keine Regel eine Custom Property.
- **R12:** Kein Wert nutzt einen Alias, auch nicht in `tokens.css`.
- **R13:** Bühnenflächen deklarieren kein `transform`, `translate`, `scale`, `rotate`, `transition*`, `animation*`, `filter` und `will-change`.
- **R14:** `height` und `min-height` enthalten kein Literal zwischen 17 und 47 px.
- **R15:** `font-size` und die Größe in `font` sind nie ein px-Literal.
- **R16:** `padding*`, `margin*` und `gap` enthalten als Literal nur 0, 1 px, negative Werte oder ab 48 px.
- **R17:** `tokens.css` hält `--control-xs`, `--bar-sm`, `--bar-md`, `--bar-lg`, die zehn `--space-*` und `--dur-toast` auf ihren Werten und deklariert keine weiteren `--space-*`. Für `.app-status`, `.app-header` und `.view-bar` muss der Basisteil von `flex` bzw. `flex-basis` ein `var(--bar-*)` sein.
- **R18:** Jeder `var(--name)` in einer Datei, die kein Token-File ist, muss in `tokens.css` deklariert sein. Ausnahmen sind in derselben Datei deklarierte Variablen und die Erlaubnisliste `INLINE_VARS` im Test für Variablen, die TSX per Inline-Style setzt (heute leer).

Der Selbsttest `flags every rule` lintet eine Fixture mit je einem Verstoß, eine Negativ-Fixture muss 0 Treffer liefern.

**Feel-Check** vor dem Merge, im DevTools-Animations-Panel bei fünffacher Dauer: Der Dialog skaliert aus der Mitte, der Picker wächst aus dem „+“-Knopf, das Layout-Menü wächst von oben rechts, das Workspace-Menü gleitet bei jedem Öffnen 4 px herab und der Drop-Hinweis kommt von oben. `.icon-button` (32 px) und `.primary-button` geben sichtbar, aber nicht wackelig nach. Mit emuliertem `prefers-reduced-motion: reduce` blenden alle nur ein, Buttons drücken nicht, und der Puls steht. Der Fehlerhinweis kommt von unten und geht auf demselben Weg schneller zurück.
