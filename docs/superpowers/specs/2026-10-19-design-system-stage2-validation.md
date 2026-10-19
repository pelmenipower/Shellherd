# Designsystem Stufe 2 – Validierung

Stand: 2026-10-19 · Branch `claude/feature/design-system-stage2` (HEAD `9ef2244`) · Prüfer: Opus · Version bleibt 0.9.0

Geprüft: Spec `2026-10-19-design-system-stage2-design.md` (S1–S5, Z1–Z3), Plan `docs/superpowers/plans/2026-10-19-design-system-stage2.md`, `docs/design-system.md`, `tokens.css`, `design-tokens.test.ts`, Validierung Stufe 1, Skills `animate` und `emil-design-eng`. Baseline auf HEAD: `npm run typecheck` grün, `npx vitest run` 84 Dateien / 1215 Tests grün.

Eigene Messungen: Ein Scratch-Lint mit R14–R16 nach Plan 3.4 über alle elf Stylesheets und die Electron-Probe (`…\scratchpad\layout-probe\val.cjs`, `val2.cjs`, `val3.cjs`, echtes CSS mit Stufe-2-Tokens, Reduced Motion per CDP).

**Dieser Anhang ist bindend und geht Spec und Plan vor.**

## Urteil

**ready after corrections** · 4 Blocker · 11 Korrekturen · 5 Entscheidungen

Die Faltungstabellen sind vollständig. Der Scratch-Lint findet heute 580 Treffer. Jeder Off-Scale-Wert davon (91 Zeilen) steht in Plan 3.3, alle übrigen folgen 3.2. Die Kopplungen bleiben wertgleich: Pane-Kopf 32 (`terminal-ui.css:5,7,19,33,35,50` ↔ `SplitTerminalArea.tsx:209,226,395`), `ROW_HEIGHT` 24 (`kubernetes-ui.css:76-78,131,133,135`), Seitenleiste 44/24 (`styles.css:97`). Der Dock hat seine Höhe aus dem TSX (`DetailDock.tsx:130`), die Leiste +2 kostet nur den Dock-Körper. RDP und xterm messen per `ResizeObserver`/`getBoundingClientRect`. Keine Faltung verschiebt die Bühne, ohne ihre Größe zu ändern. Die Aliase sind in CSS, TS/TSX, Inline-Styles und `index.html` ungenutzt (0 Treffer). Die Wellen sind disjunkt.

Gebrochen sind: die Statusleiste durch den Versionsknopf (B1), der Typecheck durch `xtermTheme` (B2), das Welle-1-Gate durch `.app-error` (B3) und die Testpflicht von T9 (B4).

---

## 1. Blocker (mit Fix, bindend)

### B1 – Versionsknopf 24 macht die Statusleiste 25 hoch

`styles.css:132` `.version-button height: 20px` → `var(--control-xs)` (Plan 3.3). Gemessen (`val3.cjs`): Die Statusleiste wird **24 → 25**, und die Bühne verliert 1 px. `.app-status` ist `flex: 0 0 24px` mit `border-top: 1px`, der Inhalt ist also 23 hoch. Ein 24er-Knopf hebt über `min-height: auto` die Flex-Basis aus. Damit stimmen `--bar-sm` (R17), die schmale Seitenleiste (`bottom: var(--bar-sm)`) und der Toast-Abstand nicht mehr. Die Plan-Messung „bleibt innerhalb“ war nur deshalb wahr, weil die Leiste mitgewachsen ist.

**Fix:** `.version-button { min-height: 0; height: calc(var(--bar-sm) - 1px); … }`. Gemessen: Knopf 23, Leiste 24, bündig. R14 erlaubt `calc()`.

### B2 – `xtermTheme` scheitert am Typecheck

Plan 5: `XTERM_FALLBACKS … as const` und Rückgabetyp `typeof XTERM_FALLBACKS`. `pick()` liefert `string`, also `TS2322: Type 'string' is not assignable to type '"#070b14"'` (mit `tsc --strict` reproduziert). Die Welle 1 wäre rot.

**Fix:** Vertrag 3.2 (Typ `XtermColors`). Mit `tsc --strict` geprüft und ausgeführt.

### B3 – `.app-error` verletzt in Welle 1 R16

Plan 11 sagt „`.app-error` bleibt vorerst“ (T1). `styles.css` steht aber in `GEOMETRY_MIGRATED`, und `.app-error { padding: 6px 12px; gap: 12px }` verletzt R16. Damit ist das Gate nach Welle 1 rot.

**Fix:** T1 faltet `.app-error` wertgleich (`padding: var(--space-6) var(--space-12); gap: var(--space-12)`) und lässt die Regel stehen. T8 löscht sie in Welle 2 (über den Selektor, nicht über die Zeilennummer, siehe K1).

### B4 – Die Testpflicht von T9 ist unerfüllbar

Plan 10/T9: `rg "--space-(2xs|…)\b" src docs` → 0 Treffer.

1. `rg` liest `--space-…` als Option und bricht ab.
2. `docs/superpowers/` enthält die alten Namen dauerhaft (Specs, Pläne, Validierungen). Es kann also nie 0 Treffer geben.

**Fix (bindend):**

```powershell
rg -e "--space-(2xs|xs|sm|md|lg|xl|2xl|3xl|4xl)\b" src docs/design-system.md README.md
```

Erwartet: 0 Treffer. Ebenso für den Alias-Nachweis aus Plan 6: `rg -e "var\(--(ui-|surface|border\)|text\)|text-muted|accent\))" src/renderer` → 0 Treffer.

---

## 2. Vertrag (exakt)

### 2.1 Tokens (`tokens.css`, T1)

- Zeilen 46–48 werden ersetzt durch:

  ```css
    /* Spacing, named by value. The lint allows literal px only for 0, 1px, negatives, >= 48px and inside calc()/min()/max()/clamp(). */
    --space-2: 2px; --space-4: 4px; --space-6: 6px; --space-8: 8px; --space-10: 10px;
    --space-12: 12px; --space-16: 16px; --space-20: 20px; --space-24: 24px; --space-32: 32px;
  ```

- Die Motion-Zeile 76 lautet: `--dur-press: 120ms; --dur-fade: 150ms; --dur-popover: 160ms; --dur-hint: 180ms; --dur-modal: 200ms; --dur-toast: 220ms;`
- Zeilen 79–85 (Kommentar und Aliase) entfallen ersatzlos. Sonst bleibt alles wörtlich.

### 2.2 `terminal-theme.ts` (neu, T2)

```ts
/** xterm colours come from tokens.css; the fallbacks are the token values and are checked by terminal-theme.test.ts. */
export type XtermColors = Record<'background' | 'foreground' | 'cursor' | 'selectionBackground', string>;
export const XTERM_FALLBACKS: Readonly<XtermColors> = { background: '#070b14', foreground: '#dce9f8', cursor: '#67e8f9', selectionBackground: '#164e63' };
export const XTERM_TOKENS: Readonly<XtermColors> = { background: '--color-bg-stage', foreground: '--color-text-code', cursor: '--color-accent', selectionBackground: '--color-selection-bg' };
export function xtermTheme(read: (name: string) => string): XtermColors {
  const pick = (key: keyof XtermColors): string => read(XTERM_TOKENS[key]).trim() || XTERM_FALLBACKS[key];
  return { background: pick('background'), foreground: pick('foreground'), cursor: pick('cursor'), selectionBackground: pick('selectionBackground') };
}
```

`TerminalPanel.tsx`: Import `import { xtermTheme } from '../terminal-theme';`. Direkt vor `new Terminal` (heute Zeile 49) steht `const styles = getComputedStyle(document.documentElement);`. Dazu `theme: xtermTheme(name => styles.getPropertyValue(name))`. `fontFamily`, `fontSize: 14` und die übrigen Optionen bleiben wörtlich.

`terminal-theme.test.ts` (Pflichtfälle):

1. Für jeden Schlüssel von `XTERM_TOKENS` liefert `new RegExp(`(?<![\\w-])${XTERM_TOKENS[key]}:\\s*([^;]+);`).exec(readFileSync(new URL('./tokens.css', import.meta.url), 'utf8'))?.[1].trim()` genau `XTERM_FALLBACKS[key]`.
2. `xtermTheme(() => '')` ergibt `XTERM_FALLBACKS`.
3. `xtermTheme(() => ' #123456 ')` liefert viermal `'#123456'`.

### 2.3 `toast-state.ts` (neu, T8) – wörtlich wie Plan 4.2

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

`toast-state.test.ts` deckt fünf Fälle ab:

- Neuer Text bei leerem Zustand → `{ message, closing: false }`.
- `null` bei sichtbarem Toast → `closing: true`, der Text bleibt.
- `null` bei leerem Zustand → `toBe(state)` (gleiche Referenz).
- Neuer Text während `closing` → sichtbar mit dem neuen Text, `closing: false`.
- `exitedToast()` → `toBe(EMPTY_TOAST)`.

### 2.4 `components/Toast.tsx` (neu, T8)

Wie Plan 4.2, mit **einer** Änderung (K6) im Handler:

```tsx
onTransitionEnd={event => { if (event.target === event.currentTarget && state.closing && event.propertyName === 'opacity') setState(exitedToast); }}
```

Die API ist `export function Toast({ message, onClose }: { message: string | null; onClose: () => void })`. `EXIT_FALLBACK_MS = 300` bleibt. Weitere Vorgaben:

- `useNativeSurfaceBlock(state.message !== null)`.
- `role="alert"` auf dem Container.
- Der Knopf behält Text und `aria-label` von heute (`className="toast-close"`, `aria-label="Fehlermeldung schließen"`, Text „Schließen“).
- Kein `autoFocus`, kein `focus()`, kein Timer außer dem Fallback, kein Tastenhandler.

Einbau:

- **`App.tsx:855`** (nicht 859): Das Element `{error && <div className="app-error" …>…</div>}` wird zu `<Toast message={error} onClose={() => setError(null)} />`, an derselben Stelle vor `<footer className="app-status">`. Zeile 856 („Aktion fehlgeschlagen“) bleibt unverändert.
- **`SecondaryWindow.tsx:112-113`**: ebenso, als letztes Kind von `<main>`.
- Import jeweils `import { Toast } from './components/Toast';`.

### 2.5 `components/toast-ui.css` (neu, T8)

Wie Plan 4.2, plus **eine** Zeile nach `.toast.is-closing { opacity: 0; }` (K5):

```css
.toast.is-closing { transition-duration: var(--dur-fade); }
```

In der Probe gemessen, mit den Stufe-2-Tokens:

- Eintritt: zwei Transitions (`opacity 0→1`, `translateY(100%)→none`). Im Endzustand gibt es kein `transform`.
- Position: Der Toast sitzt 36 px über der Fensterkante, 11 px über der Statusleiste. Er ist 520 breit und 50 hoch (eine Zeile).
- Exit: `transitionend` feuert für `opacity` und `transform`.
- Retarget: Ein neuer Text mitten im Exit kehrt ab der aktuellen Opazität um (0,09 → 1).
- Reduced Motion: nur `opacity` in beide Richtungen. `transitionend('opacity')` feuert.

### 2.6 Lint (`design-tokens.test.ts`, T1, Gate-Teile in T9 entfernt)

Neue Hilfen (Modulebene):

```ts
const SPACES = [2, 4, 6, 8, 10, 12, 16, 20, 24, 32];
// TSX couples to these: ROW_HEIGHT 24 (ResourceTable/ContainerTable), pane header 32 (SplitTerminalArea), sidebar 44/24.
const LOCKED: Record<string, string> = { '--control-xs': '24px', '--bar-sm': '24px', '--bar-md': '32px', '--bar-lg': '44px', '--dur-toast': '220ms',
  ...Object.fromEntries(SPACES.map(n => [`--space-${n}`, `${n}px`])) };
const PX = /^-?(?:\d+\.?\d*|\.\d+)px$/;
/** Splits a value on top-level spaces and commas; a function call (calc, min, max, clamp, var …) stays one part. */
function valueParts(value: string): string[] { /* depth counter over ( and ) */ }
const pxLiterals = (value: string): number[] => valueParts(value.replace(/\s*!important\s*$/i, '')).filter(part => PX.test(part)).map(part => Number.parseFloat(part));
function movingKeyframesOf(css: string): Set<string> { /* today's loop at lines 80-84 over tokenize(css) */ }
```

`lint(file: string, css: string, shared: ReadonlySet<string> = new Set()): string[]`. Darin gilt `movingKeyframes = new Set([...shared, ...movingKeyframesOf(css)])`. Zusätzlich im Zweig `!isTokens`:

| Regel | Bedingung (Verstoß) |
|---|---|
| R14 | `property` ist `height` oder `min-height` und `pxLiterals(value).some(n => n > 16 && n < 48)` |
| R15 | `property === 'font-size'` und `pxLiterals(value).length > 0`, **oder** `property === 'font'` und `/(^|\s)\d+\.?\d*px(\/|\s|$)/.test(value)` |
| R16 | (`/^(?:padding|margin)(?:-|$)/.test(property)` oder `/^(?:row-|column-)?gap$/.test(property)`) und `pxLiterals(value).some(n => !(n === 0 || n === 1 || n < 0 || n >= 48))` |

R12 wandert aus dem `!isTokens`-Zweig und gilt für jede Datei. Im Zweig `isTokens` gilt:

- **R9:** Für jeden Namen aus `ALIASES` gilt: `declared.has(name)` → `add('R9', ':root', name, 'alias still declared')`. Die Pflicht „Alias deklariert“ entfällt. Die Prüfungen von `COLORS`, `EASES`, `tm-pulse` und den Ebenen bleiben.
- **R17:** Für jeden Eintrag aus `LOCKED` gilt: `declared.get(name) !== value` → `add('R17', ':root', name, declared.get(name) ?? 'missing')`. Für jeden deklarierten Namen gilt: `/^--space-/` und nicht in `LOCKED` → `add('R17', ':root', name, 'not on the spacing scale')` (K4).

Pro Datei (Welle 1–2, K2):

```ts
// Waves 1-2 only; T9 removes GEOMETRY_MIGRATED, LINT_ALL and the filter so that R14-R16 apply to every file.
const GEOMETRY_MIGRATED = ['tokens.css', 'styles.css'];
const LINT_ALL = process.env.DESIGN_LINT_ALL === '1';
const SHARED_MOVING = new Set(FILES.flatMap(file => [...movingKeyframesOf(readFileSync(`${ROOT}${file}`, 'utf8'))]));
for (const file of FILES) {
  it(file, () => {
    const found = lint(file, readFileSync(`${ROOT}${file}`, 'utf8'), SHARED_MOVING);
    expect(LINT_ALL || GEOMETRY_MIGRATED.includes(file) ? found : found.filter(line => !/^\S+ R1[456] /.test(line))).toEqual([]);
  });
}
```

**Kein `it.skipIf`.** R1–R13 laufen in jeder Welle über jede Datei. Nur R14–R16 sind gefiltert.

`RULE_IDS` bekommt `'R14', 'R15', 'R16'`. Fixtures:

- `BAD_FIXTURE` + `.p { height: 30px; } .q { font-size: 10px; } .r { font: 12px/1.4 x; } .s { padding: 5px 10px; }`. Erwartet sind zusätzlich mindestens 2 Treffer mit R15.
- `GOOD_FIXTURE` + `.t { height: 6px; min-height: 64px; margin: -1px; padding: 0 1px; gap: var(--space-8); font: var(--fs-sm)/1.45 var(--font-mono); } .u { padding: clamp(24px, 5vw, 56px); height: calc(var(--control-xs) - 2px); }`. Erwartet: weiterhin `[]`.
- Der Test „flags a broken tokens file“ lintet `':root { --ease-out: ease; --dur-fade: 500ms; --ui-text: var(--color-text); --bar-md: 30px; --space-md: 8px; --x: var(--accent); }'`. Erwartet wird je eine Zeile mit:
  - ` R9 ` und `--ui-text`
  - ` R17 ` und `--bar-md`
  - ` R17 ` und `--space-md`
  - ` R12 `
  - ` R4 `

  Die R10-Erwartungen bleiben (K3).
- Neuer Test „R7b across files“ mit genau dem Aufruf aus Plan 7: Er enthält ` R7b .x `. Ohne `shared` kommt `[]`.

T9 entfernt `GEOMETRY_MIGRATED`, `LINT_ALL` und den Filter (`expect(found).toEqual([])`). R0 bekommt `'components/toast-ui.css'`.

### 2.7 Selektoren, die neu sind oder sich ändern

| Datei | Selektor | Deklaration | Task |
|---|---|---|---|
| `styles.css` | `.version-button` | `height: calc(var(--bar-sm) - 1px)` (B1) | T1 |
| `styles.css` | `.app-error` | `padding: var(--space-6) var(--space-12); gap: var(--space-12)` (B3), in Welle 2 gelöscht | T1, T8 |
| `styles.css` | `.properties-heading :focus-visible` (neu, direkt nach `.properties-heading`) | `outline-offset: calc(-1 * var(--focus-offset));` (K7) | T1 |
| `assistant-ui.css` | `.assistant-header :focus-visible` (neu, direkt nach `.assistant-header select`) | `outline-offset: calc(-1 * var(--focus-offset));` (K7) | T7 |
| `kubernetes-ui.css` | `.kube-filter-chip` | + `min-height: var(--control-xs)` (S2-5) | T6 |
| `components/toast-ui.css` | `.toast`, `.secondary-shell .toast`, `.toast > span`, `.toast-close`, `.toast.is-closing` | Plan 4.2 + K5 | T8 |

Alle anderen Änderungen folgen Plan 3.2 (wertgleich) und 3.3 (wertändernd), Datei:Zeile wie dort. Plan 3.3 ist gegen den Bestand geprüft, alle Zeilennummern stimmen (Ausnahme App.tsx, K1).

---

## 3. Korrekturen (bindend)

| # | Korrektur | Wo |
|---|---|---|
| K1 | Zeilen in `App.tsx`: Die Fehlermeldung steht in **855**, die Statuszeile in **856** (nicht 859/860). T8 sucht über den Inhalt. In `styles.css` löscht T8 die Regel über den Selektor `.app-error`, weil T1 Zeilen einfügt. | Plan 4.2, 11 |
| K2 | Das Wellen-Gate filtert nur R14–R16 (Code 2.6), kein `skipIf` wie in Stufe 1. Sonst wären die Welle-2-Dateien für R1–R13 blind, und genau sie werden in Welle 2 geändert. | Plan 3.4 |
| K3 | Der Alias-Fixture-Test muss den **Namen** prüfen. Die heutige Fixture löst R9 schon über die fehlenden Farben aus, die Erwartung „enthält R9“ wäre trivial grün. R17 und R12-in-`tokens.css` bekommen eigene Erwartungen (2.6). | Plan 6, 10 |
| K4 | R17 meldet zusätzlich jedes deklarierte `--space-*` außerhalb der zehn Stufen. Das ist der Schutz gegen eine Rückkehr der T-Shirt-Namen. | Plan 3.4 |
| K5 | Der Toast blendet schneller aus als ein: `.toast.is-closing { transition-duration: var(--dur-fade); }` (150 ms), der Eintritt bleibt 220 ms. Begründung: `emil-design-eng`, Review-Checkliste „Same enter/exit transition speed → Make exit faster than enter“ und `animate` 6 („snappy on the system response“). Der Weg bleibt symmetrisch (Exit = Enter-Pfad). Retarget nimmt beim Umkehren wieder 220 ms. Der Fallback-Timer (300 ms) bleibt. | Plan 4.1, 4.2 |
| K6 | `onTransitionEnd` prüft `event.target === event.currentTarget`. `transitionend` bubbelt, und der Knopf im Toast hat eine eigene `transform`-Transition (Druck). | Plan 4.2 |
| K7 | Fokusring in den 32er-Köpfen. Gemessen nach der Faltung: Der Editor-Knopf sitzt bündig an der Oberkante des Scrollcontainers `.properties-panel` (vorher 4 px Luft), die Assistent-Icons 1,5 px unter der Oberkante von `.workspace { overflow: hidden }`. Der 2-px-Ring mit 2 px Offset wird oben abgeschnitten. Fix: Der Ring liegt innen (2.7). | Z1, S2-6 |
| K8 | Vier Höhen sind heute schon wirkungslos, weil die globale Regel `input:not([type='checkbox']):not([type='range']):not([type='color'])` (0,3,1) gewinnt. Gemessen sind alle 36: `.view-rename`, `.file-prompt input`, `.permissions-octal input`, `.file-path input`. Sie werden nach 3.2/3.3 nur tokenisiert (wertgleich wirkungslos). Ihre Spezifität wird **nicht** angehoben (Z2, siehe E2). Die Plan-Wirkungen „Eingabezeile +2“ und Abnahme „Prompt 32“ gelten nur für den Knopf. | Plan 3.3, 12 |
| K9 | CHANGELOG und README wörtlich nach Abschnitt 6. „sie bleiben, bis man sie schließt“ entfällt, weil die nächste Aktion die Meldung heute wie künftig löscht (`setError(null)` an rund 15 Stellen). | Plan 13 |
| K10 | Die Doku-Texte gelten wörtlich nach Abschnitt 6 (Plan 13 hatte Auslassungen „…“). | Plan 13 |
| K11 | Manuelle Abnahme nach Abschnitt 7 (Statusleiste 24, Prompt, Fokus nach Klick, RDP-Fokus, Exit 150 ms). | Plan 12 |

---

## 4. Entscheidungen

| # | Entscheidung | Warum | Kosten, falls falsch |
|---|---|---|---|
| E1 | Exit 150 ms (`--dur-fade`), Eintritt 220 ms (`--dur-toast`), gleicher Weg | Skill-Checkliste: Exit schneller als Enter. Das System reagiert auf einen Klick. | eine Zeile |
| E2 | Die toten Input-Höhen (K8) werden nicht repariert | Sichtbare Änderung außerhalb des Auftrags (die Umbenennen-Eingabe würde 36 → 24, der Pfad-Editor 36 → 24). Z2: lieber eine Faltung weglassen als ein Layout ändern. Steht im Ledger als offener Punkt. | eigene kleine Fehlerbehebung danach |
| E3 | Versionsknopf `calc(var(--bar-sm) - 1px)` statt `--control-xs` | B1, gemessen. Der Knopf füllt die Leiste unter der Haarlinie. | keine |
| E4 | Fokusring in den Köpfen von Editor und Assistent liegt innen (`outline-offset: calc(-1 * var(--focus-offset))`) | K7. Gleiches Muster wie Split-Griff und View-Drop (`outline-offset: -2px`). | eine Zeile je Datei |
| E5 | Gate filtert R14–R16 per Regel-ID, nicht per Datei-Skip | K2 | keine |

Bestätigte Rulings ohne Änderung:

- **S2-1 bis S2-6:** Bei der Zeilenhöhe des Filterfelds (`kubernetes-ui.css:135`, `line-height: 22px` → `calc(var(--control-xs) - 2px)`) gilt die Tabelle. Das ist wertgleich, obwohl S2-4 `line-height` sonst ausnimmt.
- **S3-1 bis S3-5, S4-1, S5-1, S1-1, ALLG, Z1 bis Z3.**
- **S3-2 ist bewusst teuer:** Solange der Toast steht, ist RDP ausgeblendet, und Tastatureingaben gehen nicht an die Remote-Sitzung. Beim Schließen ruft `RdpPanel` (`[shown, focused]`-Effekt) `rdpFocus` auf und gibt den Fokus an die Sitzung zurück. Dialoge im Top-Layer (`showModal`) liegen weiter über dem Toast. Das ist wie heute beim Balken und keine Regression.

---

## 5. Wellen und Tasks (disjunkte Dateien)

| Welle | Task | Dateien (nur diese) | Inhalt |
|---|---|---|---|
| 1 | **T1 Tokens, Lint, Shell** | `src/renderer/src/tokens.css`, `src/renderer/src/styles.css`, `src/renderer/src/design-tokens.test.ts` | 2.1. Lint nach 2.6 mit Gate. `styles.css` nach Plan 3.2/3.3 mit B1, B3 und der `.properties-heading`-Zeile aus K7. `.app-error` bleibt als Regel bestehen, nur gefaltet. |
| 1 | **T2 xterm** | `src/renderer/src/terminal-theme.ts` (neu), `src/renderer/src/terminal-theme.test.ts` (neu), `src/renderer/src/components/TerminalPanel.tsx` | 2.2 |
| 2 | **T3 Terminal** | `src/renderer/src/terminal-ui.css` | Plan 3.2, 3.3 |
| 2 | **T4 Navigation, Editor** | `src/renderer/src/components/navigation-ui.css`, `src/renderer/src/components/editor-ui.css` | Plan 3.2, 3.3 |
| 2 | **T5 Dateien** | `src/renderer/src/files-ui.css` | Plan 3.2, 3.3. K8: Die Input-Höhen werden nur tokenisiert. |
| 2 | **T6 Kubernetes, Container** | `src/renderer/src/kubernetes-ui.css`, `src/renderer/src/kubernetes-dock.css`, `src/renderer/src/containers-ui.css` | Plan 3.2, 3.3 inkl. S2-5 |
| 2 | **T7 Assistent, Workflows** | `src/renderer/src/assistant-ui.css`, `src/renderer/src/workflows-ui.css` | Plan 3.2, 3.3, `.assistant-header`-Zeile aus K7 |
| 2 | **T8 Toast** | `src/renderer/src/toast-state.ts` (neu), `src/renderer/src/toast-state.test.ts` (neu), `src/renderer/src/components/Toast.tsx` (neu), `src/renderer/src/components/toast-ui.css` (neu), `src/renderer/src/App.tsx`, `src/renderer/src/SecondaryWindow.tsx`, `src/renderer/src/styles.css` (nur die Regel `.app-error` löschen) | 2.3–2.5, K1, K5, K6 |
| 3 | **T9 Lint auf alle, Doku** | `src/renderer/src/design-tokens.test.ts`, `docs/design-system.md`, `README.md`, `CHANGELOG.md` | Gate entfernen, R0 + `components/toast-ui.css`, Texte aus Abschnitt 6 |

`styles.css` wird in Welle 1 von T1 und in Welle 2 nur von T8 (eine Regel) berührt. `design-tokens.test.ts` ändern nur T1 (Welle 1) und T9 (Welle 3). Keine Main-, Preload-, Shared- oder `package.json`-Änderung, keine Abhängigkeit, kein IPC, kein neuer UI-Text. Die Version bleibt 0.9.0.

**Gate nach jeder Welle:** `npm run typecheck` und `npx vitest run` grün. Nach Welle 1 ist das ohne Schalter grün, weil R14–R16 für die Welle-2-Dateien gefiltert sind. Jeder Welle-2-Task meldet zusätzlich 0 Verstöße in **seinen** Dateien mit:

```powershell
$env:DESIGN_LINT_ALL='1'; npx vitest run src/renderer/src/design-tokens.test.ts; Remove-Item Env:DESIGN_LINT_ALL
```

---

## 6. Texte (wörtlich)

**`CHANGELOG.md`** (T9), neuer letzter Punkt unter `## [0.9.0] – 2026-10-18`. Es gibt keinen neuen Kopf.

```markdown
- Fehlermeldungen erscheinen als Hinweis unten rechts und verschieben das Terminal nicht mehr. Leisten, Knöpfe, Schriftgrößen und Abstände folgen einer festen Skala; Chip-Leiste und Panelköpfe sind kompakter.
```

**`README.md:24`** (T9), der ganze Absatz:

```markdown
Farben, Maße, Radien, Ebenen, Schatten und Bewegung kommen aus einer Datei: `src/renderer/src/tokens.css`. Die Regeln für neue Oberflächen stehen in [`docs/design-system.md`](docs/design-system.md). Der Test `src/renderer/src/design-tokens.test.ts` prüft alle CSS-Dateien auf harte Farben und Maße, eingebaute Easings, feste Dauern und z-index-Werte sowie auf Bewegung ohne `prefers-reduced-motion`.
```

**`docs/design-system.md`** (T9):

- **Zeile 3:** Am Ende wird angehängt: ` Stufe 2: \`docs/superpowers/specs/2026-10-19-design-system-stage2-design.md\`, Validierung \`docs/superpowers/specs/2026-10-19-design-system-stage2-validation.md\`.`
- **Roter Faden 5** (ganze Zeile): `5. **Vier Control-Höhen.** 24 in Tabellen und Chip-Leisten, 28 in Leisten und Menüs, 32 Standard, 36 für Formulareingaben und Suche. Leisten sind 32 hoch (Pane, View, Datei, Dock, Transfer, Editor- und Assistent-Kopf), der App-Kopf 44, die Statusleiste 24.`
- **Roter Faden 7:** Vor `Puls (1 s)` wird `Fehlerhinweis (220 ms ein, 150 ms aus), ` eingefügt. Sonst bleibt die Zeile unverändert.
- **Zeile 19** wird ersetzt durch: `Maße stehen seit Stufe 2 nur noch als Token im CSS. Erlaubte Literale: 0, 1 px, negative Werte, Dekorgeometrie bis 16 px, Flächen ab 48 px, Werte in \`calc()\`/\`min()\`/\`max()\`/\`clamp()\`.`
- **Tabelle „Abstände“:** zehn Zeilen `| \`--space-N\` | \`Npx\` |` für N = 2, 4, 6, 8, 10, 12, 16, 20, 24, 32.
- **Tabelle „Bewegung“** nach `--dur-modal`: `| \`--dur-toast\` | Fehlerhinweis (Eintritt; Austritt mit \`--dur-fade\`) | \`220ms\` | \`.toast\` |`
- **Neuer Abschnitt** `### Kopplungen` nach „Controls und Leisten“:

  ```markdown
  Diese Werte stehen zusätzlich als Zahl im TSX. Wer einen ändert, ändert die TSX-Stelle mit; R17 schlägt sonst an.

  | Token | Wert | gekoppelt an |
  |---|---|---|
  | `--bar-md` | `32px` | Pane-Kopf in `SplitTerminalArea.tsx` (Drop-Zonen, Panel-Rechteck `calc(… + 32px)`) |
  | `--control-xs` | `24px` | `ROW_HEIGHT` in `ResourceTable.tsx` und `ContainerTable.tsx` (Fensterung) |
  | `--bar-lg`, `--bar-sm` | `44px`, `24px` | schmale Seitenleiste (`top`/`bottom` in `styles.css`), Abstand des Fehlerhinweises |
  ```

- **Abschnitt „Aliase“** (ganzer Text): `Aliase: entfernt in Stufe 2; die Namen \`--ui-*\`, \`--surface*\`, \`--border\`, \`--text\`, \`--text-muted\`, \`--accent\`, \`--ui-radius\`, \`--ui-control-height\`, \`--ui-input-height\` dürfen weder deklariert noch genutzt werden (R9, R12).`
- **Zustände, Zeile „Fokus“:** Hinter `Split-Griff und View-Drop \`outline-offset: -2px\`` wird `, Controls in den Köpfen von Editor und Assistent \`outline-offset: calc(-1 * var(--focus-offset))\`` angehängt.
- **Motion-Gate:** Die Zeile `.app-error` wird ersetzt durch:

  ```markdown
  | Fehlerhinweis (`.toast`) | gelegentlich, nur durch Ereignisse, nie per Taste | animieren | harten Wechsel vermeiden, Herkunft zeigen (von unten) | Transitions `opacity 0→1`, `translateY(100%)→0`, `--ease-out`; Eintritt per `@starting-style` mit `--dur-toast` (220 ms), Austritt auf demselben Weg über `.is-closing` mit `--dur-fade` (150 ms); Origin unten | nur `opacity` |
  ```

- **Regeln für neues CSS:**
  - Der Alias-Punkt wird zu: `- Die Aliase sind entfernt; ihre Namen sind weder als Deklaration noch als \`var()\` erlaubt (R9, R12).`
  - Neuer Punkt nach der Token-Regel: `- Höhen, Schriftgrößen und Abstände nur als Token (R14–R16).`
  - Der Punkt `TerminalPanel.tsx:51` wird zu: `- \`terminal-theme.ts\`: die xterm-Farben kommen aus den Tokens; die Fallbacks sind die Tokenwerte und werden vom Test geprüft.`
- **Prüfung:**
  - R0 beginnt mit `Der Test findet mindestens die zwölf bekannten Stylesheets.`
  - An R7b wird angehängt: ` Bewegte Keyframes werden über alle Dateien gesammelt.`
  - R9 wird zu: `**R9:** \`tokens.css\` deklariert die drei Kurven wörtlich, alle \`--color-*\`-Namen und \`@keyframes tm-pulse\`, keinen Alias, und die Ebenen sind nach \`header < popover < menu < modal < toast\` geordnet.`
  - R12 wird zu: `**R12:** Kein Wert nutzt einen Alias, auch nicht in \`tokens.css\`.`
  - Neu sind:
    - `**R14:** \`height\` und \`min-height\` enthalten kein Literal zwischen 17 und 47 px.`
    - `**R15:** \`font-size\` und die Größe in \`font\` sind nie ein px-Literal.`
    - `**R16:** \`padding*\`, \`margin*\` und \`gap\` enthalten als Literal nur 0, 1 px, negative Werte oder ab 48 px.`
    - `**R17:** \`tokens.css\` hält \`--control-xs\`, \`--bar-sm\`, \`--bar-md\`, \`--bar-lg\`, die zehn \`--space-*\` und \`--dur-toast\` auf ihren Werten und deklariert keine weiteren \`--space-*\`.`
- **Feel-Check**, angehängt: ` Der Fehlerhinweis kommt von unten und geht auf demselben Weg schneller zurück.`

---

## 7. Testpflichten und manuelle Abnahme

### Testpflichten

| Task | Pflicht |
|---|---|
| T1 | Ohne Schalter grün: `tokens.css`, `styles.css` und alle übrigen Dateien für R1–R13. Der Selbsttest weist R1–R16 über `RULE_IDS` nach, R9 (Alias), R12, R17 und R4 über die Tokens-Fixture. Die Negativ-Fixture liefert `[]`, der R7b-Test über zwei Dateien besteht. Mit `DESIGN_LINT_ALL=1` gibt es nur R14–R16-Treffer, nur in Welle-2-Dateien. `npm run typecheck` ist grün. Im Ledger stehen die Vorher/Nachher-Werte für Statusleiste (24 bleibt 24) und Editor-Kopf (40 → 32). |
| T2 | `terminal-theme.test.ts` grün (drei Fälle aus 2.2). Typecheck grün. |
| T3–T7 | Selbstprüfung mit Schalter: 0 Verstöße in den eigenen Dateien. Das Ledger nennt Vorher/Nachher aus Plan 3.3. T5 vermerkt K8. |
| T8 | `toast-state.test.ts` grün (fünf Fälle). `rg "app-error" src` → 0 Treffer. Lint für `components/toast-ui.css` mit Schalter grün. Typecheck grün. |
| T9 | Ohne Schalter sind alle zwölf Dateien grün. `version.test.ts` ist grün. Die beiden `rg -e`-Befehle aus B4 liefern 0 Treffer. |

### Manuelle Abnahme (`npm run dev`, ersetzt Plan 12 wo abweichend)

1. **Leisten:** View 32, Pane-Kopf 32, Datei-Kopf 32, Transfer 32, Dock 32, Editor- und Assistent-Kopf 32, App-Kopf 44, **Statusleiste 24** (DevTools: `.app-status` 24 hoch, Versionsknopf 23). Das Terminal fittet nach dem Umschalten der Ansicht ohne Rest.
2. **Controls:** Terminal-Tabs 26 im 28-Item, View-Schließen 24, Pfad-Knöpfe 24, Dateiwerkzeuge 28, **Prompt-Knopf 32** (die Prompt-Eingabe bleibt 36, K8), Filter-Chips 24 (Chip-Leiste 33, gleich hoch wie die Art-Tabs), Reset 24, Namespace-Select und „?“ 28.
3. **Fokus:** Tab auf den Schließen-Knopf im Editor-Kopf und auf ⚙/× im Assistent-Kopf: Der Ring ist an allen vier Seiten sichtbar.
4. **Tabellen:** Kube- und Container-Tabelle scrollen mit 2000 Zeilen ohne Sprung. Pfeiltasten halten die Auswahl im Bild, Spaltenfilter 24, Clear-Knopf innen, Gruppierzeilen 24.
5. **Schrift:** Welcome-Titel 22, Marke 14, Hilfe-Titel 14, Konflikt-Titel 18, Badges und Zähler 11, Assistent-Icons 18.
6. **Toast:** Einen Fehler auslösen (9. Session bei Limit 8).
   - Der Toast gleitet unten rechts in 220 ms herauf, die Statusleiste zeigt „Aktion fehlgeschlagen“.
   - Die Terminalgröße ändert sich nicht (Spalten/Zeilen gleich), der Fokus bleibt beim Erscheinen im Terminal (Tippen geht weiter), Escape tut nichts.
   - „Schließen“: Der Toast geht auf demselben Weg nach unten, sichtbar schneller (150 ms). Danach liegt der Fokus wie heute auf dem Dokument, nicht im Terminal.
   - Ein zweiter Fehler während des Ausblendens kehrt um.
   - Zweitfenster: Der Toast sitzt 12 px über dem Rand.
   - Ein Fehler bei offenem Bestätigungsdialog liegt wie heute hinter dem Dialog.
7. **RDP:** Bei offener RDP-Sitzung erscheint mit dem Toast der Platzhalter. Nach „Schließen“ kommt die Fläche pixelgenau zurück und hat wieder den Tastaturfokus.
8. **Reduced Motion:** Der Toast blendet nur ein und aus, er gleitet nicht und verschwindet trotzdem (kein hängender, unsichtbarer Toast, der RDP blockiert).
9. **Feel-Check** im DevTools-Animations-Panel bei fünffacher Dauer: Der Toast kommt von unten, geht nach unten, Kurve `--ease-out`, der Exit ist kürzer.
10. **xterm:** Hintergrund, Text, Cursor und Auswahl sehen aus wie vorher, im Haupt- und Zweitfenster und in der Shell des Kube- und Container-Docks. Ein testweise geänderter `--color-bg-stage` färbt das Terminal nach einem Neustart mit.

### Offene Punkte für danach (nicht in dieser Stufe)

- K8/E2: Die Höhen von `.view-rename`, `.file-prompt input`, `.permissions-octal input` und `.file-path input` greifen nicht (globale Input-Regel mit Spezifität 0,3,1). Die Umbenennen-Eingabe ist 36 hoch in einer 32er-Leiste. Das ist eine eigene kleine Fehlerbehebung.
- Spec 8: `.kube-stale` nur mit `opacity`, Einblendung von `.connection-test` und `.transfer-job`.
