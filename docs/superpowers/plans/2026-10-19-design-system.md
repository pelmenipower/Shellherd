# Designsystem und Motion für Terminus – Recherche

Stand: 2026-10-19 · Branch `claude/feature/design-system` · Version bleibt 0.9.0

> „überprüfe welche design wir anapssen können um einen konkreten roten faden zu haben nutzen auch /animate um die notwendigen elemten zu animieren. darauf aufgebaut erstelle ein designsystem was wir als grundlage verwenden wollen.“

Maßstab (bindend): `emil-design-eng/SKILL.md` und `animate/SKILL.md`. Bindend bleiben außerdem alle früheren Specs unter `docs/superpowers/specs/`, insbesondere die Sicherheitsregeln der Container- und Kubernetes-Specs. Diese Recherche ändert keine Funktion, keinen UI-Text und keine Main-Datei. Sie hebt genau eine frühere Festlegung auf: „Farben und Maße kommen aus den bestehenden Tokens in `styles.css`“ (`2026-10-16-kubernetes-integration-design.md:290`) wird zu „aus `tokens.css`“; `styles.css` behält nur Basis- und Shell-Regeln.

## 0. Empfehlung in einem Absatz

Terminus hat bereits einen roten Faden, er ist nur verwaschen: dunkles Blaugrau in drei Flächenstufen, eine Linienfarbe, Cyan als einziges Signal, Ampelfarben für Zustände. Was fehlt, ist die Disziplin. Heute gibt es zwei Token-Familien (`--ui-*` und `--surface/--border/--text/--accent`), rund 40 harte Farbwerte, davon fünf verschiedene „ausgewählt“-Blautöne, zwei Grün- und drei Gelbtöne, acht Control-Höhen, sechs Radien und tote Tailwind-Fallbacks in `var()`. Die Empfehlung: **eine Datei `src/renderer/src/tokens.css`** mit Farb-Rollen, Abstands-, Radius-, Schrift- und Control-Skala, Ebenen, Fokus-Ring und Motion-Tokens; die alten Namen bleiben eine Release lang als Aliase. Die zehn CSS-Dateien werden mechanisch auf die neuen Namen umgestellt, Varianten werden auf je einen Wert gefaltet. Motion kommt nur dorthin, wo das Gate es erlaubt: **Druck-Feedback auf Buttons (120 ms), Einblenden von Dialogen (200 ms), Popovern (160 ms) und dem Datei-Drop-Hinweis (180 ms), ein gemeinsames Puls-Keyframe für „beschäftigt“.** Alles Tastatur-Getriebene bleibt sofortig: Tabs, Kontextmenü, Workflow-Palette, Hilfe-Overlay, Dock, Seitenleiste, Baum, Chips, Zeilenauswahl. Ein vitest-Test parst die CSS-Dateien und verbietet harte Farben, `transition: all`, eingebaute Easings, literale Dauern, literale z-index und fehlendes `prefers-reduced-motion`. Aufwand: ausschließlich Renderer-CSS plus eine Zeile in `ConnectionPicker.tsx`; keine Main-Änderung.

## 1. Bestand mit Belegen

### 1.1 Token-Familien

| Was | Wo |
|---|---|
| Familie A `--ui-bg/-panel/-raised/-border/-text/-muted/-accent/-danger`, `--ui-radius: 5px`, `--ui-control-height: 32px`, `--ui-input-height: 36px` | `src/renderer/src/styles.css:3-4,7` |
| Familie B als Alias auf A: `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`, `--accent`; dazu `--surface-hover: #233045` **nur** in Familie B | `styles.css:5-6` |
| Familie B wird fast nur in `terminal-ui.css` genutzt, Familie A überall sonst; `navigation-ui.css:53` mischt (`--text-muted`) | `terminal-ui.css:5-25`, `files-ui.css:13,20`, `assistant-ui.css:7` |
| Tote Fallbacks mit **anderen** Werten als die Tokens: `var(--border, #293343)` (Token ist `#29374b`), `var(--text-muted, #aebdd0)` (Token `#a7b7cb`), `var(--ui-border, #334155)`, `var(--ui-muted, #b8c7da)`, `var(--ui-text, #e2e8f0)`, `var(--ui-accent, #22d3ee)`, `var(--ui-panel, #111827)` | `terminal-ui.css:5,11,35,37`, `editor-ui.css:21-24,31,35,46` |

### 1.2 Harte Farben außerhalb der Tokens

| Rolle | Werte im Bestand | Wo |
|---|---|---|
| Bühne (Terminal, Code) | `#070b14` 8-mal, `#05080e` (Manifest), `#0b1120` (View-Leiste), `#0b111c` (Eingabe) | `styles.css:20,83`, `terminal-ui.css:3,9,28,66,71`, `assistant-ui.css:19`, `workflows-ui.css:25`, `kubernetes-ui.css:104`; xterm-Theme `components/TerminalPanel.tsx:51` |
| Hover-Fläche | `#233045` (= `--surface-hover`, aber ohne `--ui-`-Namen) | `styles.css:17`, `kubernetes-ui.css:61,65,91,95` |
| Hover-Rand | `#496078` ohne Token | `styles.css:17`, `terminal-ui.css:9`, `kubernetes-ui.css:61,65` |
| Ausgewählt (opak) | `#182b3c`, `#183245`, `#1d3a4a` – drei Werte für dieselbe Bedeutung | `styles.css:78`, `navigation-ui.css:6`, `editor-ui.css:14`, `kubernetes-ui.css:84` |
| Ausgewählt/aktiv (Cyan-Tönung) | `rgb(103 232 249 / 6 %, 14 %, 16 %, 18 %, 20 %, 22 %, 26 %, 35 %, 40 %, 45 %, 55 %)` – elf Stufen | `styles.css:73,126`, `terminal-ui.css:75,76`, `navigation-ui.css:44,54,57`, `files-ui.css:38,43,44,45`, `assistant-ui.css:16,29`, `workflows-ui.css:11,18` |
| Weiß-Tönung | `rgb(255 255 255 / 4 %, 5 %, 8 %)` | `files-ui.css:42,70`, `terminal-ui.css:74,78`, `workflows-ui.css:19` |
| Gefahr | Text `#fda4af`/`#fecdd3`/`#fb7185`, Flächen `#341c25`/`#351c26`/`#3b1d24`/`#22121a`/`#512333`/`rgb(251 113 133 / 10 %)`, Ränder `#713442`/`#5b2a33`/`rgb(251 113 133 / 30 %)` | `styles.css:39,40,45,92`, `terminal-ui.css:18`, `kubernetes-ui.css:20,41,52`, `files-ui.css:30` |
| Warnung | `#fbbf24`, `#facc15`, `#fcd34d`, Rand `#6b5520` – drei Gelb | `terminal-ui.css:17`, `navigation-ui.css:64`, `kubernetes-ui.css:9,12,40` |
| Erfolg | `#4ade80` (7-mal), `#86efac` (Kube) – zwei Grün | `terminal-ui.css:16`, `navigation-ui.css:63`, `editor-ui.css:49,54`, `files-ui.css:82,99`, `assistant-ui.css:54`, `kubernetes-ui.css:8,44` |
| Neutral-Punkt, Scrollbar, Platzhalter | `#9eabbc`, `#36465c`, `#3a4b61`, `#8ea3bd` | `terminal-ui.css:15,21,54,67`, `styles.css:28` |
| Akzent-Varianten | hell `#a5f3fc`, Text auf Akzent `#072733` und `#04121a`, Selektion `#164e63`/`#ecfeff`, `rgb(22 78 99 / 55 %)` | `styles.css:25,36,37`, `kubernetes-ui.css:55`, `kubernetes-dock.css:8`, `terminal-ui.css:51` |
| Code-Text | `#dce9f8` (3-mal), `#cbd5e1` (Manifest) | `assistant-ui.css:21`, `workflows-ui.css:14,25`, `kubernetes-ui.css:104` |
| Backdrop | `rgb(2 6 15 / 72 %)` zweimal, `55 %` bei der Palette | `styles.css:47`, `kubernetes-ui.css:108`, `workflows-ui.css:5` |

### 1.3 Maße

**Control-Höhen (acht Werte):** 20 (`styles.css:137`), 22 (`terminal-ui.css:77,79`, `files-ui.css:19,32`, `kubernetes-ui.css:70,135,140`), 24 (`terminal-ui.css:20,72`, `files-ui.css:22,49,63,68`, `kubernetes-ui.css:31,60,94,98,134`, `kubernetes-dock.css:2,5`, `assistant-ui.css:24`), 26 (`terminal-ui.css:11`, `navigation-ui.css:9`, `files-ui.css:12,84`, `kubernetes-ui.css:23,28`, `assistant-ui.css:30`, `workflows-ui.css:29`), 28 (`terminal-ui.css:8,19,24`, `navigation-ui.css:43`, `assistant-ui.css:5,6,35,47`), 30 (`files-ui.css:26,27,107`), 32 (`styles.css:7,41`, `navigation-ui.css:4,27`, `editor-ui.css:13,32,40`, `files-ui.css:95`), 36 (`styles.css:7`, `editor-ui.css:6,28`, `workflows-ui.css:8`).

**Leistenhöhen (sieben Werte):** App-Kopf 44 (`styles.css:64`), Panelkopf 40 (`styles.css:88`, `assistant-ui.css:3`), Dateikopf 34 (`files-ui.css:8`), Pane-Kopf 32 (`terminal-ui.css:5`), View-Leiste 30 (`terminal-ui.css:71`), Dock-Leiste 30 (`kubernetes-ui.css:92`), Transfer-Kopf 30 (`files-ui.css:66`), Statusleiste 24 (`styles.css:89`).

**Radien (sechs Werte):** 2 (`files-ui.css:78`), 3 (`terminal-ui.css:20`, `files-ui.css:19`, `editor-ui.css:24`, `kubernetes-ui.css:47,122`), 4 (Tabs, Zeilen, Menüeinträge: `terminal-ui.css:8,24,35,72`, `navigation-ui.css:4,43`, `files-ui.css:12`, `assistant-ui.css:6`, `kubernetes-dock.css:6-7`), 5 (`--ui-radius`, `editor-ui.css:5`, `kubernetes-ui.css:39`, `assistant-ui.css:19,44`, `workflows-ui.css:10`), 6 (`terminal-ui.css:55`, `navigation-ui.css:32`), 8 (Dialoge, Karten, Pillen: `styles.css:50,130`, `editor-ui.css:36`, `files-ui.css:87`, `assistant-ui.css:16,39`, `workflows-ui.css:3,17,30`, `terminal-ui.css:74`), 9 (`kubernetes-ui.css:19`).

**Schriftgrößen (elf Werte):** 10 (`terminal-ui.css:74`, `navigation-ui.css:53`, `kubernetes-ui.css:43,73,96`), 11, 12, 13 (Basis `styles.css:8`), 14, 15 (`styles.css:51`, `kubernetes-ui.css:111`), 17 (`files-ui.css:88`), 18, 20 (`styles.css:85`), 22 (`styles.css:110`), 24 (`styles.css:30`). Zwei Mono-Stacks: mit Cascadia (`files-ui.css:22`, `assistant-ui.css:21`, `workflows-ui.css:13`) und ohne (`kubernetes-ui.css:76,104,120`).

**Abstände:** 1 bis 32 px, darunter die Ausreißer 3 (`terminal-ui.css:7`), 5 (`styles.css:16`, `editor-ui.css:4`, `navigation-ui.css:42`), 7 (`styles.css:20`, `kubernetes-ui.css:19,39`), 9 (`styles.css:20`), 14 (`kubernetes-ui.css:109`, `workflows-ui.css:6`).

### 1.4 Ebenen, Schatten, Fokus, Zustände

| Was | Befund | Wo |
|---|---|---|
| z-index | 1, 2, 3, 10, 15, 25, 30, 45, 46, 50, 60, 70, 80, 1000 – ohne Skala | `styles.css:64,72,88,102,141`, `terminal-ui.css:35,36,40,50,51`, `navigation-ui.css:32,42`, `kubernetes-ui.css:78,108`, `editor-ui.css:31` |
| **Fehler:** Kube-Modal-Backdrop (z 50) liegt **unter** dem App-Kopf (z 60); Kopfzeile bleibt beim Hilfe-Overlay hell und klickbar | `kubernetes-ui.css:108` vs. `styles.css:64` |
| Schatten nur auf Kontextmenü (`0 10px 28px / 45 %`) und Drop-Hinweis (`0 8px 24px / 35 %`); Verbindungs-Picker, Workspace-Menü und Layout-Menü schweben ohne Schatten | `navigation-ui.css:42`, `styles.css:141`, `terminal-ui.css:35,55`, `navigation-ui.css:32` |
| Fokus: global `outline: 2px solid accent; offset 2px`; Editor-Summary offset 3 px; Menüeintrag ersetzt Outline durch Hintergrund; Dateiliste Inset-Schatten 1 px; Split-Griff offset −2 px | `styles.css:19`, `editor-ui.css:24`, `navigation-ui.css:44`, `files-ui.css:37`, `terminal-ui.css:40` |
| Hover: Button `#233045`+`#496078`; Zeilen `--ui-raised`; Dateizeile Weiß 4 %; Menüeintrag Cyan 14 %; vier Muster | `styles.css:17`, `navigation-ui.css:5`, `kubernetes-ui.css:83`, `files-ui.css:42`, `navigation-ui.css:44` |
| `:active`: nirgends. Kein Druck-Feedback | alle Dateien |
| Disabled: `.45` global, `.5`, `.6` je nach Datei | `styles.css:18`, `kubernetes-dock.css:3`, `navigation-ui.css:45,52`, `containers-ui.css:8`, `workflows-ui.css:12` |
| `aria-pressed`: vier Darstellungen (opak `#182b3c`, Akzentrand+`#183245`, Akzentrand+Akzenttext, Akzentfläche+`#04121a`) | `styles.css:78`, `editor-ui.css:14`, `assistant-ui.css:36`, `kubernetes-dock.css:8` |

### 1.5 Vorhandene Motion

| Vorher | Nachher | Warum |
|---|---|---|
| `animation: container-pulse 1s ease-in-out infinite` + eigenes Keyframe (`navigation-ui.css:65-67`) | `animation: tm-pulse var(--dur-pulse) var(--ease-in-out) infinite`, Keyframe einmal in `tokens.css` | Zwei identische Pulse (`assistant-ui.css:25-27`: 1,2 s) werden eins; starke Kurve statt eingebauter |
| `transition: width 0.2s ease-out` auf `progress::-webkit-progress-value` (`files-ui.css:80`) | `transition: width var(--dur-fade) linear` | Konstante Fortschrittsbewegung → `linear`; `width` bleibt geduldet, weil `<progress>` keine Transform-Alternative bietet; reduced-motion existiert schon (`:85`) |
| `.tree-toggle.is-expanded svg { transform: rotate(90deg) }` ohne Transition (`navigation-ui.css:11`) | unverändert, ausdrücklich **keine** Transition | Baum auf-/zuklappen ist Tastatur- und Listennavigation (zig-mal täglich) → sofort |
| `.tree-row-actions { opacity: 0 }` → `1` bei Hover ohne Transition (`navigation-ui.css:18-19`) | unverändert | Hover-Effekt, zig-mal täglich → nichts |
| Kein `:active` auf `button` (`styles.css:16-18`) | `transition: transform var(--dur-press) var(--ease-out)`; `:active:not(:disabled) { transform: scale(.97) }` | Feedback; die eine Animation, die Emil auf jedem Druckelement verlangt |
| Dialoge erscheinen hart (`styles.css:46-47`, `editor-ui.css:36`) | `@starting-style` Opazität + `scale(.97)` 200 ms `--ease-out`, Backdrop-Fade, Origin zentriert | Gelegentlich, „harten Wechsel vermeiden“ |
| Popover ohne Origin und Fade (`terminal-ui.css:55`, `navigation-ui.css:32`, `terminal-ui.css:35`) | 160 ms `--ease-out`, `opacity` + `scale(.97)`, `transform-origin` am Auslöser | Dropdown-Rezept; Popover-API hält das Element im DOM → auch Exit möglich |
| Backdrop 55 % bei Palette (`workflows-ui.css:5`) vs. 72 % sonst | `var(--color-backdrop)` überall | Eine Dunkelstufe |

Reduced-motion existiert heute an drei Stellen (`navigation-ui.css:67`, `assistant-ui.css:27`, `files-ui.css:85`). `@media (hover: hover) and (pointer: fine)` kommt nirgends vor. `transition: all`, `scale(0)` und `ease-in` kommen nicht vor.

### 1.6 Wo was wie geöffnet wird (für das Motion-Gate)

| Element | Auslöser | Technik | Wo |
|---|---|---|---|
| Bestätigungs-, KI-, Konflikt-, Release-Notes-Dialog | Button oder Ereignis | `<dialog>.showModal()`, bedingt gerendert (kein Exit möglich) | `ConfirmDialog.tsx:26`, `AiSettingsDialog.tsx:33`, `FilesPanel.tsx:297`, `ConfirmAction.tsx:44`, `ContainerConfirm.tsx:23` |
| Workflow-Palette | **Strg+Umschalt+Leertaste** oder Button | `<dialog>.showModal()` | `WorkflowPalette.tsx:30`, `App.tsx:765` |
| Hilfe-Overlay Cluster/Container | **Taste `?`** oder Button | `div.kube-modal-backdrop` | `HelpOverlay.tsx:53-54`, `kube-commands.ts:72`, `ClusterView.tsx:329` |
| Detail-Dock ein/aus | **Strg+J** oder Button; Höhe als Inline-Style, Body `hidden` | `DetailDock.tsx:130,154,158`, `kube-commands.ts:85` |
| Seitenleiste ein/aus | Button; `hidden` + Inline-`width`; xterm fittet neu | `ResizableSidebar.tsx:8`, `App.tsx:756-757` |
| Kontextmenü | Rechtsklick **oder Shift+F10 / Menütaste**; `position: fixed`, per JS geklemmt | `ContextMenu.tsx:24-27,43`, `kube-menu-trigger.ts` |
| Verbindungs-Picker | Button; Popover-API, Richtung `downward` bekannt | `ConnectionPicker.tsx:37-48` |
| Workspace-Menü | Klick auf `<summary>` | `<details>` | `navigation-ui.css:27,32` |
| Layout-Menü | Button in Pane-Kopf; bedingt gerendert | `terminal-ui.css:35` |
| Tabs (Terminal, View, Kube-Arten, Dock) | Maus und Tastatur, dauernd | `TerminalTabs.tsx:29-57`, `terminal-ui.css:71-79`, `kubernetes-ui.css:59-61,93-95` |
| Fehlermeldung unten, Drop-Hinweis | Ereignis; im Fluss bzw. `position: fixed` | `App.tsx:859`, `:250`, `styles.css:92,141` |
| Tooltips | nur natives `title=` | überall; nicht animierbar |
| xterm-Theme | Literale im Konstruktor | `TerminalPanel.tsx:51` |
| RDP-Fläche | natives Fenster über dem DOM, wird bei Overlays ausgeblendet | `native-surface.ts:1-20`, `RdpPanel.tsx:122-126` |

## 2. Der rote Faden

**Terminus ist ein dichtes, dunkles Ops-Werkzeug. Es bewegt sich fast nichts; was leuchtet, ist Cyan; was gefärbt ist, ist ein Zustand.**

1. **Drei Flächenstufen, eine Linie.** Bühne `#070b14` (Terminal, Code, Manifest), App-Grund `#090e17` (Hintergrund, View-Leiste), Panel `#111925` (Leisten, Seitenleiste, Dialoge, Menüs), erhöht `#182334` (Controls, Zeilen-Hover), Hover `#233045`. Eine Linienfarbe `#29374b`, eine stärkere `#496078` für Hover-Ränder und aktive Tabs.
2. **Cyan ist das einzige Signal.** `#67e8f9` für Fokus, aktive Tabs, Links, Auswahl-Rand, Fortschritt, Primärbutton. Ausgewählt (dauerhaft, Zeilen) ist **ein** opakes Blau `#183245`; aktiv/gehovert in Menüs, Tabs und Chips ist **eine** Tönung `rgb(103 232 249 / 14 %)`. Drop-Ziele nutzen 22 %. Mehr Stufen gibt es nicht.
3. **Ampel nur für Zustände.** Ein Grün `#4ade80`, ein Gelb `#fcd34d`, ein Rot `#fb7185` für Punkte und Icons; Gefahr-Text `#fda4af`, Gefahr-Fläche `#341c25`, Gefahr-Rand `#713442`. Niemals dekorativ.
4. **Zwei Textstufen.** Text `#e2eaf4`, gedämpft `#a7b7cb`; Code-Text `#dce9f8`. Alles darunter (`#9eabbc`, `#8ea3bd`, `#cbd5e1`) fällt weg.
5. **Vier Control-Höhen.** 24 in Tabellen und Chip-Leisten, 28 in Leisten und Menüs, 32 Standard, 36 für Formulareingaben und Suche. Leisten 32 (Pane, Datei, Dock, View, Transfer), App-Kopf 44, Status 24.
6. **Drei Radien.** 4 innen (Tabs, Zeilen, Menüeinträge, Icon-Knöpfe in Leisten), 5 Standard (Buttons, Eingaben, Chips, Popover, Menüs), 8 für Dialoge und Karten; Pillen `999px`.
7. **Motion ist Ausnahme.** Druck (120 ms), Dialog (200 ms), Popover (160 ms), Hinweis (180 ms), Puls (1 s). Alles Tastatur-Erreichbare, alle Listen, Tabs, Chips und Terminalausgabe: sofort. Farbwechsel bei Hover: sofort, ohne Transition – „crisp and fast“ für ein Profi-Dashboard.

## 3. Designsystem als Tokens

Neue Datei `src/renderer/src/tokens.css`, importiert als erste Zeile von `styles.css` (`@import './tokens.css';`), damit `main.tsx:6` unverändert bleibt. Präfixe: `--color-*`, `--space-*`, `--radius-*`, `--font-*`/`--fs-*`, `--control-*`, `--bar-*`, `--layer-*`, `--shadow-*`, `--focus-*`, `--ease-*`, `--dur-*`. Schriftgrößen heißen `--fs-*`, weil `--text` als Alias bereits die Textfarbe meint.

```css
/* src/renderer/src/tokens.css — single source for colour, size, layer and motion */
:root {
  color-scheme: dark;

  /* Surfaces */
  --color-bg-stage: #070b14;      /* terminal, code, manifest */
  --color-bg-app: #090e17;        /* window background, view bar */
  --color-bg-panel: #111925;      /* bars, sidebar, dialogs, menus */
  --color-bg-raised: #182334;     /* controls, row hover */
  --color-bg-hover: #233045;      /* button hover */
  --color-bg-input: #0b111c;
  --color-bg-selected: #183245;   /* persistent row selection */
  --color-bg-active: rgb(103 232 249 / 14%);  /* active tab, menu focus, chip on */
  --color-bg-drop: rgb(103 232 249 / 22%);    /* drag targets */
  --color-bg-tint: rgb(103 232 249 / 6%);     /* soft highlight (release box, drop area) */
  --color-overlay: rgb(255 255 255 / 6%);     /* neutral row hover, tags */
  --color-backdrop: rgb(2 6 15 / 72%);

  /* Lines */
  --color-border: #29374b;
  --color-border-strong: #496078;

  /* Text */
  --color-text: #e2eaf4;
  --color-text-muted: #a7b7cb;
  --color-text-code: #dce9f8;

  /* Accent */
  --color-accent: #67e8f9;
  --color-accent-hover: #a5f3fc;
  --color-on-accent: #072733;
  --color-selection-bg: #164e63;
  --color-selection-text: #ecfeff;

  /* States */
  --color-ok: #4ade80;
  --color-warn: #fcd34d;
  --color-warn-border: #6b5520;
  --color-danger: #fda4af;         /* text */
  --color-danger-strong: #fb7185;  /* dots, icons */
  --color-danger-text: #fecdd3;    /* text on danger surface */
  --color-danger-bg: #341c25;
  --color-danger-bg-hover: #512333;
  --color-danger-border: #713442;

  /* Spacing */
  --space-2xs: 2px; --space-xs: 4px; --space-sm: 6px; --space-md: 8px;
  --space-lg: 12px; --space-xl: 16px; --space-2xl: 20px; --space-3xl: 24px; --space-4xl: 32px;

  /* Radii */
  --radius-sm: 4px; --radius-md: 5px; --radius-lg: 8px; --radius-pill: 999px;

  /* Type */
  --font-ui: 'Inter Variable', system-ui, sans-serif;
  --font-mono: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  --fs-xs: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-lg: 14px; --fs-xl: 18px; --fs-2xl: 22px;

  /* Controls and bars */
  --control-xs: 24px; --control-sm: 28px; --control-md: 32px; --control-lg: 36px;
  --bar-sm: 24px; --bar-md: 32px; --bar-lg: 44px;

  /* Layers */
  --layer-sticky: 1; --layer-handle: 10; --layer-chrome: 25; --layer-drag: 45;
  --layer-header: 60; --layer-popover: 70; --layer-menu: 80; --layer-modal: 90; --layer-toast: 100;

  /* Elevation and focus */
  --shadow-overlay: 0 10px 28px rgb(0 0 0 / 40%);
  --focus-outline: 2px solid var(--color-accent);
  --focus-offset: 2px;
  --focus-inset: inset 0 0 0 1px var(--color-accent);

  /* Motion */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  --dur-press: 120ms; --dur-fade: 150ms; --dur-popover: 160ms; --dur-hint: 180ms; --dur-modal: 200ms;
  --dur-pulse: 1000ms;

  /* Aliases, removed in 1.0 */
  --ui-bg: var(--color-bg-app); --ui-panel: var(--color-bg-panel); --ui-raised: var(--color-bg-raised);
  --ui-border: var(--color-border); --ui-text: var(--color-text); --ui-muted: var(--color-text-muted);
  --ui-accent: var(--color-accent); --ui-danger: var(--color-danger);
  --surface: var(--color-bg-panel); --surface-raised: var(--color-bg-raised); --surface-hover: var(--color-bg-hover);
  --border: var(--color-border); --text: var(--color-text); --text-muted: var(--color-text-muted); --accent: var(--color-accent);
  --ui-radius: var(--radius-md); --ui-control-height: var(--control-md); --ui-input-height: var(--control-lg);
}
@keyframes tm-pulse { 50% { opacity: .35; } }
```

### 3.1 Faltungstabelle (alt → neu)

| Alt | Neu | Betroffen |
|---|---|---|
| `#070b14`, `#05080e` | `--color-bg-stage` | `styles.css:83`, `terminal-ui.css:3,9,28,66`, `assistant-ui.css:19`, `workflows-ui.css:25`, `kubernetes-ui.css:104` |
| `#0b1120` | `--color-bg-app` | `terminal-ui.css:71` |
| `#0b111c` | `--color-bg-input` | `styles.css:20` |
| `#233045`, `var(--surface-hover)` | `--color-bg-hover` | `styles.css:17`, `kubernetes-ui.css:61,65,91,95`, `terminal-ui.css:10,22,25`, `files-ui.css:13,20`, `assistant-ui.css:7` |
| `#496078` | `--color-border-strong` | `styles.css:17`, `terminal-ui.css:9`, `kubernetes-ui.css:61,65` |
| `#182b3c`, `#183245`, `#1d3a4a`, `rgb(103 232 249 / 16%)` | `--color-bg-selected` | `styles.css:78`, `navigation-ui.css:6`, `editor-ui.css:14`, `kubernetes-ui.css:84`, `files-ui.css:43` |
| Cyan 14 %, 18 %, 20 % | `--color-bg-active` | `terminal-ui.css:75`, `navigation-ui.css:44,54`, `assistant-ui.css:16`, `workflows-ui.css:11,18`, `styles.css:73` |
| Cyan 22 %, 26 % | `--color-bg-drop` | `terminal-ui.css:76`, `files-ui.css:45` |
| Cyan 6 % | `--color-bg-tint` | `styles.css:126`, `files-ui.css:38` |
| Cyan 35 %, 40 %, 45 %, 55 % (Ränder) | `--color-accent` bzw. `--color-border-strong` | `styles.css:126`, `assistant-ui.css:29`, `navigation-ui.css:57`, `files-ui.css:44` |
| `rgb(22 78 99 / 55%)` | `--color-selection-bg` (opak genügt, Vorschau liegt über Terminal) | `terminal-ui.css:51` |
| Weiß 4 %, 5 %, 8 % | `--color-overlay` | `files-ui.css:42,70`, `terminal-ui.css:74,78`, `workflows-ui.css:19` |
| `#4ade80`, `#86efac` | `--color-ok` | siehe 1.2 |
| `#fbbf24`, `#facc15`, `#fcd34d` | `--color-warn`; `#6b5520` → `--color-warn-border` | `terminal-ui.css:17`, `navigation-ui.css:64`, `kubernetes-ui.css:9,12,40` |
| `#fb7185` | `--color-danger-strong` | `terminal-ui.css:18` |
| `#fecdd3` | `--color-danger-text` | `styles.css:39,45,92` |
| `#341c25`, `#351c26`, `#3b1d24`, `#22121a`, `rgb(251 113 133 / 10%)` | `--color-danger-bg` | `styles.css:39,45,92`, `kubernetes-ui.css:20,52`, `files-ui.css:30` |
| `#512333` | `--color-danger-bg-hover` | `styles.css:40` |
| `#713442`, `#5b2a33`, `rgb(251 113 133 / 30%)` | `--color-danger-border` | `styles.css:39,45,92`, `kubernetes-ui.css:20,41,52`, `files-ui.css:30` |
| `#9eabbc`, `#8ea3bd`, `#36465c`, `#3a4b61` | `--color-text-muted` (Punkte, Platzhalter) bzw. `--color-border-strong` (Close-Hover, Scrollbar) | `terminal-ui.css:15,21,54,67`, `styles.css:28` |
| `#a5f3fc` | `--color-accent-hover` | `styles.css:37`, `kubernetes-ui.css:55` |
| `#072733`, `#04121a` | `--color-on-accent` | `styles.css:36,37`, `kubernetes-dock.css:8` |
| `#dce9f8`, `#cbd5e1` | `--color-text-code` | `assistant-ui.css:21`, `workflows-ui.css:14,25`, `kubernetes-ui.css:104` |
| `#111925`, `#e2eaf4`, `#aebdd0` im Dock-Preview | `--color-bg-panel`, `--color-text`, `--color-text-muted` | `terminal-ui.css:52-53` |
| Backdrop 55 % | `--color-backdrop` | `workflows-ui.css:5` |
| Schatten 35 %/45 % | `--shadow-overlay` (zusätzlich auf Picker, Workspace- und Layout-Menü) | `navigation-ui.css:42`, `styles.css:141`, `terminal-ui.css:35,55`, `navigation-ui.css:32` |
| z-index 1–3 | `--layer-sticky` (2 und 3 werden 1; Sticky-Köpfe konkurrieren nicht) | `styles.css:88`, `files-ui.css:47`, `kubernetes-ui.css:78`, `editor-ui.css:31` |
| 10, 15 | `--layer-handle` | `terminal-ui.css:40`, `styles.css:72` |
| 25, 30 | `--layer-chrome`, Layout-Menü `calc(var(--layer-chrome) + 5)` | `terminal-ui.css:35,36` |
| 45, 46 | `--layer-drag`, Marker `calc(var(--layer-drag) + 1)` | `terminal-ui.css:50,51`, `styles.css:102` |
| 50 (**Kube-Backdrop**) | `--layer-modal` (90, über Kopf) – behebt 1.4 | `kubernetes-ui.css:108` |
| 60, 70, 80, 1000 | `--layer-header`, `--layer-popover`, `--layer-menu`, `--layer-toast` | `styles.css:64,141`, `navigation-ui.css:32,42` |
| Radius 3 → 4, 6 → 5, 9 → pill, 8 (Pille) → pill | `--radius-sm/-md/-pill` | siehe 1.3 |
| Mono-Stack ohne Cascadia | `--font-mono` | `kubernetes-ui.css:76,104,120` |
| Exakte Höhen 24/28/32/36 | `--control-xs/-sm/-md/-lg`; 44/32/24-Leisten → `--bar-*` | siehe 1.3 |

**Nicht in Stufe 1 gefaltet** (Layoutänderung, eigene Stufe): Höhen 20/22/26/30/34/40, Schriftgrößen 10/15/17/20/24, Abstände 3/5/7/9/14. Sie werden tokenisiert, sobald sie auf einen Skalenwert gelegt werden (Abschnitt 6, Stufe 2).

### 3.2 Zustände, einheitlich

| Zustand | Regel |
|---|---|
| Hover Button | `background: var(--color-bg-hover); border-color: var(--color-border-strong)` – ohne Transition |
| Hover Zeile | `background: var(--color-bg-raised)` (Baum, Kube-Tabelle); Dateizeile `var(--color-overlay)` bleibt, weil 24 px-Zeilen mit Raised zu laut werden |
| Hover Menüeintrag / Chip / Tab | `background: var(--color-bg-active)` |
| Ausgewählt (dauerhaft) | `background: var(--color-bg-selected)`; Cursor-Rahmen `box-shadow: var(--focus-inset)` |
| Gedrückt (`aria-pressed`) | Rand `var(--color-accent)`, Fläche `var(--color-bg-selected)`; Dock-Format-Umschalter behält Akzentfläche mit `--color-on-accent` (Segmentknopf) |
| Disabled | `opacity: .45` global; Menüeintrag und Zeilen `.5`; `.6` fällt weg |
| Fokus | `outline: var(--focus-outline); outline-offset: var(--focus-offset)`; Listen und Griffe `--focus-inset` bzw. `outline-offset: -2px` |
| Druck | `transform: scale(.97)` 120 ms, siehe 4 |

## 4. Motion-Kandidaten mit Gate

Werkzeug ist immer CSS (Transition oder `@starting-style`), nie eine Bibliothek. Electron 44 (Chromium 132) kann `@starting-style`, `transition-behavior: allow-discrete` und `overlay`. Jede Regel mit `transform` steht hinter `@media (prefers-reduced-motion: no-preference)` und liefert in `reduce` nur Opazität. Hover-Transformationen gibt es nicht; die Hover-Gate-Regel wird in den Test aufgenommen, damit künftige Regeln sie einhalten.

| Kandidat | Häufigkeit | Entscheidung | Zweck | Eigenschaften, Kurve, Dauer, Origin | Reduced motion |
|---|---|---|---|---|---|
| Button `:active` (alle außer Liste unten) | zig/Tag | **animieren, minimal** | Feedback | `transform: scale(.97)`, `--ease-out`, `--dur-press` 120 ms | `transform: none` |
| Flache Druckelemente: `[role=tab]`, `[role=menuitem]`, `.tree-node-button`, `.tree-toggle`, `.kube-crumb`, `.kube-link`, `.link-button`, `.version-button`, `.connection-picker-option`, `.file-row-head button`, `.file-path nav button` | 100+/Tag, teils Tastatur | **nicht** | Breite Flächen skalieren sichtbar; Listen- und Tabnavigation | Ausnahme-Selektor mit Spezifität ≥ `button:active:not(:disabled)` (0,2,1) und spätere Quellposition | – |
| Bestätigungs-, KI-, Konflikt-, Release-Notes-Dialog (`.confirm-dialog`) | gelegentlich | **animieren** | harten Wechsel vermeiden | `opacity 0→1`, `scale(.97)→1`, `--ease-out`, `--dur-modal` 200 ms; `::backdrop` `opacity` 200 ms; `transform-origin: center` (Modal-Ausnahme); Exit entfällt, React unmountet | nur `opacity` |
| Workflow-Palette (`.workflow-palette`) | Strg+Umschalt+Leertaste, 100+/Tag | **nicht** | Tastatur, Command-Palette = Raycast-Fall | hat nicht die Klasse `.confirm-dialog`, bleibt automatisch ohne; zusätzlich expliziter Kommentar in `workflows-ui.css` | – |
| Hilfe-Overlay Kube/Container (`.kube-modal`) | Taste `?` | **nicht** | Tastatur | z-index-Korrektur auf `--layer-modal`, sonst nichts | – |
| Kontextmenü (`.context-menu`) | zig/Tag, Shift+F10 / Menütaste möglich | **nicht** | Tastatur-erreichbar, hoher Takt; „sieht gut aus“ ist kein Zweck | Schatten auf `--shadow-overlay` | – |
| Verbindungs-Picker (`.connection-picker`) | gelegentlich, nur Klick | **animieren** | harten Wechsel vermeiden, Herkunft zeigen | Popover-API: `transition: opacity, transform, overlay, display` mit `allow-discrete`; `@starting-style { opacity: 0; transform: scale(.97) }`; Exit gleich (`:not(:popover-open)`); `--ease-out`, `--dur-popover` 160 ms; `transform-origin: top left`, bei `downward === false` `bottom left` – eine Zeile in `ConnectionPicker.tsx:42-47` (`transformOrigin` ins `Object.assign`, Richtung aus `downward` in `:40`) | nur `opacity` |
| Workspace-Menü (`.workspace-menu-content`) | gelegentlich, Klick auf Summary | **animieren** | harten Wechsel vermeiden | `details[open] > .workspace-menu-content` mit `@starting-style { opacity: 0; transform: translateY(-4px) }`, `--ease-out`, 160 ms, Origin `top left`; Exit entfällt (`<details>` blendet hart) | nur `opacity` |
| Layout-Menü (`.pane-layout-menu`) | gelegentlich, Button | **animieren** | wie oben | `@starting-style` `opacity` + `scale(.97)`, `--ease-out`, 160 ms, `transform-origin: top right` (sitzt rechts unter dem Knopf, `terminal-ui.css:35`) | nur `opacity` |
| Datei-Drop-Hinweis (`.file-drop-hint`) | selten | **animieren** | harten Wechsel vermeiden | `@starting-style { opacity: 0; transform: translate(-50%, -8px) }`, `--ease-out`, `--dur-hint` 180 ms | nur `opacity` |
| Fehlermeldung unten (`.app-error`) | gelegentlich | **nicht (jetzt)** | Element liegt im Fluss und verschiebt Layout; ein Fade überbrückt nichts | Stufe 2: eigenständiger Toast, `translateY(100%)→0`, 220 ms `--ease-out`, Exit denselben Weg, Transitions statt Keyframes | – |
| Statustext unten (`savedNotice`) | häufig | **nicht** | Textwechsel, keine Bewegung | – | – |
| Tabs: Wechsel, Hinzufügen, Schließen (Terminal, View, Kube-Arten, Dock) | 100+/Tag, Tastatur | **nicht** | Tastatur, Layout-Eigenschaften | – | – |
| Tab-Drag: `.dock-preview`, `.tab-drop-marker`, `.is-dragging-tab` | Geste | **nicht** | folgt dem Zeiger; Transition würde nachhinken | – | – |
| Dock auf/zu (`.kube-dock`) | Strg+J | **nicht** | Tastatur; Höhe ist Inline-Layout; xterm fittet neu | – | – |
| Seitenleiste auf/zu (`.sidebar-container`) | Button, mehrmals/Tag | **nicht** | Breite ist Layout; jedes Zwischenbild löst xterm-Resize aus | – | – |
| Baum auf/zu, Zeilenaktionen bei Hover | zig/Tag, Tastatur | **nicht** | Listennavigation | – | – |
| Zeilenauswahl, Cursor (Baum, Datei, Kube) | 100+/Tag | **nicht** | Tastatur | – | – |
| Chips, Filter, Gruppieren (`.kube-filter-chip`, `.kube-kind`) | zig/Tag, Tasten `w`, `F` | **nicht** | Tastatur | – | – |
| Hover-Farbwechsel (alle) | zig/Tag | **nicht** | sofortiger Zustandswechsel ist für ein Terminal-Werkzeug das richtige Gefühl | keine `transition` auf `background`/`color` | – |
| „Beschäftigt“-Punkt, Tipp-Indikator (`.container-state.is-busy`, `.assistant-typing`) | laufend | **behalten, vereinheitlichen** | Zustandsanzeige | `tm-pulse`, `--dur-pulse` 1 s, `--ease-in-out`, infinite | `animation: none` (bleibt sichtbar in Akzentfarbe) |
| Fortschrittsbalken (`progress`) | laufend | **behalten** | konstante Bewegung | `width`, `linear`, `--dur-fade`; geduldete Layout-Eigenschaft (kein Transform auf `<progress>`) | `transition: none` (vorhanden) |
| `.kube-stale` (Grau bei verlorener Verbindung) | selten | **nicht (jetzt)** | `filter` über eine große Tabelle zu teuer | Stufe 2: nur `opacity` 200 ms | – |
| `.ctr-busy` (Zeile `opacity: .6`) | gelegentlich | **nicht** | Zustand, kein Übergang nötig | – | – |
| Tooltips | – | **nicht** | nur natives `title=`; falls je eigene: 125 ms, Verzögerung 400 ms, Folge-Tooltips sofort | – | – |
| Welcome-Liste, Release-Box | bei jedem leeren Workspace | **nicht** | nicht „first-time“, also kein Delight-Budget | – | – |
| Spinner, Skelette | – | **nicht einführen** | nichts vorhanden; Texte „Suche Laufzeiten …“ genügen | – | – |
| Terminalausgabe, xterm-Cursor | – | **nie** | Terminal | xterm-Theme unangetastet | – |

Gate-Zusammenfassung: fünf Bewegungen (Druck, Dialog, drei Popover, Hinweis), zwei bestehende Pulse vereinheitlicht, ein Fortschrittsbalken geduldet. Sechzehn Kandidaten ausdrücklich ohne Animation.

Feel-Check für den Prüfer: Dialog-Einblendung und Picker bei 5-facher Dauer im DevTools-Animations-Panel ansehen; Druck-Feedback auf `.icon-button` (32 px) und `.primary-button` vergleichen, ob 0,97 bei beiden sichtbar, aber nicht wackelig ist.

## 5. Doku und Nutzung

- **`docs/design-system.md`** (neu, Deutsch, kurz): Faden (Abschnitt 2), Token-Tabellen mit Rolle und Beispiel, Zustandsmatrix (3.2), Motion-Gate-Tabelle (4) als Entscheidungsvorlage, Regeln für neue CSS (unten), Hinweis auf den Lint-Test.
- **Regeln für Komponenten-CSS:** Jede Fläche hat ihre Datei mit eigenem Präfix (`.kube-`, `.ctr-`, `.file-`, `.assistant-`, `.workflow-`, `.tree-`/`.vault-`, `.pane-`/`.view-`). Nur `var(--…)` aus `tokens.css`; keine Hex-, `rgb()`-, `hsl()`-Literale, keine `var(--x, #fallback)`, keine literalen `ms`, `cubic-bezier`, `z-index`-Zahlen. Neue Motion nur mit Eintrag in der Gate-Tabelle und `prefers-reduced-motion` in derselben Datei. Inline-`style` nur für berechnete Geometrie (Einrückung, Breite, Position), nie für Farbe. xterm-Theme-Werte in `TerminalPanel.tsx:51` sind die Literale von `--color-bg-stage`, `--color-text-code`, `--color-accent`, `--color-selection-bg`; wer eines ändert, ändert beide (Stufe 2 liest sie per `getComputedStyle`).
- **Spec-Querverweis:** Die Design-Spec der Pipeline (`docs/superpowers/specs/2026-10-19-design-system-design.md`) zitiert Abschnitt 2 und 4 als Rulings; die Validation legt den DOM-Vertrag fest (Klassen bleiben, nur Werte ändern sich).

## 6. Umfang, Risiken, Tasks

### 6.1 Stufe 1 (dieser Branch)

| Fläche | Wert | Aufwand |
|---|---|---|
| `tokens.css` mit Aliasen, `styles.css` umgestellt, Dialog-Einblendung, Druck-Feedback | ★★★ | nur Renderer |
| Alle neun weiteren CSS-Dateien auf Token-Namen; Varianten gefaltet (3.1); tote Fallbacks entfernt | ★★★ | nur Renderer |
| Kube-Backdrop über den App-Kopf (`--layer-modal`) | ★★★ | nur Renderer, eine Zeile |
| Popover-Einblendung Picker/Workspace/Layout mit Origin, Schatten auf allen Schwebeflächen | ★★ | nur Renderer (+ eine Zeile `ConnectionPicker.tsx`) |
| Drop-Hinweis-Einblendung, Puls vereinheitlicht | ★ | nur Renderer |
| Lint-Test `src/renderer/src/design-tokens.test.ts` | ★★★ | nur Renderer |
| `docs/design-system.md` | ★★ | Doku |

### 6.2 Stufe 2 (Extras, eigene Pipeline-Runde)

| Fläche | Wert | Aufwand |
|---|---|---|
| Control-Höhen 20/22/26/30 → 24/28; Leisten 30/34/40 → 32; Schrift 10/15/17/20/24 → Skala; Abstände 3/5/7/9/14 → Skala; danach Test verbietet literale `px` in diesen Eigenschaften | ★★ | nur Renderer, Layoutänderung je Datei |
| Toast-Komponente für `.app-error` statt Fluss-Banner (Exit = Enter-Pfad, Transitions) | ★★ | kleine Renderer-Änderung in `App.tsx`, `SecondaryWindow.tsx` |
| xterm-Theme aus Tokens (`getComputedStyle(document.documentElement)`) | ★ | kleine Renderer-Änderung `TerminalPanel.tsx` |
| `.kube-stale` Opazitäts-Übergang, `.connection-test`- und `.transfer-job`-Einblendung | ★ | nur Renderer |
| Aliase `--ui-*`/`--surface*` entfernen, Test verbietet sie | ★ | nur Renderer, in 1.0 |

### 6.3 Was ausdrücklich nicht getan wird

- Kein Framework, keine Motion-Bibliothek, kein CSS-in-JS, kein Tailwind. Reine CSS-Dateien bleiben.
- Keine neue Farbe. Jeder Token-Wert existiert heute schon; Faltungen gehen immer auf den häufigsten Bestandswert.
- Kein UI-Text ändert sich. Keine Klasse wird umbenannt (DOM-Vertrag früherer Validierungen, z. B. `container-view-validation.md:678-680`, `kubernetes-search-filter-validation.md:499`).
- `TerminalPanel.tsx:51` (xterm-Theme) wird nicht angefasst. `.terminal-panel`, `.split-terminal-stage`, `.rdp-surface`, `.kube-dock-terminal` bekommen weder `transform` noch `transition` noch `filter`: Die native RDP-Fläche wird aus DOM-Rechtecken positioniert (`native-surface.ts`), xterm fittet auf Größenänderung.
- Keine Animation auf Tastaturwegen (Palette, Hilfe, Dock, Tabs, Kontextmenü, Chips, Baum, Zeilen) – auch nicht „nur beim Klick“: ein Element hat ein Verhalten.
- Keine `transition` auf `width`, `height`, `padding`, `margin`, `top`, `left` – Ausnahme bleibt der bestehende `<progress>`-Balken.
- Keine Light-Theme-Vorbereitung. Rollen-Namen machen sie später möglich, aber es gibt keinen zweiten Satz.
- Main-Prozess, Preload, Shared: unberührt.

### 6.4 Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Visuelle Regression ohne Screenshot-Tests | Faltungen sind in 3.1 vollständig aufgelistet; jeder Task meldet seine Vorher/Nachher-Werte; Prüfer startet `npm run dev` und geht Seitenleiste, Terminal-Tabs, Dateien, Cluster, Container, Assistent, Dialoge, Palette durch. Stufe 1 ändert keine Geometrie, nur Farbvarianten, Schatten und z-index. |
| `@import` in `styles.css` lädt Tokens nach den Komponenten-CSS (Vite hebt `@import` an den Anfang der Datei; die Reihenfolge der Komponentenimporte in `main.tsx` bleibt) | `main.tsx:6` importiert `styles.css` zuletzt, aber Custom Properties auf `:root` sind reihenfolgeunabhängig. Kein Problem; trotzdem im Task prüfen, dass `tokens.css` im Bundle vor `styles.css`-Regeln steht. |
| Dialog-Transition mit `display`/`overlay` `allow-discrete`: Falls Electron die Eigenschaft `overlay` nicht transitioniert, verschwindet nur der Exit, der ohnehin nicht genutzt wird | Nur Enter-Pfad spezifizieren (`@starting-style`), kein Exit für `<dialog>`. |
| `scale(.97)` auf `button` trifft Buttons mit eigenem `transform` | Heute keiner (`grep transform` in 1.5). Ausnahme-Liste in 4 hält Tabs, Menüeinträge und Baumknöpfe frei. |
| `transform` auf `.file-drop-hint` kollidiert mit `translateX(-50%)` (`styles.css:141`) | Start-Transform enthält `translate(-50%, -8px)`, Endzustand `translate(-50%, 0)`. |
| Aliase verschleiern verbliebene Altnamen | Test in Stufe 2 verbietet `--ui-*`; Stufe 1 duldet sie. |
| Kube-Backdrop neu über dem Kopf ändert Klickverhalten (Kopf war bisher klickbar bei offener Hilfe) | Gewollt; Hilfe schließt mit Escape oder „Schließen“. |

### 6.5 Test in vitest

`src/renderer/src/design-tokens.test.ts` liest alle `**/*.css` unter `src/renderer/src` mit `fs`, entfernt Kommentare (`/* … */`) und prüft je Datei (`tokens.css` ist die einzige Quelle für Literale):

1. **Keine harten Farben** außerhalb `tokens.css`: Regex `#[0-9a-fA-F]{3,8}\b`, `\brgba?\(`, `\bhsla?\(`. Fängt auch `var(--x, #fallback)`.
2. **Kein `transition: all`** / `transition-property: all`.
3. **Keine eingebauten Easings und keine `cubic-bezier(`** außerhalb `tokens.css`: Regex `(?<![-\w])ease(-in|-out|-in-out)?\b` – erlaubt bleibt `linear`; `var(--ease-out)` passt nicht, weil ein `-` davorsteht.
4. **Keine literalen Dauern** (`\d+m?s\b`) in `transition`/`animation`-Deklarationen außerhalb `tokens.css`; in `tokens.css` jedes `--dur-*` ≤ 300 ms außer `--dur-pulse`.
5. **Kein `scale(0)`** / `scale(0,`.
6. **Kein literaler `z-index: <Zahl>`** außerhalb `tokens.css`.
7. **Reduced motion:** Jede Datei, die `transition:` (außer `transition: none`) oder `animation:` enthält, enthält `prefers-reduced-motion`.
8. **Hover-Gate:** Kein Regelblock mit `:hover` im Selektor und `transform` oder `transition` in der Deklaration, es sei denn, die Datei enthält `(hover: hover)`; einfacher Klammer-Tokenizer, keine Parser-Abhängigkeit.
9. **Vertrag `tokens.css`:** Die drei Kurven stehen exakt wie in Abschnitt 3; alle Aliasnamen aus 3 sind definiert; `@keyframes tm-pulse` existiert.

Stufe 1 lässt den Test zunächst gegen `MIGRATED = ['tokens.css', 'styles.css']` laufen (Welle 1); Welle 3 weitet auf alle Dateien aus. So bleibt jedes Wellen-Gate grün und keine zwei Tasks schreiben dieselbe Datei. Kein Browser nötig: reine Textprüfung, läuft in der vorhandenen Node-Umgebung wie `terminal-tabs.test.ts`.

### 6.6 Tasks in Wellen (disjunkte Dateien)

| Welle | Task | Dateien | Hängt ab von | Inhalt |
|---|---|---|---|---|
| 1 | **T1 Tokens, Shell, Test** | `src/renderer/src/tokens.css` (neu), `src/renderer/src/styles.css`, `src/renderer/src/design-tokens.test.ts` (neu) | – | Tokens aus 3; `@import`; `styles.css` auf neue Namen, Faltung 3.1, `--layer-*`, Druck-Feedback mit Ausnahme-Selektor, Dialog-Enter auf `.confirm-dialog` + `::backdrop`, `.file-drop-hint`-Enter, reduced-motion; Test gegen `MIGRATED` |
| 2 | **T2 Terminal** | `src/renderer/src/terminal-ui.css`, `src/renderer/src/components/ConnectionPicker.tsx` (eine Zeile `transformOrigin`) | T1 | Faltung, Fallbacks weg, Picker-Transition mit Exit, Layout-Menü-Enter, Schatten, Tab-Status-Farben auf `--color-ok/-warn/-danger-strong` |
| 2 | **T3 Navigation** | `src/renderer/src/components/navigation-ui.css` | T1 | Faltung, Kontextmenü ohne Motion (Kommentar), Workspace-Menü-Enter, `tm-pulse`, Schatten |
| 2 | **T4 Editor** | `src/renderer/src/components/editor-ui.css` | T1 | Fallbacks weg, `--color-bg-selected`, `--color-ok`, Fokus-Offset auf Token |
| 2 | **T5 Dateien** | `src/renderer/src/files-ui.css` | T1 | Faltung Cyan-Stufen, Weiß-Overlay, Gefahr, Mono-Font, `progress` auf `linear` + `--dur-fade` |
| 2 | **T6 Kubernetes/Container** | `src/renderer/src/kubernetes-ui.css`, `src/renderer/src/kubernetes-dock.css`, `src/renderer/src/containers-ui.css` | T1 | Faltung (`#233045`, `#496078`, `#1d3a4a`, Grün, Gelb, Gefahr-Töne, Manifest), `--layer-modal`, Mono-Font, Hilfe-Overlay ausdrücklich ohne Motion |
| 2 | **T7 Assistent/Workflows** | `src/renderer/src/assistant-ui.css`, `src/renderer/src/workflows-ui.css` | T1 | Faltung, `tm-pulse`, Backdrop 72 %, Palette ausdrücklich ohne Motion |
| 3 | **T8 Test auf alle, Doku** | `src/renderer/src/design-tokens.test.ts`, `docs/design-system.md` (neu), `README.md` (ein Absatz) | T2–T7 | `MIGRATED` entfällt, alle Dateien geprüft; Doku nach 5 |

Gate je Welle: `npm run typecheck`, `npx vitest run`. T2 ist der einzige Task mit einer TSX-Zeile; alles andere ist CSS und Doku. Keine Main-Änderung, keine Schema-Änderung, kein neuer Abhängigkeitseintrag.
