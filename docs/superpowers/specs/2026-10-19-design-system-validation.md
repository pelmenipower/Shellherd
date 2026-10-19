# Designsystem und Motion – Validierung

Stand: 2026-10-19 · Branch `claude/feature/design-system` · HEAD `c7e7ab0` · Prüfer: Opus (Stufe 3)

Geprüft gegen: Spec `2026-10-19-design-system-design.md` (D1–D10), Plan `docs/superpowers/plans/2026-10-19-design-system.md` (Abschnitte 2, 3, 4, 5, 6.3, 6.5 und 6.6), die Skills `animate` und `emil-design-eng` sowie den echten Bestand aller zehn CSS-Dateien, der TSX-Inline-Styles, `main.tsx` und der Configs. Baseline: `npm run typecheck` ist grün, `npx vitest run` ergibt 81 Dateien und 1138 Tests, alle grün. Die Lint-Regeln wurden im Scratchpad als Prototyp gegen den Bestand und gegen eine Fixture gefahren. Sie lösen am Bestand die erwarteten Treffer aus (z-index, Easing, Dauer, harte Farben) und keine Fehlalarme (`.release-notes-*`, `text-transform`, ID-Selektoren).

**Dieser Anhang ist bindend und geht Spec und Plan vor.**

## Urteil

**ready after corrections** – 4 Blocker, 12 Korrekturen, 10 Entscheidungen.

Der Plan trifft den Bestand weitgehend. Die Datei:Zeile-Angaben in 1.2, 1.4 und 3.1 stimmen bis auf die Punkte in K9. Das Gate ist sauber begründet, die Kurven entsprechen exakt dem Skill, und alle Dauern liegen bei 300 ms oder darunter. Die Blocker betreffen:

- ein unzuverlässiges `@starting-style` im `<details>`-Menü,
- eine Druck-Ausnahmeliste, die D4 widerspricht,
- Farben ohne Zuordnung bzw. mit unentschiedener Zuordnung,
- ein Welle-2-Gate, das keine Verstöße sehen kann.

---

## 1. Blocker (mit Fix)

### B1 – Workspace-Menü: `@starting-style` auf `<details>`-Inhalt ist nicht verlässlich

`.workspace-menu-content` ist immer im DOM (`WorkspaceControls.tsx:83`, innerhalb `<details className="workspace-menu">`). Chromium blendet geschlossenen `<details>`-Inhalt über `content-visibility: hidden` des Content-Slots aus, nicht über `display: none` am Kind. Damit hat das Kind nach dem ersten Öffnen einen „before-change style“, und `@starting-style` greift höchstens beim ersten Öffnen. Das Verhalten wäre uneinheitlich.

**Fix (bindend, T3):** Das Menü bekommt eine CSS-Animation (Keyframes). Sie startet deterministisch, sobald `[open]` gesetzt ist. Das Menü wird gelegentlich per Klick geöffnet und nicht in schneller Folge umgeschaltet. Die Regel „Transitions statt Keyframes bei schnellem Auslösen“ greift deshalb nicht. Einen Exit gibt es nicht. Der Code steht wörtlich in 3.4.

### B2 – Druck-Ausnahmen widersprechen D4 und treffen breite Flächen

Ohne `role="tab"` bekämen diese Buttons das `scale(.97)`:

- `.kube-filter-chip`: `ResourceTable.tsx:134`, `ContainerTable.tsx:122`. D4 sagt aber „Chips nicht animiert“.
- der Segment-Umschalter `.kube-dock-format button` (`DetailDock.tsx:148`). Mit `margin-left: -1px` öffnet sich beim Skalieren eine Fuge.
- die Node-Kacheln `.kube-node` (`NodeStrip.tsx:38`, `role="listitem"`)
- breite Listen- und Menübuttons: `.root-row` (`App.tsx:805`), `.welcome-list button`, `.workspace-definition-actions button`, `.workspace-current-actions button`, `.pane-layout-menu button`

Außerdem ist „Ausnahme mit späterer Quellposition“ in einer Komponenten-Datei falsch. `main.tsx:6` importiert `styles.css` **nach** `App` (und damit nach allen Komponenten-CSS). `styles.css` steht im Bundle also zuletzt.

**Fix (bindend, T1):** Es gibt eine einzige Regel mit `:not()`-Liste in `styles.css` und keine Override-Regel (Selektor in 3.2). Damit gibt es keinen Spezifitätswettlauf. Neue flache Druckelemente kommen künftig in diese Liste (Doku).

### B3 – Faltung lückenhaft bzw. mehrdeutig

- `terminal-ui.css:54` `.dock-blocked { background: rgb(17 25 37 / 65%) }` taucht weder in 1.2 noch in 3.1 auf. Der Lint in Welle 3 würde rot, und kein Task wäre zuständig.
- 3.1 „Cyan 35 %, 40 %, 45 %, 55 % (Ränder) → `--color-accent` **bzw.** `--color-border-strong`“ legt den Wert pro Zeile nicht fest.
- `navigation-ui.css:54` (`.is-drop-into`, 18 %) geht laut 3.1 auf `--color-bg-active`. Abschnitt 2 sagt aber „Drop-Ziele nutzen 22 %“.

**Fix:** Die Zeilen-Faltung pro Datei in Abschnitt 4 ist abschließend. Alles, was dort steht, wird so umgesetzt. Was eine Datei nach der Umstellung noch an Literalen enthält, schlägt im Lint fehl.

### B4 – Welle-2-Gate ist blind

In Welle 2 prüft der Test nur `MIGRATED = ['tokens.css', 'styles.css']`. Ein Verstoß in T2–T7 fällt erst in Welle 3 auf. T8 darf diese Dateien aber nicht anfassen (disjunkte Wellen), und die Pipeline bliebe hängen.

**Fix (bindend):** T1 baut den Test mit dem Schalter `DESIGN_LINT_ALL=1` (siehe 3.6). Jeder Task T2–T7 muss vor Abschluss Folgendes ausführen und für **seine** Dateien 0 Fehlschläge melden:

```powershell
$env:DESIGN_LINT_ALL='1'; npx vitest run src/renderer/src/design-tokens.test.ts; Remove-Item Env:DESIGN_LINT_ALL
```

Fehlschläge in Dateien anderer Tasks werden ignoriert. Ohne Schalter bleibt das Gate (`npx vitest run`) grün.

---

## 2. Korrekturen

| # | Korrektur | Beleg | Bindend für |
|---|---|---|---|
| K1 | `--color-overlay` wird `rgb(255 255 255 / 8%)` statt 6 %. D1 verlangt den häufigsten Bestandswert, und 6 % existiert nicht. | 8 %: `terminal-ui.css:74,78`, `workflows-ui.css:19`; 4 %/5 % je einmal (`files-ui.css:42,70`) | T1 |
| K2 | `--shadow-overlay` wird `0 10px 28px rgb(0 0 0 / 45%)` statt 40 %. Grund ist D1, 40 % existiert nicht. | `navigation-ui.css:42` | T1 |
| K3 | Der Verbindungs-Picker bekommt **nur Enter, keinen Exit**: kein `overlay` und kein `display … allow-discrete`. Geschlossen wird per Escape/Enter (Tastatur, Gate), und `useNativeSurfaceBlock(open)` gibt die RDP-Fläche schon bei `toggle` frei. Das native Fenster schnitte den Fade-out ab. Das Verhalten passt zu Workspace- und Layout-Menü. | `ConnectionPicker.tsx:23,60,62,65` | T2 |
| K4 | Der Ursprung des Pickers ist der **Auslöser**, nicht pauschal `top left`. `left` wird geklemmt (`:44`), deshalb sitzt der Knopf nicht immer links. Code in 3.3. | `ConnectionPicker.tsx:42-47` | T2 |
| K5 | `.dock-preview` (`terminal-ui.css:51`) bekommt `--color-bg-drop` statt `--color-selection-bg`. Es ist ein Drop-Ziel (Abschnitt 2), bleibt so durchscheinend und nimmt `--color-selection-bg` nicht für eine zweite Rolle. | Plan 2, Punkt 2 | T2 |
| K6 | Der CHANGELOG ist im Plan 6.6 keinem Task zugeordnet, die Spec 3 verlangt ihn. Er geht an **T8**, Texte wörtlich in 6. Es entsteht kein neuer `## [x.y.z]`-Kopf, die Version bleibt 0.9.0 (`version.test.ts:9-13`). | Spec D9 | T8 |
| K7 | Die Lint-Regeln wirken nur auf **Deklarationswerte** bzw. exakte Eigenschaftsnamen, nicht auf Selektoren und nicht auf den Volltext. Hover- und Reduced-Motion-Gate prüfen die umschließenden At-Regeln, nicht „Datei enthält …“. `transform` wird exakt verglichen, damit `text-transform` nicht trifft. Vollständige Regeln in 3.6. | Prototyp im Scratchpad | T1, T8 |
| K8 | „Electron 44 (Chromium 132)“ ist falsch, Chromium 132 gehört zu Electron 34. In Electron 44.4.2 sind alle genutzten Features vorhanden: `@starting-style` und `transition-behavior` ab Chromium 117, `:not()` mit Selektorliste ab 88. Das ändert nichts an der Umsetzung. | `node_modules/electron/dist/version` = 44.4.2 | T8 (Doku) |
| K9 | Inventar nachgetragen: `styles.css:20` ist die Eingabefläche, nicht die Bühne. Bei z-index fehlt in 1.4 `files-ui.css:47`. Die tote-Fallback-Liste in 1.1 ist unvollständig: auch `terminal-ui.css:6,12,13,19,22,27,34,37,41,46,71,72,75,76,77,78` und `editor-ui.css:29,30,46`. In 3.1 fehlen `styles.css:25` (Selektion), `styles.css:47` und `kubernetes-ui.css:108` (Backdrop, schon 72 %). Abschnitt 4 enthält alle. | Grep des Bestands | T1–T7 |
| K10 | Plan 3.2 „Hover Menüeintrag / Chip / Tab: `--color-bg-active`“ widerspricht der Faltung (`--surface-hover` → `--color-bg-hover` auf Tabs, z. B. `terminal-ui.css:10`), außerdem D1. **Stufe 1 ändert Hover-Flächen nur über die Faltung.** Die Zustandsmatrix gilt in der Fassung von 3.7. | Plan 3.1 vs. 3.2 | T2–T8 |
| K11 | Disabled: `navigation-ui.css:45` `.6` → `.5`. `kubernetes-dock.css:3` wird **gelöscht**, damit `button:disabled` (.45, `not-allowed`) aus `styles.css:18` greift. `.ctr-busy` (`containers-ui.css:8`) und `.is-other-shell` (`workflows-ui.css:12`) sind keine Disabled-Zustände und bleiben `.6`. | Plan 1.4, 3.2 | T3, T6 |
| K12 | Alias-**Nutzung** ist nach Welle 3 in allen CSS-Dateien außer `tokens.css` verboten (Regel R12). Alle Dateien werden in Stufe 1 umgestellt (Plan 0, 6.6), und kein TSX nutzt `var(--…)` (Grep: 0 Treffer). Die Aliase bleiben nach D2 **definiert**. | Grep `var(--` in `*.ts(x)` | T1–T8 |

---

## 3. Vertrag (präzisiert)

### 3.1 `src/renderer/src/tokens.css` – endgültig, wörtlich

```css
/* Single source for colour, size, layer and motion. Every other stylesheet uses var(--…) only. */
:root {
  color-scheme: dark;

  /* Surfaces */
  --color-bg-stage: #070b14;                  /* terminal, code, manifest */
  --color-bg-app: #090e17;                    /* window background, view bar */
  --color-bg-panel: #111925;                  /* bars, sidebar, dialogs, menus */
  --color-bg-raised: #182334;                 /* controls, row hover */
  --color-bg-hover: #233045;                  /* button hover, tab hover, "on" chips */
  --color-bg-input: #0b111c;
  --color-bg-selected: #183245;               /* persistent selection, aria-pressed */
  --color-bg-active: rgb(103 232 249 / 14%);  /* active view tab, menu item focus, badges */
  --color-bg-drop: rgb(103 232 249 / 22%);    /* single drop target (row, tab, pane) */
  --color-bg-tint: rgb(103 232 249 / 6%);     /* soft highlight (release box, whole drop area) */
  --color-overlay: rgb(255 255 255 / 8%);     /* neutral hover on dense rows, tags, hairlines */
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
  --color-danger: #fda4af;          /* text */
  --color-danger-strong: #fb7185;   /* dots, icons */
  --color-danger-text: #fecdd3;     /* text on danger surface */
  --color-danger-bg: #341c25;
  --color-danger-bg-hover: #512333;
  --color-danger-border: #713442;

  /* Spacing (stage 2 maps literals onto it) */
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
  --shadow-overlay: 0 10px 28px rgb(0 0 0 / 45%);
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

Prüfung der Datei:

- Jede Rolle aus Plan 2 hat einen Namen, und jeder Farbwert existiert im Bestand.
- Alle 18 Altnamen haben einen Alias, und jeder Alias zeigt auf einen definierten Token.
- Die drei Kurven stimmen zeichengenau mit `animate/SKILL.md:115-117` überein.
- Alle `--dur-*` liegen bei höchstens 200 ms, außer `--dur-pulse`.
- Die Ebenen sind streng aufsteigend, und `--layer-modal` (90) liegt über `--layer-header` (60), das behebt D7.

**Lade-Reihenfolge:** `styles.css` beginnt **als erste Anweisung** mit `@import './tokens.css';`, vor `:root`. Vite inlinet `@import` in Dev und Build (postcss-import). `main.tsx` bleibt unverändert. Komponenten-CSS steht im Bundle **vor** `styles.css`, weil `main.tsx:4` `App` vor `:6` `styles.css` importiert. Für Custom Properties und `@keyframes` spielt das keine Rolle. Folge für Selektoren: Overrides gegen Komponenten-CSS gehören nach `styles.css` (siehe B2). Kein Task legt `tokens.css` ein zweites Mal per `@import` an.

**Alias-Umbenennung (mechanisch, alle Dateien):**

| Alt | Neu |
|---|---|
| `--ui-bg` | `--color-bg-app` |
| `--ui-panel`, `--surface` | `--color-bg-panel` |
| `--ui-raised`, `--surface-raised` | `--color-bg-raised` |
| `--surface-hover` | `--color-bg-hover` |
| `--ui-border`, `--border` | `--color-border` |
| `--ui-text`, `--text` | `--color-text` |
| `--ui-muted`, `--text-muted` | `--color-text-muted` |
| `--ui-accent`, `--accent` | `--color-accent` |
| `--ui-danger` | `--color-danger` |
| `--ui-radius` | `--radius-md` |
| `--ui-control-height` | `--control-md` |
| `--ui-input-height` | `--control-lg` |

Jedes `var(--x, Fallback)` wird zu `var(<neuer Name>)`. Den Fallback-Wert verwirft man, auch wenn er abweicht, denn die Fallbacks waren tot.

### 3.2 Druck-Feedback (T1, `styles.css`, am Dateiende)

```css
/* Motion: opacity always, movement only without reduced motion. Gate: docs/design-system.md. */
.confirm-dialog[open], .confirm-dialog[open]::backdrop { transition: opacity var(--dur-modal) var(--ease-out); }
@starting-style { .confirm-dialog[open], .confirm-dialog[open]::backdrop { opacity: 0; } }
.file-drop-hint { transition: opacity var(--dur-hint) var(--ease-out); }
@starting-style { .file-drop-hint { opacity: 0; } }
@media (prefers-reduced-motion: no-preference) {
  button { transition: transform var(--dur-press) var(--ease-out); }
  /* Flat press targets (tabs, menu items, rows, links, chips, segments) stay still: wide surfaces would visibly shrink. */
  button:active:not(:disabled, [role='tab'], [role='menuitem'], .tree-toggle, .tree-node-button, .root-row, .welcome-list button,
    .kube-crumb, .kube-link, .kube-filter-chip, .kube-node, .kube-dock-format button, .link-button, .version-button,
    .connection-picker-option, .workspace-definition-actions button, .workspace-current-actions button,
    .pane-layout-menu button, .file-row-head button, .file-path nav button) { transform: scale(.97); }
  .confirm-dialog[open] { transition: opacity var(--dur-modal) var(--ease-out), transform var(--dur-modal) var(--ease-out); }
  .file-drop-hint { transition: opacity var(--dur-hint) var(--ease-out), transform var(--dur-hint) var(--ease-out); }
  @starting-style {
    .confirm-dialog[open] { transform: scale(.97); }
    .file-drop-hint { transform: translate(-50%, -8px); }
  }
}
```

- `[role='tab']` deckt `.terminal-tab` (`TerminalTabs.tsx:42,49`), `.view-tab button`, `.kube-kind` (`ResourceTable.tsx:112`, `ContainerView.tsx:264`) und `.kube-dock-tab` (`DetailDock.tsx:137`, `ContainerDock.tsx:178`) ab. Damit bleibt auch der Tab-Drag ohne Transform.
- Kollisionen gibt es keine. Kein Button trägt heute `transform` (Grep: nur `navigation-ui.css:11` am **svg** im ausgenommenen `.tree-toggle` und `styles.css:141` am **div** `.file-drop-hint`). Die Griffe `.split-handle`, `.sidebar-resize` und `.kube-dock-handle` sind `div[role=separator]`. `.terminal-panel`, `.rdp-surface` und `.kube-dock-terminal` enthalten keine Buttons als Vorfahren. Ein Transform ändert kein Layout, löst also keinen xterm-Fit und kein Verschieben der nativen RDP-Fläche aus. Die Dock-Buttons `.kube-dock-popout`, `.kube-dock-toggle` und `.kube-dock-copy` dürfen drücken.
- Der Dialog hat **im Endzustand kein `transform`** (nur `@starting-style` setzt `scale(.97)`). Es entsteht also kein dauerhafter Containing Block für fixierte Kinder. `transform-origin` bleibt der Standard `center` (Modal-Ausnahme).
- Die Workflow-Palette (`WorkflowPalette.tsx:52`) hat kein `.confirm-dialog` und bleibt ohne Motion. Alle anderen `<dialog>` haben es: `AiSettingsDialog.tsx:64`, `ConfirmDialog.tsx:31`, `ContainerConfirm.tsx:34`, `FilesPanel.tsx:300`, `ConfirmAction.tsx:62`, `PermissionsDialog.tsx:35`, `ReleaseNotes.tsx:34`, `WorkflowsDialog.tsx:45`.
- `.file-drop-hint` ist bedingt gerendert (`App.tsx:250`) und flackert nicht, weil `dragleave` nur ohne `relatedTarget` greift (`:221`). Der Grund-Transform `translateX(-50%)` aus `styles.css:141` bleibt Geometrie und gilt auch bei `reduce`.

### 3.3 Picker und Layout-Menü (T2)

`terminal-ui.css` (ersetzt `:56` und ergänzt `:35`, `:55`):

```css
.connection-picker:popover-open { display: flex; flex-direction: column; gap: 6px; transition: opacity var(--dur-popover) var(--ease-out); }
@starting-style { .connection-picker:popover-open { opacity: 0; } }
/* .pane-layout-menu keeps its existing declarations and additionally gets: */
/*   box-shadow: var(--shadow-overlay); transform-origin: top right; transition: opacity var(--dur-popover) var(--ease-out); */
@starting-style { .pane-layout-menu { opacity: 0; } }
@media (prefers-reduced-motion: no-preference) {
  .connection-picker:popover-open, .pane-layout-menu { transition: opacity var(--dur-popover) var(--ease-out), transform var(--dur-popover) var(--ease-out); }
  @starting-style { .connection-picker:popover-open, .pane-layout-menu { transform: scale(.97); } }
}
```

Kein Exit (K3), keine Transition auf dem geschlossenen Zustand, kein `overlay` und kein `display`. `.pane-layout-menu` ist bedingt gerendert (`SplitTerminalArea.tsx:369`), der Auslöser ist der letzte Knopf rechts im Pane-Kopf (`:364-366`), daher `top right`.

`ConnectionPicker.tsx:41-47` wird wörtlich so (einzige TSX-Änderung, D8):

```ts
    const height = Math.min(360, downward ? below : above);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    Object.assign(popover.current.style, {
      width: `${width}px`, maxHeight: `${height}px`,
      left: `${left}px`,
      top: downward ? `${rect.bottom + 6}px` : 'auto',
      bottom: downward ? 'auto' : `${window.innerHeight - rect.top + 6}px`,
      // Scale in from the trigger: its centre on the edge that faces it.
      transformOrigin: `${Math.round(rect.left + rect.width / 2 - left)}px ${downward ? 'top' : 'bottom'}`,
    });
```

### 3.4 Workspace-Menü, Puls und Ausschlüsse (T3, T6, T7)

`navigation-ui.css` (T3, nach `:38` einfügen):

```css
/* Opened by click only; content stays mounted inside <details>, so a keyframe (not @starting-style) starts reliably on [open]. */
.workspace-menu[open] > .workspace-menu-content { animation: workspace-menu-fade var(--dur-popover) var(--ease-out); }
@media (prefers-reduced-motion: no-preference) { .workspace-menu[open] > .workspace-menu-content { animation-name: workspace-menu-in; } }
@keyframes workspace-menu-fade { from { opacity: 0; } }
@keyframes workspace-menu-in { from { opacity: 0; transform: translateY(-4px); } }
```

Vor `:42` steht der Kommentar `/* No motion: opened by right click, Shift+F10 and the menu key (gate). */`.

Puls in `navigation-ui.css:65` und `assistant-ui.css:25`: `animation: tm-pulse var(--dur-pulse) var(--ease-in-out) infinite;`. Die Keyframes `container-pulse` (`navigation-ui.css:66`) und `assistant-pulse` (`assistant-ui.css:26`) werden gelöscht. Die bestehenden `reduce`-Regeln (`navigation-ui.css:67`, `assistant-ui.css:27`) bleiben.

Diese Kommentare sind Pflicht, Code-Kommentare auf Englisch:

| Datei | Wo | Kommentar |
|---|---|---|
| `kubernetes-ui.css` | vor `:108` | `/* No motion: the help overlay opens with "?" (gate). Layer sits above the app header. */` |
| `workflows-ui.css` | vor `:2` | `/* No motion: the palette opens with Ctrl+Shift+Space (gate). */` |

### 3.5 Verbot für Bühnen-Flächen

`.terminal-panel`, `.terminal-container`, `.split-terminal-stage`, `.rdp-surface` und `.kube-dock-terminal` bekommen weder `transform` noch `transition`, `animation`, `filter` oder `will-change`. Regel R13 prüft das.

### 3.6 Lint-Test `src/renderer/src/design-tokens.test.ts`

**Rahmen (bindend, T1):**

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const FILES = readdirSync(ROOT, { recursive: true }).map(String).map(file => file.split(/[\\/]/).join('/'))
  .filter(file => file.endsWith('.css')).sort();
// Wave 1 only; T8 removes MIGRATED and ALL so that every file is checked.
const MIGRATED = ['tokens.css', 'styles.css'];
const ALL = process.env.DESIGN_LINT_ALL === '1';
```

Pro Datei gibt es ein `it(file, …)`, in Welle 1 und 2 mit `it.skipIf(!ALL && !MIGRATED.includes(file))`. Das `expect` liefert die Liste der Verstöße als `string[]`, erwartet ist `[]`, damit die Meldung Datei, Selektor und Deklaration nennt. Der Typecheck läuft über `tsconfig.web.json` (ohne `types`-Einschränkung, also mit `@types/node` wie `src/shared/version.test.ts`). Der Rahmen wurde mit `tsc --strict` geprüft. `readdirSync(…, { recursive: true })` liefert `string[] | Buffer[]`, deshalb steht dort `.map(String)`.

**Tokenizer (bindend):**

1. BOM entfernen (`editor-ui.css` hat eins) und Kommentare mit `/\/\*[\s\S]*?\*\//g` streichen.
2. Zeichen für Zeichen mit einem Stack laufen:
   - Bei `{` den Prelude (Text seit dem letzten `{`, `}` oder einem `;` auf oberster Ebene) pushen.
   - Bei `}` poppen. Enthält der Blockinhalt kein `{`, ist es ein Deklarationsblock `{ selector: prelude, ancestors: Preludes des Stacks, declarations }`.
   - Deklarationen werden an `;` getrennt, dann am **ersten** `:`, die Eigenschaft wird kleingeschrieben.
3. Unbalancierte Klammern werfen einen Fehler.

Keyframe-Schritte (`50%`, `from`) sind normale Blöcke mit dem Vorfahren `@keyframes …`.

**Regeln** (`T` = gilt nicht für `tokens.css`; `MOTION` = Eigenschaft passt auf `/^(transition|animation)(-|$)/`):

| ID | Regel |
|---|---|
| R0 | `FILES` enthält mindestens diese elf Pfade: `tokens.css`, `styles.css`, `terminal-ui.css`, `files-ui.css`, `assistant-ui.css`, `workflows-ui.css`, `kubernetes-ui.css`, `kubernetes-dock.css`, `containers-ui.css`, `components/navigation-ui.css`, `components/editor-ui.css`. |
| R1 (T) | Kein Wert passt auf `/#[0-9a-f]{3,8}\b/i` oder `/\b(?:rgba?\|hsla?\|hwb\|lab\|lch\|oklab\|oklch\|color-mix)\(/i`. Kein Wert passt auf `/var\(\s*--[\w-]+\s*,/` (Fallback). Nur Werte werden geprüft, deshalb treffen ID-Selektoren und `url(#…)` in Selektoren nicht. |
| R2 | `transition` und `transition-property` enthalten kein `/(?<![-\w])all(?![-\w])/`. |
| R3 | Ein MOTION-Wert enthält kein `/(?<![-\w])(?:ease\|ease-in\|ease-out\|ease-in-out\|step-start\|step-end)(?![-\w])/`. Außerdem (T) enthält kein Wert `cubic-bezier(` oder `steps(`. `linear` ist erlaubt, `var(--ease-out)` trifft nicht. |
| R4 | (T) Ein MOTION-Wert enthält keine Dauer `/(?<![\w.-])(?:\d+\.?\d*\|\.\d+)m?s(?![\w-])/`. In `tokens.css` passt jedes `--dur-*` auf `/^(\d+)ms$/` und ist höchstens 300, außer `--dur-pulse`. |
| R5 | Kein Wert enthält `/\bscale(?:X\|Y\|Z\|3d)?\(\s*0\s*[,)]/`. `scale(.97)` und `scale(0.97)` treffen nicht. |
| R6 | (T) `z-index` passt nicht auf `/^-?\d+$/`. Erlaubt sind `var(--layer-*)`, `calc(var(--layer-*) + n)` und `auto`. |
| R7 | Enthält eine Datei eine MOTION-Deklaration mit einem Wert ungleich `none`, enthält ihr Text `prefers-reduced-motion`. |
| R7b | Diese Deklarationen brauchen einen Vorfahren, der `/prefers-reduced-motion:\s*no-preference/` erfüllt: (a) `transform`, `translate`, `scale` oder `rotate` mit einem Wert ungleich `none` in einem Block mit dem Vorfahren `@starting-style` oder mit `:active` im Selektor, (b) jeder MOTION-Wert, der `transform` enthält. |
| R8 | Ein Block mit `:hover` im Selektor und einer Deklaration `transform`, `translate`, `scale`, `rotate` oder MOTION braucht einen Vorfahren, der `/\(hover:\s*hover\)/` erfüllt. Der Vergleich ist exakt, `text-transform` trifft also nicht. |
| R9 | `tokens.css` deklariert exakt `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` und `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`, dazu alle 18 Aliasnamen aus 3.1, alle `--color-*`-Namen aus 3.1 und `@keyframes tm-pulse`. Bei den Ebenen gilt `header < popover < menu < modal < toast`. |
| R10 | Der getrimmte, kommentarfreie Text von `styles.css` beginnt mit `@import './tokens.css';`. Keine andere Datei enthält `@import`. |
| R11 | (T) Keine Deklaration einer Custom Property (`property.startsWith('--')`). |
| R12 | (T) Kein Wert passt auf `/var\(\s*--(?:ui-[\w-]+\|surface(?:-raised\|-hover)?\|border\|text\|text-muted\|accent)\s*\)/`. |
| R13 | Ein Selektor mit `.terminal-panel`, `.terminal-container`, `.split-terminal-stage`, `.rdp-surface` oder `.kube-dock-terminal` deklariert weder `transform`, `transition*`, `animation*`, `filter` noch `will-change`. |

**Selbsttest (Pflicht, T1):** Ein `it('flags every rule')` lintet einen Fixture-String unter dem Namen `fixture.css`. Er enthält je einen Verstoß gegen R1, R1-Fallback, R2, R3, R4, R5, R6, R7, R7b, R8, R11, R12 und R13, und der Test erwartet jede ID im Ergebnis. Dazu kommt eine Negativ-Fixture, die 0 Treffer liefern muss:

```css
.release-notes-dialog { text-transform: uppercase; color: var(--color-text); }
#add { color: var(--color-accent); }
.x { transition: width var(--dur-fade) linear; z-index: calc(var(--layer-chrome) + 5); }
@media (prefers-reduced-motion: no-preference) {
  .y:active { transform: scale(.97); }
}
```

Jeder Verstoß ist ein String `"<Datei> <Regel> <Selektor> { <Eigenschaft>: <Wert> }"`. Die Regel-IDs dienen als Präfix für die Filterung in B4.

### 3.7 Zustandsmatrix Stufe 1 (ersetzt Plan 3.2)

| Zustand | Regel in Stufe 1 |
|---|---|
| Hover Button (alle, auch Tabs, Chips und Picker-Option) | `--color-bg-hover` plus `--color-border-strong` (global `styles.css:17`), ohne Transition |
| Hover Menüeintrag `[role=menuitem]` | `--color-bg-active` (`navigation-ui.css:44`) |
| Hover Zeile | Baum und Kube-Tabelle `--color-bg-raised`; Dateizeile `--color-overlay` |
| Aktiv/an | View-Tab `--color-bg-active`; Kube-Art, Chip und Dock-Tab `--color-bg-hover` + `--color-border-strong` + Akzenttext; Terminal-Tab `--color-bg-stage` + `--color-border-strong` + Akzent-Unterkante (alles Bestand, nur gefaltet) |
| Ausgewählt (dauerhaft) | `--color-bg-selected`; Cursor `box-shadow: var(--focus-inset)` |
| Gedrückt (`aria-pressed`) | Icon-Wahl: Rand `--color-accent` + `--color-bg-selected`. `.assistant-toggle` bekommt zusätzlich `background: var(--color-bg-selected)`. `.root-row` hat nur `--color-bg-selected` (Auswahlzeile). Der Dock-Format-Umschalter behält `--color-accent` + `--color-on-accent`. |
| Drop-Ziel | einzelnes Ziel (Zeile, Tab, Pane-Vorschau, Ordner) `--color-bg-drop`; ganze Fläche (Dateiliste) `--color-bg-tint` + Akzent-Inset |
| Disabled | `.45` global; Menüeintrag und deaktivierte Baumzeile `.5` (K11) |
| Fokus | `outline: var(--focus-outline); outline-offset: var(--focus-offset)`; Listen `var(--focus-inset)`; Split-Griff und View-Drop `outline-offset: -2px` (bleibt) |
| Druck | 3.2 |

---

## 4. Faltung pro Datei (abschließend)

Die Alias-Umbenennung aus 3.1 gilt überall und ist hier nicht wiederholt. Aufgeführt sind nur Literale, Fallbacks, Ebenen, Radien, Schrift und Ergänzungen.

Für Geometrie gilt E1: Höhen, Breiten, Abstände, Schriftgrößen und Zeilenhöhen **bleiben literal**, auch wenn sie einem Skalenwert entsprechen.

### `styles.css` (T1)

| Zeile | Neu |
|---|---|
| 1 | Neue erste Zeile `@import './tokens.css';`. |
| 2–7 | Werden gelöscht, die Tokens wandern nach `tokens.css`. |
| 8 | Wird zu `font: 13px/1.45 var(--font-ui)`. |
| 9 | Bleibt mit neuen Namen. |

Weitere Zeilen:

- **17** `var(--color-bg-hover)`, `var(--color-border-strong)`
- **19** `outline: var(--focus-outline); outline-offset: var(--focus-offset)`
- **20** `background: var(--color-bg-input)`
- **25** `var(--color-selection-bg)`, `var(--color-selection-text)`
- **28** `scrollbar-color: var(--color-border-strong) transparent`
- **36** `color: var(--color-on-accent)`
- **37** `var(--color-on-accent)`, `var(--color-accent-hover)` ×2
- **39** `var(--color-danger-bg)`, `var(--color-danger-text)`, `var(--color-danger-border)`
- **40** `var(--color-danger-bg-hover)`
- **45** danger-text/-bg/-border, `border-radius: var(--radius-md)`
- **47** `var(--color-backdrop)`
- **50, 130** `border-radius: var(--radius-lg)`
- **64** `z-index: var(--layer-header)`
- **72** `z-index: var(--layer-handle)`
- **73** `var(--color-bg-active)`
- **76** `border-radius: var(--radius-sm)`
- **78** `var(--color-bg-selected)`
- **83** `var(--color-bg-stage)`
- **88** `z-index: var(--layer-sticky)`
- **92** danger-text/-bg, `border-top: 1px solid var(--color-danger-border)`
- **102** `z-index: var(--layer-drag)`
- **126** `border: 1px solid var(--color-border-strong)`; `background: var(--color-bg-tint)`
- **141** `z-index: var(--layer-toast)`; `box-shadow: var(--shadow-overlay)`

Am Ende kommt der Motion-Block aus 3.2.

### `terminal-ui.css` (T2, dazu `components/ConnectionPicker.tsx`)

- **3, 28, 66** `var(--color-bg-stage)`
- **5** `var(--color-bg-panel)`, `var(--color-border)`
- **6** `var(--color-bg-raised)`
- **8, 24, 35, 72, 73, 77** `border-radius: var(--radius-sm)`
- **9** `background: var(--color-bg-stage); border-color: var(--color-border-strong)`
- **11, 19, 27, 34, 37, 53** `var(--color-text-muted)`
- **12, 13, 22, 52, 75, 78** `var(--color-text)`
- **15** `var(--color-text-muted)`
- **16** `var(--color-ok)`
- **17** `var(--color-warn)`
- **18** `var(--color-danger-strong)`
- **20** `border-radius: var(--radius-sm)`
- **21** `background: var(--color-border-strong)`
- **22** `var(--color-bg-hover)`
- **35** zusätzlich `z-index: calc(var(--layer-chrome) + 5)`, Schatten und Motion aus 3.3
- **36** `z-index: var(--layer-chrome)`
- **40** `z-index: var(--layer-handle)`
- **41** `var(--color-border)`
- **46** `var(--color-accent)`
- **50** `z-index: calc(var(--layer-drag) + 1)`
- **51** `z-index: var(--layer-drag); border: 2px solid var(--color-accent); background: var(--color-bg-drop)` (K5)
- **52** `background: var(--color-bg-panel)`
- **54** `border-color: var(--color-text-muted); background: var(--color-backdrop)` (B3)
- **55** `border-radius: var(--radius-md)`; `box-shadow: var(--shadow-overlay)`
- **56** wird durch 3.3 ersetzt
- **67** `var(--color-text-muted)`
- **71** `background: var(--color-bg-app); border-bottom: 1px solid var(--color-border)`
- **74** `border-radius: var(--radius-pill); background: var(--color-overlay)`
- **75** `background: var(--color-bg-active)`
- **76** `outline: 2px solid var(--color-accent); background: var(--color-bg-drop)`
- **78** `background: var(--color-overlay)`

Im TSX nur 3.3.

### `components/navigation-ui.css` (T3)

- **4, 43, 57** `border-radius: var(--radius-sm)`
- **6** `var(--color-bg-selected)`
- **27** `border-radius: var(--radius-md)`
- **32** `z-index: var(--layer-popover); border-radius: var(--radius-md); box-shadow: var(--shadow-overlay)`
- **42** `z-index: var(--layer-menu); box-shadow: var(--shadow-overlay)`, dazu der Kommentar aus 3.4
- **44** `background: var(--color-bg-active)`
- **45** `opacity: .5` (K11)
- **54** `background: var(--color-bg-drop); box-shadow: inset 0 0 0 1px var(--color-accent)` (B3)
- **57** `box-shadow: inset 0 0 0 1px var(--color-accent)`
- **63** `var(--color-ok)`
- **64** `var(--color-warn)`
- **65–67** wie in 3.4

Der Workspace-Block kommt aus 3.4. `:11` (`rotate`) und `:18-19` (Opazität ohne Transition) bleiben unverändert.

### `components/editor-ui.css` (T4)

- **5, 28, 32, 40, 48** `border-radius: var(--radius-md)`
- **14** `var(--color-bg-selected)`
- **21–24, 29–31, 35, 46** Fallbacks entfallen, also `var(--color-border)`, `-text-muted`, `-text`, `-accent`, `-danger`, `-bg-panel`
- **24** `outline: var(--focus-outline); outline-offset: var(--focus-offset); border-radius: var(--radius-sm)`
- **31** `z-index: var(--layer-sticky)`
- **36** `border-radius: var(--radius-lg)`
- **49, 54** `var(--color-ok)`

### `files-ui.css` (T5)

- **12, 19** `border-radius: var(--radius-sm)`
- **22, 57, 107** `font-family: var(--font-mono)`
- **30** `color: var(--color-danger); background: var(--color-danger-bg); border-bottom: 1px solid var(--color-danger-border)`
- **37, 44** `box-shadow: var(--focus-inset)`
- **38** `box-shadow: inset 0 0 0 2px var(--color-accent); background: var(--color-bg-tint)`
- **42** `var(--color-overlay)`
- **43** `background: var(--color-bg-selected)`
- **45** `background: var(--color-bg-drop)`
- **47** `z-index: var(--layer-sticky)`
- **70** `border-top: 1px solid var(--color-overlay)`
- **78** `2px` bleibt (Fortschrittsbalken)
- **80** `transition: width var(--dur-fade) linear` (geduldet, Plan 1.5)
- **82, 99** `var(--color-ok)`
- **87** `border-radius: var(--radius-lg)`

### `kubernetes-ui.css`, `kubernetes-dock.css`, `containers-ui.css` (T6)

**`kubernetes-ui.css`:**

- **8, 44** `var(--color-ok)`
- **9, 12** `var(--color-warn)`
- **19** `border-radius: var(--radius-pill)`
- **20** `background: var(--color-danger-bg); border-color: var(--color-danger-border)`
- **39** `border-radius: var(--radius-md)`
- **40** `var(--color-warn-border)`
- **41** `var(--color-danger-border)`
- **47, 122** `border-radius: var(--radius-sm)`
- **52** `background: var(--color-danger-bg); border-bottom: 1px solid var(--color-danger-border)`
- **55** `var(--color-accent-hover)`
- **61, 65** `border-color: var(--color-border-strong); background: var(--color-bg-hover)`
- **76** `font: 12px/24px var(--font-mono)`
- **78** `z-index: var(--layer-sticky)`
- **84** `var(--color-bg-selected)`
- **91, 95** `var(--color-bg-hover)`
- **104** `background: var(--color-bg-stage); color: var(--color-text-code); font: 12px/1.45 var(--font-mono)`
- **108** `z-index: var(--layer-modal); background: var(--color-backdrop)`, dazu der Kommentar aus 3.4
- **109** `border-radius: var(--radius-lg)`
- **120** `font-family: var(--font-mono)`

**`kubernetes-dock.css`:**

- **3** wird gelöscht (K11)
- **6** `border-radius: var(--radius-sm) 0 0 var(--radius-sm)`
- **7** `border-radius: 0 var(--radius-sm) var(--radius-sm) 0`
- **8** `background: var(--color-accent); color: var(--color-on-accent)`

**`containers-ui.css`:** keine Änderung. Prüfen, dass der Lint grün ist.

### `assistant-ui.css`, `workflows-ui.css` (T7)

**`assistant-ui.css`:**

- **6** `border-radius: var(--radius-sm)`
- **16** `border-radius: var(--radius-lg) var(--radius-lg) 2px var(--radius-lg); background: var(--color-bg-active)`
- **19** `border-radius: var(--radius-md); background: var(--color-bg-stage)`
- **21** `font-family: var(--font-mono); color: var(--color-text-code)`
- **25–27** wie in 3.4
- **29** `border: 1px dashed var(--color-border-strong); border-radius: var(--radius-md)`
- **36** zusätzlich `background: var(--color-bg-selected)`
- **39** `border-radius: var(--radius-lg)`
- **44** `border-radius: var(--radius-md)`
- **54** `var(--color-ok)`

**`workflows-ui.css`:**

- **3, 30** `border-radius: var(--radius-lg)`
- **5** `var(--color-backdrop)`
- **10, 25** `border-radius: var(--radius-md)`
- **11, 18** `var(--color-bg-active)`
- **13** `font-family: var(--font-mono)`
- **14** `var(--color-text-code)`
- **17** `border-radius: var(--radius-pill)`
- **19** `background: var(--color-overlay)`
- **25** `background: var(--color-bg-stage); color: var(--color-text-code)`

Dazu der Kommentar aus 3.4.

---

## 5. Entscheidungen (Rulings dieser Validierung)

| # | Entscheidung | Warum |
|---|---|---|
| E1 | Geometrie bleibt in Stufe 1 literal, das ersetzt die letzte Zeile von Plan 3.1. Nur die bisherigen `var(--ui-control-height)` und `var(--ui-input-height)` werden umbenannt. Radien werden nach Abschnitt 4 gefaltet (3→4, 6→5, 9 bzw. Pillen-8→pill, ohne Layoutwirkung). Die Mono-Schrift wird auf `--font-mono` vereinheitlicht. | D6. Parallele Umsetzer würden sonst unterschiedlich entscheiden, was eine „Control-Höhe“ ist. |
| E2 | Ein einzelnes Drop-Ziel bekommt 22 % (`--color-bg-drop`), eine ganze Ablagefläche 6 % (`--color-bg-tint`). | Plan 2 und 3.1 werden so vereinbar. |
| E3 | Cyan-Ränder: Release-Box und Assistent-Status gehen auf `--color-border-strong`, Drop-Wurzel auf `--color-accent`, Datei-Cursor auf `--focus-inset`. | B3, „Cyan ist Signal“: Deko-Ränder werden neutral. |
| E4 | Erlaubte Farbausnahmen außerhalb von CSS: `ConnectionIcon.tsx:17` (vom Nutzer gewählte Verbindungsfarbe, Daten), `ConnectionForm.tsx:136` (Startwert `#a7b7cb` für `input[type=color]`, braucht Hex, entspricht `--color-text-muted`), `TerminalPanel.tsx:51` (xterm-Theme, D8). Sie bleiben unverändert und stehen in `docs/design-system.md`. Andere Farb-Inline-Styles gibt es nicht (Grep aller `style=`: nur Geometrie). | D8 |
| E5 | Muster für Reduced Motion: Die Opazitäts-Transition steht außerhalb, alles mit `transform` innerhalb von `@media (prefers-reduced-motion: no-preference)`. Bei `reduce` bleibt nur das Einblenden, der Druck entfällt ganz. | D5. R7b prüft das. |
| E6 | Die schmale Seitenleiste (`styles.css:102`, 45) liegt auf `--layer-drag`. Der Wert bleibt gleich, die Reihenfolge zu Vorschau und Marker (45/46) ebenfalls. | keine Verhaltensänderung |
| E7 | Die Kube- und Container-Hilfe liegt jetzt über dem App-Kopf. Ein Klick auf den Kopf schließt sie (`onMouseDown` auf dem Backdrop, `HelpOverlay.tsx:53`, `ContainerHelp.tsx:51`), statt dort etwas auszulösen. | gewollt (Plan 6.4) |
| E8 | Beim Picker gibt es keinen Exit und kein `overlay`/`allow-discrete` (K3). Der Plan-Risikopunkt zu `overlay` entfällt damit. | K3 |
| E9 | Die Aliase bleiben definiert (D2), ihre Nutzung in CSS ist nach Welle 3 verboten (K12). | D2, Vollständigkeit |
| E10 | Benannte Farben (`red`, `white` …) prüft der Lint nicht. Heute gibt es 0 Treffer, die Doku verbietet sie. | Aufwand gegen Nutzen |

---

## 6. Wellen (endgültig, disjunkt)

| Welle | Task | Dateien (nur diese) | Inhalt |
|---|---|---|---|
| 1 | **T1** | `src/renderer/src/tokens.css` (neu), `src/renderer/src/styles.css`, `src/renderer/src/design-tokens.test.ts` (neu) | 3.1, 3.2, Abschnitt 4 `styles.css`, Test nach 3.6 mit `MIGRATED`, `DESIGN_LINT_ALL` und Selbsttest |
| 2 | **T2** | `src/renderer/src/terminal-ui.css`, `src/renderer/src/components/ConnectionPicker.tsx` | Abschnitt 4 und 3.3 |
| 2 | **T3** | `src/renderer/src/components/navigation-ui.css` | Abschnitt 4 und 3.4 |
| 2 | **T4** | `src/renderer/src/components/editor-ui.css` | Abschnitt 4 |
| 2 | **T5** | `src/renderer/src/files-ui.css` | Abschnitt 4 |
| 2 | **T6** | `src/renderer/src/kubernetes-ui.css`, `src/renderer/src/kubernetes-dock.css`, `src/renderer/src/containers-ui.css` | Abschnitt 4 und 3.4 |
| 2 | **T7** | `src/renderer/src/assistant-ui.css`, `src/renderer/src/workflows-ui.css` | Abschnitt 4 und 3.4 |
| 3 | **T8** | `src/renderer/src/design-tokens.test.ts`, `docs/design-system.md` (neu), `README.md`, `CHANGELOG.md` | `MIGRATED`, `ALL` und `skipIf` entfallen, alle Dateien werden geprüft. Dazu Doku und die Texte unten. |

Gate nach jeder Welle: `npm run typecheck` und `npx vitest run`, beide grün. In Welle 2 kommt die Selbstprüfung aus B4 dazu. Es gibt keine Main-, Preload-, Shared- oder `package.json`-Änderung und keine neue Abhängigkeit. Die Version bleibt 0.9.0.

**`README.md` (T8):** Ein neuer Abschnitt steht direkt nach dem Codeblock von „## Qualität prüfen“, wörtlich:

```markdown
## Designsystem

Farben, Radien, Ebenen, Schatten und Bewegung kommen aus einer Datei: `src/renderer/src/tokens.css`. Die Regeln für neue Oberflächen stehen in [`docs/design-system.md`](docs/design-system.md). Der Test `src/renderer/src/design-tokens.test.ts` prüft alle CSS-Dateien auf harte Farben, eingebaute Easings, feste Dauern und z-index-Werte sowie auf Bewegung ohne `prefers-reduced-motion`.
```

**`CHANGELOG.md` (T8):** Neuer **letzter** Punkt unter `## [0.9.0] – 2026-10-18`, wörtlich, eine Zeile:

```markdown
- Einheitliches Erscheinungsbild: Farben, Schatten und Ebenen kommen aus einem gemeinsamen Designsystem. Dialoge, der Verbindungs-Picker sowie das Workspace- und das Layout-Menü blenden kurz ein, Buttons geben beim Klicken leicht nach. Sind die Windows-Animationseffekte ausgeschaltet, bleibt nur das Einblenden. Die Hilfe in Cluster- und Container-Ansicht liegt jetzt über der Kopfzeile.
```

**`docs/design-system.md` (T8)**, Deutsch, mit genau diesen Überschriften:

- `# Terminus-Designsystem`
- `## Roter Faden` (Plan 2, Punkte 1–7, mit den Werten aus 3.1)
- `## Tokens` (Tabellen je Präfix: Name, Rolle, Wert, Beispiel)
- `## Zustände` (Matrix 3.7)
- `## Motion-Gate` (Plan-Tabelle 4 mit den Korrekturen K3, K4 und B1, dazu die Ausnahmeliste aus 3.2)
- `## Regeln für neues CSS` (Plan 5, zweiter Punkt, dazu E4, E10 und 3.5)
- `## Prüfung` (Regeln R0–R13 in einem Satz je Regel, Feel-Check)

Electron wird ohne Chromium-Versionsnummer genannt (K8).

---

## 7. Testpflichten

| Task | Pflicht |
|---|---|
| T1 | Der Test besteht für `tokens.css` und `styles.css`. Der Selbsttest weist jede Regel-ID nach, die Negativ-Fixture liefert 0 Treffer. Mit `DESIGN_LINT_ALL=1` schlagen nur die noch nicht umgestellten Dateien fehl, Regel-IDs stehen in der Meldung. `npm run typecheck` ist grün. |
| T2–T7 | Selbstprüfung nach B4: 0 Verstöße in den eigenen Dateien. `npx vitest run` und `npm run typecheck` sind grün. Jeder Task meldet die Vorher/Nachher-Werte seiner geänderten Farben (Plan 6.4). |
| T2 | `ConnectionPicker.tsx` ändert sich nur in `:41-47` nach 3.3. Bestehende Picker-Tests (falls vorhanden) bleiben unverändert grün. |
| T8 | Ohne Schalter sind alle elf Dateien geprüft und grün. `version.test.ts` ist grün (erster Eintrag 0.9.0, mehr Punkte). Ein Grep über `src/renderer/src/**/*.css` außer `tokens.css` findet 0 Hex-, `rgb(`- und `var(--x,`-Treffer. |

---

## 8. Manuelle Abnahme (`npm run dev`)

1. **Bereiche:** Seitenleiste (Baum, Drag in Ordner mit 22 %-Fläche, schmal unter 700 px), Terminal-Tabs (Status-Punkte: Gelb ist jetzt `#fcd34d`), geteilte Ansicht (Tab ziehen: Vorschau durchscheinend cyan, gesperrt abgedunkelt), View-Leiste, Dateien (Hover, Auswahl jetzt opak `#183245`, Cursorrahmen voll cyan, Drop, Transfer-Balken), Cluster (Tabelle mit Cascadia Mono, Chips, Banner, Dock, YAML), Container (Docker/Podman), Assistent, alle Bestätigungsdialoge (Löschen mit Namenseingabe unverändert), Workflow-Palette (sofort, Backdrop dunkler), Verbindungs-Picker, Workspace- und Layout-Menü.
2. **Fehler D7:** Die Hilfe (`?`) in Cluster und Container dunkelt den App-Kopf mit ab. Ein Klick auf den Kopf schließt die Hilfe.
3. **Feel-Check:** Im DevTools-Animations-Panel bei fünffacher Dauer:
   - Der Dialog skaliert aus der Mitte.
   - Der Picker wächst aus dem „+“-Knopf, nach unten von oben, bei wenig Platz nach oben von unten.
   - Das Layout-Menü wächst von oben rechts.
   - Das Workspace-Menü gleitet 4 px herab, bei jedem Öffnen, nicht nur beim ersten (B1).
   - Der Drop-Hinweis kommt von oben.
4. **Druck:** `.icon-button` (32 px) und `.primary-button` geben sichtbar, aber nicht wackelig nach. Tabs, Kontextmenü-Einträge, Baumzeilen, Chips, Node-Kacheln, Segment-Umschalter, Welcome-Liste und Menü-Buttons bewegen sich **nicht**. Tab-Drag und Griffe verhalten sich unverändert.
5. **Reduced Motion:** In DevTools `prefers-reduced-motion: reduce` emulieren. Dialog, Picker und Menüs blenden nur ein, Buttons drücken nicht, der Puls steht.
6. **Sofort ohne Animation:** Kontextmenü (auch `Shift+F10`), Palette (`Strg+Umschalt+Leertaste`), Hilfe (`?`), Dock (`Strg+J`), Seitenleiste, Tabs und Hover-Farben.
7. **RDP:** Bei offener RDP-Sitzung öffnen und schließen sich Picker und Layout-Menü ohne Restbild. Die native Fläche sitzt nach Druck auf Pane-Buttons pixelgenau.

## 9. Sicherheit

- Es gibt keine Änderung an Main, Preload und Shared und keinen IPC.
- Die kubeconfig, Secrets und Exec-Pfade sind nicht berührt.
- Die Bestätigungsdialoge behalten DOM, Texte und Fokuslogik. Die Animation ändert weder Hit-Testing noch Fokus. Die Namenseingabe beim Entfernen bleibt die Hürde.
- Die Chips „Nur lesen“ und „Produktion“ behalten ihre Klassen und werden nur gefaltet (`kubernetes-ui.css:19-20`).
- Kein neues Klick-Ziel löst eine Aktion aus.
