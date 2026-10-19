# UX-Audit v2 – Validierung (Stufe 3)

Stand: 2026-10-19 · Branch `claude/feature/ux-audit-v2` · geprüft gegen den Code auf diesem Branch (Basis grün: `npm run typecheck`, `npx vitest run` mit 176 Dateien und 2496 Tests).
Eingaben: [Spec](2026-10-19-ux-audit-v2-design.md), [Plan](../plans/2026-10-19-ux-audit-v2.md), [Prototyp](../design/2026-10-19-ux-audit-v2.html).

**Dieser Anhang ist bindend und geht Spec und Plan vor.** Wo er schweigt, gilt die Spec.

**Urteil: ready after corrections.** 9 Blocker (alle mit Fix), 27 Korrekturen, 10 Entscheidungen.

---

## 1. TypeScript-Vertrag (wörtlich übernehmen)

Die Umsetzer der Wellen 1 und 2 arbeiten parallel im selben Arbeitsbaum. Die folgenden Signaturen gelten wörtlich: Namen, Feldnamen, Optionalität und Exportort. Dazu kommen nur private Helfer.

### 1.1 `src/shared/ssh.ts` (Task 1C)

```ts
import type { ConnectionErrorCode } from './connection-errors';

export type SshStatus = 'connecting' | 'connected' | 'closed' | 'error';   // unverändert (Transfer-Schema)
/** Phase of an ssh2 connection; local shells, pods and local containers only send 'shell'. */
export type SshStep = 'reach' | 'hostkey' | 'auth' | 'shell';
export type SshEvent =
  | { type: 'data'; sessionId: string; sequence: number; data: Uint8Array }
  | { type: 'step'; sessionId: string; step: SshStep }
  | { type: 'status'; sessionId: string; status: SshStatus; message?: string;
      /** Only with status 'error', or 'closed-by-server' with status 'closed'. */
      code?: ConnectionErrorCode;
      /** Raw error text, at most 500 characters; never a stack, a config or key material. */
      detail?: string };
```

### 1.2 `src/shared/connection-errors.ts` (neu, Task 1C, Test `connection-errors.test.ts`)

```ts
export type ConnectionErrorCode = 'auth' | 'timeout' | 'hostkey-changed' | 'hostkey-rejected' | 'hostkey-store'
  | 'refused' | 'not-found' | 'key-file' | 'agent' | 'limit' | 'closed-by-server' | 'unknown';
export type ConnectionAction = 'retry' | 'edit' | 'copy';
export const ACTION_LABELS: Readonly<Record<ConnectionAction, string>>;
//   { retry: 'Erneut verbinden', edit: 'Verbindung bearbeiten', copy: 'Fingerprint kopieren' }
export const DETAIL_LIMIT = 500;

export interface ConnectionErrorContext {
  /** connection.address, e.g. "deploy@10.0.4.21:22" or "Lokal · CMD". */
  address: string;
  /** Main text of the event or the rejected call; body of 'unknown' and 'hostkey-store'. */
  message?: string;
  /** false for local shells, local containers and pods: no host hint. */
  remote: boolean;
}
export interface ConnectionErrorText {
  title: string; body: string; next?: string;
  primary: ConnectionAction; secondary?: ConnectionAction;
}
export function connectionError(code: ConnectionErrorCode, context: ConnectionErrorContext): ConnectionErrorText;

/** "deploy@10.0.4.21:22" → { user: 'deploy', host: '10.0.4.21', port: '22' }; the port is the digits after the last ':'. */
export function splitAddress(address: string): { user?: string; host: string; port?: string };
```

Wörtliche Texte in Abschnitt 3.3. Der Test prüft: jeder Code liefert Titel, Text und Primäraktion; `splitAddress` für Benutzer und Port, ohne Benutzer, ohne Port und für IPv6 (`fe80::1:22` → Host `fe80::1`, Port `22`).

### 1.3 `src/shared/sftp.ts` (Task 1C)

```ts
export type SftpEvent =
  | { type: 'status'; sessionId: string; status: SftpStatus; message?: string; code?: ConnectionErrorCode; detail?: string }
  | …; // übrige Varianten unverändert
```

### 1.4 `src/shared/kubernetes.ts` (Task 1C)

```ts
export interface ClusterStatus {
  // … bestehende Felder unverändert
  /** Number of the running or next reconnect attempt, 1-based; only with state 'reconnecting'. */
  attempt?: number;
  /** Name of the SSH connection the current attempt goes through; absent between attempts. */
  trying?: string;
}
export const RECONNECTING_MESSAGE = 'Gesperrt, bis der Cluster wieder erreichbar ist.';
```

`since` entfällt (K7). `NOT_CONNECTED_MESSAGE` bleibt.

### 1.5 `src/shared/vault/connections.ts` (Task 1C, Test in `connections.test.ts`)

```ts
import { MAX_SSH_SESSIONS } from '../ssh';
/** Toast for the session limit (info). */
export const sessionLimitNotice = (): { title: string; body: string } =>
  ({ title: `Maximal ${MAX_SSH_SESSIONS} Sessions`, body: 'Schließe zuerst einen Tab.' });
/** One sentence for Main errors and the picker; SFTP passes MAX_SFTP_SESSIONS. */
export const sessionLimitText = (limit: number = MAX_SSH_SESSIONS): string =>
  `Maximal ${limit} Sessions gleichzeitig. Schließe zuerst einen Tab.`;
```

### 1.6 `src/shared/vault/write-errors.ts` (neu, Task 1F, Test `write-errors.test.ts`)

```ts
/** German cause for a failed vault write, by errno code; undefined for unknown codes. */
export function vaultWriteMessage(code: string | undefined): string | undefined;
/** True when `text` is one of the messages above (the renderer passes only these through). */
export function isVaultWriteMessage(text: string): boolean;
```

Texte: `EACCES`/`EPERM`/`EROFS` → „Die Vault-Datei ist schreibgeschützt.“ · `EBUSY` → „Die Vault-Datei ist von einem anderen Programm gesperrt.“ · `ENOENT` → „Der Ordner der Vault-Datei ist nicht erreichbar.“ · `ENOSPC` → „Auf dem Laufwerk ist kein Platz mehr.“

### 1.7 Renderer `src/renderer/src/notice-store.ts` (neu, Task 1B, Test `notice-store.test.ts`)

```ts
export type NoticeTone = 'error' | 'info' | 'ok';
export interface NoticeAction { label: string; run: () => void }
export interface Notice {
  id: number; tone: NoticeTone; title: string; body?: string; action?: NoticeAction;
  /** Set when the exit starts; removed after the exit transition. */
  leaving: boolean;
}
export const MAX_VISIBLE_NOTICES = 3;

// Pure list operations (tested)
/** Appends; an identical visible notice (tone, title, body) starts leaving first; beyond three visible the oldest starts leaving. */
export function pushNotice(list: readonly Notice[], notice: Notice): Notice[];
/** Marks one notice as leaving; unknown id → same list. */
export function closeNotice(list: readonly Notice[], id: number): Notice[];
/** Drops one notice; unknown id → same list. */
export function removeNotice(list: readonly Notice[], id: number): Notice[];

// Module store (pattern of native-surface.ts)
export const noticeStore: {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly Notice[];
  close(id: number): void;
  remove(id: number): void;
};
export function clearNotices(): void;
export const notify: {
  error(title: string, options?: { body?: string; action?: NoticeAction }): number;
  info(title: string, options?: { body?: string; action?: NoticeAction }): number;
  ok(title: string, options?: { body?: string }): number;
};
```

Kein `ttl`-Feld: die Zeit steht nur im CSS (K1). Fehler laufen nie ab.

### 1.8 Renderer `src/renderer/src/edit-request.ts` (neu, Task 1B, Test `edit-request.test.ts`)

```ts
/** The window that can edit connections registers one handler; returns the unsubscribe. */
export function onEditRequest(handler: (connectionId: string) => void): () => void;
/** True while a handler is registered (main window only). */
export function canEditConnections(): boolean;
export function requestEdit(connectionId: string): void;
```

### 1.9 `components/Toast.tsx` (Task 1B, Bridge-Entfernung in 2A)

```ts
export function ToastStack(): JSX.Element;
export function ToastItem(props: { notice: Notice; paused: boolean }): JSX.Element;
/** Wave-1 bridge only (B1), removed by 2A: pushes `message` as an error notice and renders <ToastStack />. */
export function Toast(props: { message: string | null; onClose: () => void }): JSX.Element;
```

### 1.10 `src/renderer/src/status-words.ts` (neu, Task 1C, Test `status-words.test.ts`)

```ts
import type { SshStatus } from '../../shared/ssh';
export type StatusForm = 'short' | 'long';
export function statusWord(status: SshStatus, form: StatusForm, options?: { name?: string; protocol?: 'RDP' | 'SFTP' }): string;
```

`RdpStatus` und `SftpStatus` haben dieselben vier Werte und sind zuweisbar. Texte in 3.4.

### 1.11 `src/renderer/src/connect-timeline.ts` (neu, Task 2B, Test `connect-timeline.test.ts`)

```ts
import type { SshStep } from '../../shared/ssh';
export const WAIT_MS = 400;
export const SLOW_MS = 1500;
export const STEP_LABELS: Readonly<Record<SshStep, string>>;
export interface StepMark { step: SshStep; at: number }                 // Date.now() on arrival
export interface StepView { step: SshStep; label: string; state: 'open' | 'active' | 'done'; ms?: number }
/** Before the first mark the first step is active since startedAt; marks for steps not in `steps` are ignored. */
export function stepViews(steps: readonly SshStep[], marks: readonly StepMark[], startedAt: number, now: number): StepView[];
/** 'Gesamt 1,2 s', or after SLOW_MS in the active step the slow text; slow = true colours it --color-warn. */
export function cardFooter(views: readonly StepView[], startedAt: number, now: number): { text: string; slow: boolean };
/** 400 → '0,4 s'. */
export function formatSeconds(ms: number): string;
/** Seconds since `endedAt`: 'vor 12 s' (at least 1 s), from 60 s 'vor 2 min'. */
export function formatAgo(ms: number): string;
```

### 1.12 Komponenten-Props (Task 2B; 3C nutzt sie)

```ts
// components/ConnectingCard.tsx (only TerminalPanel uses it)
export interface ConnectingCardProps {
  name: string; address: string;
  steps: readonly SshStep[];          // ssh2 sessions: ['reach','hostkey','auth','shell']; otherwise ['shell']
  marks: readonly StepMark[];
  startedAt: number;
  /** Pane focused and visible and not embedded: the cancel button takes focus, Esc cancels. */
  active: boolean;
  onCancel: () => void;
}
// components/ConnectionErrorCard.tsx
export interface ConnectionErrorCardProps {
  connectionId: string;               // for requestEdit; LOCAL_CONTAINER_HOST hides "Verbindung bearbeiten"
  code: ConnectionErrorCode;
  name: string; address: string; remote: boolean;
  message?: string; detail?: string;
  active: boolean;                    // primary button takes focus
  onRetry: () => void;
}
// components/DisconnectedBar.tsx
export interface DisconnectedBarProps {
  /** 'server' animates in; 'session' (own exit) and 'cancel' (Abbrechen/Esc) appear at once. */
  reason: 'server' | 'session' | 'cancel';
  endedAt: number;
  active: boolean;                    // button takes focus, so Enter reconnects
  onReconnect: () => void;
}
// components/TerminalPanel.tsx: new optional prop
interface TerminalPanelProps { /* … */ embedded?: boolean }   // dock terminals: cards never take focus
```

Jede der drei Komponenten importiert `./connection-ui.css` selbst (Vite dedupliziert).

### 1.13 `components/kubernetes/ClusterStatusBar.tsx` und `cluster-bar.ts` (Task 2D, Test `cluster-bar.test.ts`)

```ts
// cluster-bar.ts (pure)
export type ConnbarTone = 'live' | 'warn' | 'ok' | 'off';
export interface ConnbarInput {
  status: ClusterStatus | null; now: number;
  /** 0 = unknown. */ updatedAt: number;
  /** Date.now() when state became 'reconnecting'. */ reconnectingSince?: number;
  /** Date.now() when state went from 'reconnecting' to 'ready'. */ recoveredAt?: number;
}
export const RECOVERED_MS = 3000;
export const FIRST_NOTICE_MS = 2000;
export function connbar(input: ConnbarInput): { tone: ConnbarTone; text: string; age: string };

// ClusterStatusBar.tsx
export function ClusterStatusBar(props: { status: ClusterStatus | null; updatedAt: number }): JSX.Element;
```

Die Komponente hält `reconnectingSince`/`recoveredAt` im eigenen State, liest `Date.now()` beim Rendern und setzt je einen Timer auf die 2-s- und 3-s-Grenze. Das Alter rendert mit dem 10-s-Tick von `ClusterView` neu.

### 1.14 Kube-Renderer (Task 2D)

```ts
// kube-view.ts
interface KubeViewState { /* … */ /** Date.now() of the last rows/overview event; 0 = none. */ updatedAt: number }
type KubeViewAction = /* … */ | { type: 'event'; event: KubeEvent; at?: number };   // 'rows' and 'overview' set updatedAt = at ?? state.now
// kube-commands.ts
interface ActionContext { /* … */ reconnecting?: boolean }   // !connected && reconnecting → RECONNECTING_MESSAGE
// kube-menus.ts
interface Env { /* … */ reconnecting: boolean }               // = context.status?.state === 'reconnecting'
```

`connectedReason` und `shellUnavailable` geben bei `reconnecting` ebenfalls `RECONNECTING_MESSAGE` zurück.

### 1.15 BusyButton (Task 2E)

```ts
// components/BusyButton.tsx (imports './busy-button.css')
export const DONE_MS = 1200;
export interface BusyButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  busy: boolean;
  idleLabel: string;
  /** Default: idleLabel (label stays, the dot pulses). */
  busyLabel?: string;
  /** Default: 'Gespeichert'. */
  doneLabel?: string;
  /** Raise after each success; every change shows doneLabel for DONE_MS. 0/undefined = never. */
  doneKey?: number;
}
export function BusyButton(props: BusyButtonProps): JSX.Element;   // disabled = props.disabled || busy; aria-busy = busy
```

### 1.16 Container (Task 2F)

```ts
// container-view.ts
interface ContainerViewState { /* … */ busy: Readonly<Record<string, InventoryAction>> }   // initial {}
type ContainerViewAction = /* … */ | { type: 'busy'; uid: string; action?: InventoryAction }  // without action = done; no-op returns the same state
export const BUSY_LABEL: Readonly<Record<InventoryAction, string>>;
//   { start: 'startet', stop: 'stoppt', restart: 'startet neu', remove: 'wird entfernt' }
```

`InventoryAction` ist `'start' | 'stop' | 'restart' | 'remove'`. `pause`/`unpause` aus der Spec gibt es nicht.

### 1.17 Main (Tasks 1D, 1E, 1F)

```ts
// main/ssh/client-config.ts
export class AgentError extends Error {}            // thrown by agentSocket() instead of Error
// main/ssh/known-hosts.ts
export class HostKeyError extends Error {
  constructor(message: string, readonly kind: 'changed' | 'store' = 'store',
    readonly fingerprints?: { expected: string; received: string }) { super(message); }
}
// main/ssh/session.ts
export interface ClassifiedError { code: ConnectionErrorCode; message: string; detail?: string }
export function classifyError(error: unknown): ClassifiedError;
export function publicError(error: unknown): string;   // = classifyError(error).message, strings unchanged
// private: finish(session, status, message?, failure?: { code: ConnectionErrorCode; detail?: string })
// main/kubernetes/access.ts
export async function openAccess(cluster: KubernetesConnectionNode, dependencies: AccessDependencies,
  onTry?: (name: string) => void): Promise<ClusterAccess>;   // onTry(connection.name) right before openRemote
// main/kubernetes/session.ts
export interface KubeSessionDependencies {
  openAccess: (cluster: KubernetesConnectionNode, onTry?: (name: string) => void) => Promise<ClusterAccess>;  // rest unchanged
}
```

`classifyError` bildet wörtlich ab (Reihenfolge der Prüfung):

| Fehler | `code` | `message` | `detail` |
|---|---|---|---|
| `HostKeyError` mit `kind: 'changed'` | `hostkey-changed` | `error.message` | `erwartet ${expected}\nerhalten ${received}` |
| `HostKeyError` sonst | `hostkey-store` | `error.message` | – |
| `AgentError` | `agent` | `error.message` | – |
| `LocalShellError`, `ContainerInputError` | `unknown` | `error.message` | – |
| `code` `ENOENT`/`EACCES` | `key-file` | heutiger Text | Rohtext |
| `ECONNREFUSED` | `refused` | heutiger Text | Rohtext |
| `ENOTFOUND`/`EAI_AGAIN` | `not-found` | heutiger Text | Rohtext |
| `level` `client-authentication` | `auth` | heutiger Text | Rohtext |
| `level` `client-timeout` oder `ETIMEDOUT` | `timeout` | heutiger Text | Rohtext |
| sonst | `unknown` | heutiger Sammeltext | Rohtext |

Rohtext = `error instanceof Error ? error.message.slice(0, 500) : undefined`, leer → weglassen. Die heutigen `publicError`-Strings bleiben Zeichen für Zeichen (sie hängen an `kubernetes/access.test.ts:116`).

---

## 2. Blocker mit Fix

| # | Blocker | Fix (bindend) |
|---|---|---|
| **B1** | 1B ändert `Toast.tsx`, aber `App.tsx:857` und `SecondaryWindow.tsx:113` rufen `<Toast message onClose>` bis 2A. Der Typecheck nach Welle 1 wäre rot. | 1B behält den Export `Toast({ message, onClose })` als **Bridge**: `useEffect(() => { if (message) notify.error(message); }, [message])` und rendert `<ToastStack />`. `onClose` wird angenommen und ignoriert. Die Bridge nutzt `toast-state.ts` nicht mehr, deshalb löscht 1B `toast-state.ts` und `toast-state.test.ts` (R0 nennt sie nicht). **2A** entfernt die Bridge aus `Toast.tsx` (2A ist in Welle 2 der einzige Besitzer der Datei). Zwischen Welle 1 und 2 erscheint ein erneut gesetzter gleicher Text nicht noch einmal. Das ist kein Release-Stand und wird hingenommen. |
| **B2** | `SshEvent` bekommt `step`. `TerminalPanel.tsx:105` liest im `else`-Zweig `event.status` und wäre ab 1C ein Typfehler. | 1C ändert in `TerminalPanel.tsx` genau Zeile 105 zu `} else if (event.type === 'status') {`. Sonst ändert 1C an der Datei nichts; 2B besitzt sie in Welle 2. Weitere Verwender von `SshEvent` (Main-Tests, Preload) unterscheiden schon nach `type` und bleiben grün. `local-shell.test.ts:64` (`events.at(-1)` ist `toEqual` ohne `code`) bleibt grün, weil lokale Shells nie `closed-by-server` senden (K6). |
| **B3** | R5 (`design-tokens.test.ts:156`) meldet `scaleX(0)`. Der Spec-Keyframe `toast-bar` (`scaleX(1→0)`) wäre rot. | `@keyframes toast-bar { to { transform: translateX(-100%); } }`. Der Toast bekommt `overflow: hidden` und schneidet den Balken an seinem Radius ab. Die Animation steht nur im `no-preference`-Block, unter `reduce` läuft `toast-bar-width` (`from { width: 100% } to { width: 0 }`). Ergebnis siehe 3.7. |
| **B4** | `main/kubernetes/ipc.ts` stand bei 1D (Zeile 77). 1E braucht aber dieselbe Datei für Zeile 44: Ohne Durchreichen von `onTry` kommt `trying` nie an. Das wäre ein Dateikonflikt in Welle 1. | `main/kubernetes/ipc.ts` gehört ganz zu **1E**: Zeile 44 wird `openAccess: (cluster, onTry) => openAccess(cluster, { getConnection, openRemote, sudoRejections }, onTry)`, Zeile 77 wird „Wähle eine SSH-Verbindung.“. 1D fasst die Datei nicht an. |
| **B5** | Die Spec löscht `terminal-ui.css:32` (`.split-terminal-stage .error-message`). Die Regel stylt aber auch `ResourceTable.tsx:248,257` und `ContainerTable.tsx:213` in der Bühne. | Zeile 32 **bleibt**. 2B entfernt nur das `.error-message` aus `TerminalPanel.tsx`. |
| **B6** | „Verbindung bearbeiten“ in der Fehlerkarte braucht einen Weg vom `TerminalPanel` zu `App.editNode`. U4 verbietet Änderungen an `SplitTerminalArea.tsx`, die Prop-Kette fehlt. | Modul `edit-request.ts` (1.8, Task 1B). `App.tsx` (2A) registriert `useEffect(() => onEditRequest(id => editNode(id)), [...])`. Die Karte zeigt die Aktion nur bei `canEditConnections() && connectionId !== LOCAL_CONTAINER_HOST`. Im Nebenfenster gibt es keinen Handler, die Aktion entfällt dort von selbst. |
| **B7** | `TerminalPanel` steckt auch in den Docks (`DetailDock.tsx:172`, `ContainerDock.tsx:157`). Die Karte würde nach 400 ms den Fokus aus der Tabelle ziehen, mitten in der j/k-Navigation. Esc auf der Karte würde zusätzlich das Kube-Kommando „back“ (`ClusterView` `onKeyDown`) auslösen. | Neue Prop `embedded?: boolean` (1.12). `DetailDock` (2D) und `ContainerDock` (2F) übergeben `embedded`. Karten nehmen nur bei `focused && visible && !embedded` den Fokus. Die Esc- und Enter-Handler der Karten rufen `preventDefault()` und `stopPropagation()`. |
| **B8** | `kube-menus.test.ts:281,347` erwartet bei `reconnecting` den Text `NOT_CONNECTED_MESSAGE`. Mit `RECONNECTING_MESSAGE` wird die Suite rot, und die Tests standen in keiner Task. | 2D besitzt `kube-menus.test.ts` und `kube-commands.test.ts` und stellt die beiden Erwartungen auf `RECONNECTING_MESSAGE` um. Neue Fälle: `actionReason` mit `reconnecting: true` und `connectedReason` bei `reconnecting`. |
| **B9** | Die Aktion „Erneut versuchen“ im Fehler-Toast von `persistVault` ruft später `persistVault(updatedVault)` mit einem alten Stand auf. Lief inzwischen eine andere Speicherung durch, überschreibt der Klick sie, und Daten gehen verloren. | `App.tsx` führt `vaultRef` (`useRef`, bei jedem Render auf `vault` gesetzt). Die Aktion speichert nur, wenn `vaultRef.current === previousVault`. Sonst meldet sie `notify.info('Nicht erneut gespeichert', { body: 'Der Vault hat sich inzwischen geändert. Wiederhole die Änderung.' })`. |

**Grün nach jeder Welle**, geprüft für jede Vertragsänderung:

- **Welle 1:** `ClusterStatus`, `SftpEvent` und `SshEvent.status` bekommen nur optionale Felder; der einzige Bruch ist `step`, abgefangen durch B2. Die `openAccess`-Signatur bleibt mit einem optionalen dritten Parameter kompatibel (`access.test.ts`, `session.test.ts` mit `vi.fn(async () => …)`). `HostKeyError` hat einen optionalen zweiten und dritten Parameter. `toast-state` wird mit seinem Test gelöscht. `Toast` bleibt per Bridge erhalten (B1).
- **Welle 2:** `container-view.ts` ändert `busy` von `string[]` auf `Record`. Alle Verwender (`ContainerTable.tsx:192`, `ContainerView.tsx:106,112,123`, `container-view.test.ts:30,227-232`) gehören zu 2F. `container-tree.ts` hat ein eigenes `busy` und bleibt unberührt. `useTabTransfer` verliert `onError`; beide Aufrufer gehören zu 2A. `TerminalPanel` bekommt `embedded`; 2D und 2F übergeben die Prop, die erst 2B anlegt. Deshalb wird 2B zuerst committet (Commit-Reihenfolge unten).
- **Welle 3:** `ui-text.test.ts` (3B) wird erst grün, wenn 3C `FilesPanel.tsx:212` und `RdpPanel.tsx:23` umgestellt hat. Beide liegen in derselben Welle, das Gate nach der Welle ist grün.
- **Commit-Reihenfolge innerhalb der Wellen** (jeder Einzel-Commit soll typecheck-fähig sein): Welle 1: 1C → 1A → 1B → 1D → 1E → 1F (1B nutzt Token-Namen aus 1A, R18; 1D und 1E nutzen Typen aus 1C). Welle 2: 2B → 2A → 2D → 2E → 2F. Welle 3: 3C → 3B → 3A.

---

## 3. Korrekturen und Entscheidungen (wörtliche Texte)

### 3.1 Meldungskanal

- **K1** `Notice` ohne `ttl`. Die Laufzeit kommt nur aus dem CSS: `.toast[data-tone='info'] .toast-bar` nutzt `--notice-ttl-info`, `ok` nutzt `--notice-ttl-ok`, Fehler haben keinen Balken. Ende per `animationend` → `noticeStore.close(id)`. Der Austritt läuft wie heute über `.is-closing`; `transitionend` (opacity) oder ein Fallback nach 300 ms → `noticeStore.remove(id)`.
- **K2** Pause: `.toast-stack.is-held` (nicht `:hover` im CSS, sonst schlägt R8 an) bei `mouseenter` bis `mouseleave` und solange `document.hidden`. Regel: `.toast-stack.is-held .toast-bar { animation-play-state: paused; }`.
- **K3** `<ToastStack />` rendert in `App.tsx` auf **beiden** Bildschirmen (Startkarte und Vault), denn „Keine Vault-Datei“ (`App.tsx:231`) kommt auch auf der Startkarte vor. In `SecondaryWindow.tsx` rendert er einmal.
- **K4** Alle Fehler der Startkarte laufen inline über `formError` (`.error-message` bleibt): `App.tsx:295, 300, 307, 331, 346, 351, 368, 389`. Die Spec nennt nur drei davon. `navigateTo`/`resetForm` setzt `formError` auf `null` und ruft `clearNotices()`.
- **E1** Gleiche sichtbare Meldung (Ton, Titel, Text) erneut gemeldet: die alte geht über `leaving` hinaus, die neue kommt ans Ende und ihr Balken startet neu.
- **E2** Der Schließen-Knopf zeigt weiter den Text `Schließen` (kein „×“) und hat `aria-label="Meldung schließen"`.
- **E3** `notify.info` darf eine Aktion tragen (Sekundär-Button). `notify.ok` trägt keine.

Zuordnung (App.tsx, SecondaryWindow.tsx, useTabTransfer.ts; Titel · Text):

| Stelle | Ton | Titel | Text |
|---|---|---|---|
| App 231 | info | `Keine Vault-Datei` | „Hier lassen sich nur Vault-Dateien (.term) öffnen. Dateien für Server ziehst du in die Serverseite eines Dateibrowsers.“ |
| App 410/417 | inline `folderError` (`.field-error`, `aria-invalid` am Feld, Fokus aufs Feld) | – | „Wähle einen Ordner oder die Vault-Ebene aus.“ / „Gib einen Ordnernamen ein.“ |
| `persistVault` | error, Aktion `Erneut versuchen` (B9) | Parameter `failureTitle`, Vorgabe `Vault nicht gespeichert`; `saveWorkspace`/`renameWorkspace` → `Workspace nicht gespeichert`; `deleteWorkspace` → `Workspace nicht gelöscht` | `getErrorMessage(error)` (3.5) |
| App 557 | error | `Fenster nicht wiederhergestellt` | „Nicht alle Fenster des Workspaces konnten geöffnet werden.“ |
| App 562, SW 72 | info | `Verbindungen übersprungen` | `skippedNotice(n)` |
| App 564 | error | `Workspace nicht geöffnet` | Meldung oder „Der Workspace konnte nicht geöffnet werden.“ |
| SW 74 | error | `Fenster nicht wiederhergestellt` | Meldung oder „Das Fenster konnte nicht wiederhergestellt werden.“ |
| App 610/654/665/683/714, SW 82 | info | `sessionLimitNotice().title` („Maximal 16 Sessions“) | `sessionLimitNotice().body` („Schließe zuerst einen Tab.“) |
| App 618/652/663/676/716, SW 81 | info | `Verbindung deaktiviert` | `disabledNotice(node)` |
| App 620 | error | `Cluster nicht geprüft` | Meldung oder „Der Kubernetes-Cluster konnte nicht geprüft werden.“ |
| App 702 | info | `Nichts zu verbinden` | „Der Ordner „X“ enthält keine Verbindungen.“ / „Alle Verbindungen im Ordner „X“ sind deaktiviert.“ |
| App 707-709, Limit greift, `free > 0` | info | `Nur ${free} von ${n} Verbindungen geöffnet` | „Maximal 16 Sessions gleichzeitig.“ + bei `disabled` ein Leerzeichen und `skippedNotice(disabled)` |
| dto., `free === 0` | info | `Keine Verbindung geöffnet` | `sessionLimitText()` |
| dto., nur übersprungen | info | `Verbindungen übersprungen` | `skippedNotice(disabled)` |
| App 724 | error | `Nicht verschoben` | Meldung oder „Verschieben fehlgeschlagen.“ |
| useTabTransfer 36/52 | error | `Tab nicht verschoben` | `errorText(error)` |
| SW 39 | error | `Verbindungsliste nicht verfügbar` | „Ist der Vault gesperrt?“ |
| `saveWorkspace` Erfolg | ok | `Workspace „${name}“ gespeichert` | `workspaceSummary(workspace)` (z. B. „2 Ansichten · 6 Tabs“; das Format liefert `terminal-views.ts`) |

Statusleiste: `{busy ? 'Speichert …' : savedNotice || 'Vault geöffnet'}`.

TerminalPanel-Meldungen (2B; die `.error-message`-Box entfällt):

| Fall | Ton | Titel | Text |
|---|---|---|---|
| Kopieren der Auswahl fehlgeschlagen | error | `Nicht kopiert` | „Der markierte Text konnte nicht kopiert werden.“ |
| Einfügen fehlgeschlagen | error | `Nicht eingefügt` | „Die Zwischenablage konnte nicht eingefügt werden.“ |
| Eingabe > 256 KiB | info | `Eingabe zu groß` | „Füge kleinere Abschnitte ein.“ |
| Eingabe nicht gesendet | error | `Eingabe nicht gesendet` | „Prüfe die Verbindung.“ |
| Übernahme (`sshAttach`) fehlgeschlagen | Fehlerkarte `unknown` | – | Meldung „Die Sitzung konnte nicht übernommen werden.“ |
| Fingerprint kopiert | ok | `Fingerprints kopiert` | – |
| Fingerprint nicht kopiert | error | `Nicht kopiert` | „Die Zwischenablage ist nicht verfügbar.“ |

### 3.2 Verbindungszustand im Bereich (2B)

- **K5** Die Karte erscheint **ohne Übergang** (keine `@starting-style`). Grund: Sie folgt oft auf Enter im Baum, und CLAUDE.md verbietet Bewegung nach Tastatur-Aktionen; der Prototyp hält es genauso („the connecting card can come from Enter, so it stays instant“). U12 bleibt mit dem 400-ms-Timer, die Gate-Zeile in 2.7 heißt „Warteanzeige, nicht animiert“.
- **K6** `closed-by-server` gibt es nur für ssh2-Sessions (Terminal, Container über SSH, SFTP): bei `stream.on('close')` mit `!session.typed` und bei `client.on('close')`, solange die Session aktiv ist. Lokale Shells, Pod-Terminals und lokale Container senden bei `closed` nie einen `code`.
- **K7** (siehe 3.6, Kube).
- **K8** Die Fehlerkarte ersetzt die Verbindungskarte. Kein roter Schritt, wie im Prototyp. Manueller Test (1) lautet: „Karte nach 400 ms, dann Fehlerkarte ‚Verbindung abgelehnt‘ mit Details“.
- **K9** Abbrechen ohne bekannte Session-ID (prepare läuft noch): Das Panel merkt sich `cancelled`. Kommt die ID an, folgt sofort `sshClose`, der Zustand wird `closed` mit Grund `cancel`. Abbrechen mit ID: zuerst Grund `cancel` setzen, dann `sshClose`.
- **K10** Neu verbinden und Erneut verbinden: zuerst `adoptRef.current = undefined`, dann `setAttempt(n + 1)`. Der Effekt hängt an `[connection.id, kubeKey, tabId, onStatusChange, attempt]` und meldet bei `attempt > 0` `setStatus('connecting')` und `onStatusChange(tabId, 'connecting')`. **E4:** Der xterm wird dabei neu erzeugt, der alte Bildschirminhalt geht verloren (Stufe 1, akzeptiert).
- **K11** Schritte je Session: `steps = connection.protocol === 'ssh' && !connection.kube && connection.id !== LOCAL_CONTAINER_HOST ? ['reach','hostkey','auth','shell'] : ['shell']`. `remote` für die Fehlerkarte: `connection.protocol === 'ssh' || 'sftp' || 'rdp'` und nicht `LOCAL_CONTAINER_HOST`.
- **K12** Main-Schritte (1D): `step: 'reach'` direkt vor `client.connect(config)`; `step: 'hostkey'` beim ersten Aufruf des `hostVerifier`-Callbacks; `step: 'auth'` nach `callback(true)`, nur wenn die Session aktiv ist; `step: 'shell'` in `client.once('ready')`. Lokale Shell, lokaler Container und Pod-Terminal senden `step: 'shell'` am Anfang ihres `start…`-Zweigs. Steps gehen über `dependencies.emit(session.ownerId, …)` und sind damit an den Besitzer gebunden.
- **K13** `hostkey-rejected` entsteht an der Stelle `!valid` (`session.ts:197`, `sftp-session.ts` analog): `finish(session, 'error', 'Der Server-Schlüssel wurde nicht bestätigt.', { code: 'hostkey-rejected' })`.
- **K14** `limit`: Weist eine IPC-Zurückweisung (`sshPrepare`) genau den Text `sessionLimitText()` auf, setzt der Renderer `code: 'limit'`. Jede andere Zurückweisung gilt als `unknown` mit dem bereinigten Text als `message` (**E5**).
- **E6** „Fingerprint kopieren“ kopiert `detail` wörtlich (beide Zeilen `erwartet …`/`erhalten …`). Fehlt `detail`, entfällt die Aktion und `retry` wird Primär.
- Die Esc-Taste wirkt nur auf der Verbindungskarte (Abbrechen). Enter wirkt auf den fokussierten Primär-Button der Fehlerkarte oder auf „Neu verbinden“ der Leiste (natives Klick-Verhalten). Beide Handler haben `stopPropagation()` (B7).
- **K15** `.terminal-panel { position: relative; }` kommt in `terminal-ui.css` (2B), damit die Overlays auch in Dock-Terminals ihren Bezug haben. In der Bühne gewinnt `.split-terminal-stage > .terminal-panel { position: absolute }` per Spezifität. R13 erlaubt `position`.
- **K16** RDP (3C) bekommt **keine** Verbindungskarte: Die native Fläche liegt bei `connecting` über dem Platzhalter (`RdpPanel.tsx:36`) und würde sie verdecken. RDP nutzt `ConnectionErrorCard` (`code: 'unknown'`, `message` = Helfer-Text, kein `detail`) und `DisconnectedBar`. SFTP (3C) bekommt ebenfalls keine Verbindungskarte. Es behält den Bereichshinweis mit `statusWord('connecting', 'long', { name })` und nutzt bei `error` die Fehlerkarte mit `code`/`detail` aus `SftpEvent`, bei `closed` die Leiste (`reason: code === 'closed-by-server' ? 'server' : 'session'`).

Wörtliche Texte der Karten:

| Element | Text |
|---|---|
| Kartentitel | `Verbinde mit ${name} …` |
| Adresszeile | `connection.address` (in `--font-mono`) |
| Schritte | `Server erreichen` · `Server-Schlüssel prüfen` · `Anmelden` · `Shell öffnen` (keine Notizen in Stufe 1) |
| Zeit je Schritt | `formatSeconds`, z. B. `0,4 s` |
| Fuß | `Gesamt 1,2 s`; ab 1,5 s im aktiven Schritt: `Der Server antwortet langsam …` (aktiver Schritt ist `reach`) oder `Dauert länger als üblich …` |
| Button | `Abbrechen` mit `<kbd>Esc</kbd>` |
| Fehlerkarte Details | `Details` / `Details ausblenden` (nur mit `detail`) |
| Leiste | `Verbindung getrennt · ${formatAgo} · der Server hat sie beendet` (server) / `· die Sitzung wurde beendet` (session) / `· abgebrochen` (cancel); Button `Neu verbinden` mit `<kbd>Enter</kbd>` |

**K17** `DisconnectedBar` animiert nur bei `reason: 'server'`. Bei `session` erscheint sie sofort: Der Nutzer hat selbst `exit` getippt, und Tastatur bewegt nie etwas. Der Tick läuft sekündlich, nur solange das Panel sichtbar ist.

### 3.3 Fehlerkarte je Code (`connectionError`, Beispiel `deploy@10.0.4.21:22`)

| Code | Titel | Text | Nächster Schritt | Primär · Sekundär |
|---|---|---|---|---|
| `auth` | Anmeldung abgelehnt | Der Server hat die Anmeldung als „deploy“ nicht angenommen. (ohne Benutzer: Der Server hat die Anmeldung nicht angenommen.) | Prüfe Benutzer und Anmeldung in den Verbindungseinstellungen. | edit · retry |
| `timeout` | Server antwortet nicht | 10.0.4.21:22 hat nicht rechtzeitig geantwortet. | Prüfe VPN, Firewall und Port. Möglicherweise ist der Rechner aus. | retry · edit |
| `hostkey-changed` | Server-Schlüssel hat sich geändert | Der Fingerprint stimmt nicht mit dem bestätigten überein. Shellherd hat die Verbindung abgebrochen. | Kläre den Schlüsselwechsel mit dem Administrator, bevor du fortfährst. | copy · retry |
| `hostkey-rejected` | Server-Schlüssel nicht bestätigt | Du hast den Schlüssel von 10.0.4.21:22 nicht bestätigt. | Verbinde erneut und vergleiche den Fingerprint mit einer vertrauenswürdigen Quelle. | retry · edit |
| `hostkey-store` | Server-Schlüssel nicht geprüft | `message` oder „Die gespeicherten Server-Schlüssel sind nicht verfügbar.“ | Prüfe die Zugriffsrechte auf den Shellherd-Datenordner und verbinde erneut. | retry |
| `refused` | Verbindung abgelehnt | 10.0.4.21 nimmt auf Port 22 keine Verbindung an. (ohne Port: 10.0.4.21 nimmt keine Verbindung an.) | Prüfe Host und Port. Läuft der SSH-Dienst? | retry · edit |
| `not-found` | Host nicht gefunden | Der Name „10.0.4.21“ ließ sich nicht auflösen. | Prüfe Schreibweise, DNS und VPN. | edit · retry |
| `key-file` | Schlüsseldatei nicht lesbar | Die private Schlüsseldatei fehlt oder ist nicht lesbar. | Prüfe Pfad und Zugriffsrechte in den Verbindungseinstellungen. | edit · retry |
| `agent` | Kein SSH-Agent | Es läuft kein SSH-Agent, der den Schlüssel liefern könnte. | Starte den Agent oder wähle Passwort oder Schlüsseldatei. | edit · retry |
| `limit` | Maximal 16 Sessions (`MAX_SSH_SESSIONS`) | Alle Sessions sind belegt. | Schließe zuerst einen Tab. | retry |
| `closed-by-server` | Verbindung beendet | Der Server hat die Verbindung beendet. | Verbinde neu, wenn du weiterarbeiten willst. | retry |
| `unknown` | Verbindung fehlgeschlagen | `message` oder „Die Verbindung ist fehlgeschlagen.“ | nur bei `remote`: Prüfe Host, Benutzer und Anmeldung. | retry · edit |

- **K18** Der `auth`-Text ist neutral gegenüber der Anmeldemethode: Der Renderer kennt die Methode nicht (Spec 2.3 lässt die Notiz selbst weg). `key-file` nennt keinen Pfad im Text, der Pfad steht im Rohtext der Details. Der Prototyp-Wortlaut „mit dem gespeicherten Schlüssel“ entfällt.
- Ist `edit` nicht verfügbar (B6), entfällt die Aktion. War sie Primär, rückt die Sekundäraktion auf.
- **K19** `known-hosts.ts`: Der Text der Zeile 50 wird „Der Server-Schlüssel hat sich geändert. Verbindung abgebrochen. Kläre die Änderung mit dem Server-Administrator.“ Er wirft `new HostKeyError(text, 'changed', { expected: previous, received: fingerprint })`. Der Fall „zwischenzeitlich geändert“ (Zeile 59) wirft ebenfalls `kind: 'changed'` mit `{ expected: stored.hosts[address], received: fingerprint }`. Die Lese- und Schreibfehler bleiben `kind: 'store'`. Die Fingerprints stehen **nicht** in `message`: Sonst landeten sie in den Kube-Zugangsfehlern (`access.ts:111`).
- **K20** `classifyError` hat keinen Methoden-Parameter. Für die Agent-Erkennung wirft `agentSocket` die neue `AgentError` (`client-config.ts` geht an 1D). Ein Agent, der auf Windows nicht läuft, endet in ssh2 als `client-authentication` und damit als `auth`, das wird hingenommen.

### 3.4 Statuswörter und Textregeln

`statusWord` (1C):

| Status | `short` | `long` (ohne `name`) | `long` mit `name` |
|---|---|---|---|
| connecting | `Verbindet …` | `Verbindet …` | `Verbinde mit web-01 …` |
| connected | `Verbunden` | `Verbunden` | `Verbunden` |
| closed | `Getrennt` | `Verbindung getrennt` | `Verbindung getrennt` |
| error | `Fehler` | `Verbindung fehlgeschlagen` | `Verbindung fehlgeschlagen` |

Mit `protocol`: `${protocol}: ${wort}`, z. B. `RDP: Verbunden`, `SFTP: Verbindet …`. Nutzer: `TerminalTabs.tsx` (title und aria-label, short), Live-Span in `TerminalPanel` (long, mit name), `RdpPanel` (long, protocol 'RDP'), `FilesPanel` (long, protocol 'SFTP').

Umschreibungen ohne „Bitte“: wie Spec 2.4, mit diesen Korrekturen:

- **K21** `main/rdp/ipc.ts:43` (nur Host): „Speichere einen Host, bevor du die Verbindung startest.“ `main/ssh/session.ts:150` und `main/files/sftp-session.ts:65`: „Speichere Host und Benutzername, bevor du die Verbindung startest.“ `session.ts:438`: „Zu viele Terminaleingaben. Warte kurz.“
- Limit-Texte im Main: `ssh/session.ts:141` und `rdp/host.ts:68` → `sessionLimitText()`; `sftp-session.ts:62` → `sessionLimitText(MAX_SFTP_SESSIONS)`. `ConnectionPicker.tsx:83` (2F) → `sessionLimitText()`.
- `VaultTree.tsx:125` „Gib einen Namen ein.“ · `:129/130` „Nicht umbenannt.“ · `WorkspaceControls.tsx:62` „Gib einen Workspace-Namen ein.“ · `:56/57/66/67` „Nicht gespeichert.“ · `:118` „Nicht gelöscht.“ · `ConnectionForm.tsx:95` „Nicht gespeichert. Deine Eingaben bleiben erhalten.“ · `PermissionsDialog.tsx:53` „Gib drei oder vier Ziffern von 0 bis 7 ein, z. B. 644.“. Alle übrigen Zeilen wörtlich wie Spec 2.4.
- Lint `ui-text.test.ts` (3B): Regexe wie in der Spec; die Kommentar-Entfernung entfernt `/* … */` und `//` nur am Zeilenanfang oder nach Leerraum (nicht in `https://`). Der Grep belegt: Nach Welle 2 und 3C bleiben null Treffer. Fixture positiv/negativ im Test selbst.

### 3.5 Vault-Speicherfehler

- **K22** Die Ursachentexte enthalten **keinen Pfad** (1.6). Der Toast heißt z. B. `Workspace nicht gespeichert` · „Die Vault-Datei ist schreibgeschützt.“ · `Erneut versuchen`. Der Prototyp-Pfad entfällt. Grund: kein Pfad-Parsing im Renderer und kein zweiter Textbaukasten. `main/vault/ipc.ts` (`saveCurrentVault`) fängt Fehler von `vaultSessionManager.save` ab: `const message = vaultWriteMessage((error as NodeJS.ErrnoException)?.code); throw message ? new Error(message) : error;`. Andere Handler bleiben unverändert. ENOENT heißt „nicht erreichbar“, weil `mkdir({ recursive: true })` einen gelöschten Ordner neu anlegt. ENOENT bleibt also nur bei fehlendem Laufwerk oder Netzpfad.
- `getErrorMessage` (2A): Bei `authenticate`/`Unsupported state` bleibt es wie heute. Sonst wird das IPC-Präfix gestrippt (`/^Error invoking remote method '[^']+': (?:Error: )?/`); ist der Rest `isVaultWriteMessage`, wird er durchgereicht, sonst kommt „Der Vault konnte nicht verarbeitet werden.“.

### 3.6 Cluster-Leiste

- **K7** `ClusterStatus.since` entfällt; das Alter kommt aus `updatedAt` des Reducers (Spec 2.5 nutzt ohnehin dieses Feld). Main (1E): `status()` liefert bei `state === 'reconnecting'` `attempt: this.attempt + 1`. Die interne Zählung, `retryNow` und `scheduleRetry` bleiben unverändert, die Backoff-Indizes ändern sich nicht. `trying` setzt `establish` über `onTry` (danach `emitStatus()`). Gelöscht wird es in `setReady()` und im `catch` von `retryNow` und `connectFirst`, jeweils vor `setState`. `host` bleibt der letzte erfolgreiche Zugang.
- **K23** Texte (`connbar`):

| Lage | Ton | Text links | Text rechts |
|---|---|---|---|
| `status` null oder `connecting` | off | `Verbinde …` bzw. `Verbinde über ${trying} …` | – |
| `ready` | live | `Live` | `updatedAt` 0 → leer; Alter < 15 s → `gerade aktualisiert`; sonst `Stand vor ${n} s` bzw. ab 60 s `Stand vor ${m} min` |
| `ready`, `now - recoveredAt < 3000` | ok | `Wieder verbunden über ${host}` | wie ready |
| `reconnecting`, `now - reconnectingSince < 2000`, mit `host` | warn | `${host} antwortet nicht. ` + (`trying && trying !== host` ? `Verbinde über ${trying} …` : `Verbinde neu …`) | `Stand vor …` wie oben |
| `reconnecting` danach | warn | `trying` ? `Verbinde über ${trying} … (Versuch ${attempt})` : `Verbinde neu … (Versuch ${attempt})` | `Stand vor …` |
| `error` | off | `Nicht verbunden` | – |

- Fläche: warn `--color-warn-bg`, Rand `--color-warn-border`, Punkt `--color-warn`; ok `--color-ok-bg`, Punkt `--color-ok`; live Panel-Fläche, Punkt `--color-ok`; off Panel-Fläche, Punkt `--color-text-muted`. Keine Transition (U3). `min-height: var(--control-sm)`, `role="status"`.
- Kopfzeile `ClusterView.tsx:296-301`: `reconnecting` zeigt dort nichts mehr (die Leiste übernimmt). `connecting` bleibt „verbinde …“, `ready` bleibt „bereit über host“, `error` bleibt mit „Erneut versuchen“. `.kube-stale` (Klasse und CSS-Zeilen 35-36) entfällt.
- **K24** Der Hinweis `RECONNECTING_MESSAGE` gilt für alle wegen der Verbindung gesperrten Einträge (verändernde Aktionen, Logs/Describe/Shell-Einträge, `shellUnavailable`), nicht nur für die verändernden. `NOT_CONNECTED_MESSAGE` bleibt für `connecting` und `error`.

### 3.7 Motion gegen `design-tokens.test.ts`

| Prüfpunkt | Ergebnis |
|---|---|
| `toast-bar` mit `scaleX(1→0)` | **rot (R5)**, ersetzt durch `translateX(-100%)` (B3) |
| `animation: toast-bar var(--notice-ttl-info) linear forwards` im `no-preference`-Block | grün: R7b ist gegatet, R4 hat keine Literal-ms, R3 erlaubt `linear` |
| `toast-bar-width` (`width 100%→0`) unter `reduce` | grün: `width` steht nicht in `TRANSFORM_PROPS`, der Keyframe gilt nicht als bewegt. Die R7b-Regex `(?<![\w-])toast-bar(?![\w-])` trifft `toast-bar-width` nicht (Lookahead auf `-`) |
| `@starting-style { .busy-face.is-fresh { opacity: .4 } }` mit `transition: opacity var(--dur-fade) var(--ease-out)` | grün: R7b greift in `@starting-style` nur bei Transform-Eigenschaften. R7 braucht einen `prefers-reduced-motion`-Block in `busy-button.css`, den liefert die Puls-Regel |
| `.busy-dot { animation: tm-pulse var(--dur-pulse) var(--ease-in-out) infinite }` | grün: `tm-pulse` bewegt nichts (nur opacity), das Muster steht schon in `navigation-ui.css:71` |
| `.connect-error` `scale(.97)` per `@starting-style` | grün nur im `no-preference`-Block (Transform-Startwert und `transition: … transform`), Muster wie `toast-ui.css:9-12` |
| `.connect-closed:not([data-instant])` `translateY(100%)` | dto. Der Selektor enthält keine Bühnenklasse, R13 bleibt grün |
| Tokens `--notice-ttl-info: 5000ms`, `--notice-ttl-ok: 3000ms` | grün: R4 prüft in `tokens.css` nur `/^--dur-/`. **Nicht** `--dur-notice-*` nennen (>300 ms wäre R4) |
| `--size-dot: 8px`, `--color-warn-bg`, `--color-ok-bg` | grün: R9 verlangt nur die 31 Namen und verbietet Aliase, neue Namen sind erlaubt. R17 betrifft nur `--space-*`/Leisten. R18 grün, weil die Namen deklariert sind |
| `.chevron.is-up { transform: rotate(180deg) }` ohne Transition | grün: R7b greift nur bei `:active`, `@starting-style` oder Motion-Eigenschaften |
| `.toast-stack.is-held .toast-bar { animation-play-state: paused }` | grün; `:hover` im Selektor wäre R8 (deshalb die Klasse, K2) |

- **K25** BusyButton: Das sichtbare Label ist ein Span `.busy-face` mit `key={zustand}`. Die Klasse `is-fresh` bekommt es nur nach dem ersten Zustandswechsel (`useRef`-Flag). Sonst blendete **jeder** Button beim Öffnen eines Dialogs ein, denn `@starting-style` greift bei jedem Einfügen. Die Breite halten drei `aria-hidden` Sizer-Spans (je Zustand, mit Punktplatz) in `display: inline-grid` mit einer gemeinsamen `grid-area`. **E7:** Unter `reduce` bleibt das Einblenden über die Opazität (wie Toast und Gate „nur Einblenden“), der Puls steht. Damit gilt die Gate-Zeile, nicht der abweichende Halbsatz in Spec 2.6.
- **K26** Der Punkt bei `done` nutzt `currentColor` und ändert die Farbe nicht. `--color-ok` auf Kupfer läge bei etwa 1,4:1, und der Text „Gespeichert“ trägt den Zustand. Damit gilt auch „Kupfer nie Zustand, Zustand nie auf Kupfer“.
- BusyButton-Labels: `ConnectionForm.tsx:206` `Verbindung speichern` / `Speichert …` / `Gespeichert`; `FolderEditor.tsx:54` `Änderungen speichern` / `Speichert …` / `Gespeichert`; `WorkspaceControls.tsx:89,113` `Speichern` / `Speichert …` / `Gespeichert`; `ConfirmDialog.tsx:43`, `ConfirmAction.tsx:87`, `PermissionsDialog.tsx:58`: nur `busy`, Label = Bestätigungstext (`confirmLabel`, `confirmation.confirmLabel`, `Übernehmen`), kein `doneKey`.
- CSS des BusyButton in **eigener Datei** `components/busy-button.css`, importiert von `BusyButton.tsx`. Weder `styles.css` noch `editor-ui.css` (Konflikt mit 2A).
- `.chevron` (SVG `m5 9 7 7 7-7`, 12 px, zeigt nach unten): **K27** Klasse `.chevron.is-up` statt `is-open`, denn die Richtung ist je Ort verschieden: `ProblemBanner` offen → `is-up`, `DetailDock`/`ContainerDock` geschlossen → `is-up`. Die Regel steht in `styles.css` (2A), damit 2D und 2F nur die Klasse nutzen.

### 3.8 Container-Zielzustand (2F)

- Status-Zelle bei busy: `BUSY_LABEL[action]` in `<span className="ctr-busy-status">` (`color: var(--color-warn)`). Arten ohne `status`-Spalte (images, volumes, networks): Die erste Spalte zeigt `${wert} · ${BUSY_LABEL[action]}`. `.ctr-busy` behält nur `cursor: progress`, kein `opacity`, kein `::after`. `aria-busy` bleibt.

### 3.9 Weitere Korrekturen

- 1A ändert `terminal-theme.test.ts` **nicht**: Der Test liest die Werte dynamisch; es reicht `terminal-theme.ts:3` → `{ background: '#0b1018', foreground: '#e6e2dc', cursor: '#e8935a', selectionBackground: '#3f2e22' }`.
- `terminal-ui.css:15` → `width: var(--size-dot); height: var(--size-dot); flex: 0 0 var(--size-dot);` (2B). `navigation-ui.css:68` dasselbe (1A).
- Plan „PR auf GitHub gegen `main`“ widerspricht dem Skill (gestapelter PR auf git.example per Gitea-API, Basis voriger Feature-Branch). Es gilt der Skill.
- **E8** „Live“ bleibt als Wort, wie im Prototyp.
- **E9** Das Gate bekommt eine Zeile `Verbindungskarte (.connect-card) · Warteanzeige · nicht animiert, erscheint nach 400 ms` (3A), statt „nur opacity per @starting-style“.
- **E10** `workspaceSummary` liefert „Ansicht/Tab“-Wörter (`terminal-views.ts`); das Prototyp-Beispiel „4 Bereiche, 6 Tabs“ ist nur illustrativ.

---

## 4. Sicherheit

| Punkt | Befund und Regel |
|---|---|
| Schritt-Events | Sie tragen nur `sessionId` und `step`. Gesendet wird über `dependencies.emit(session.ownerId, …)`, das bindet an den Besitzer wie `data`/`status`. Nach `transferOwner` gehen sie an den neuen Besitzer. Kein neuer Kanal, kein neues Schema (U6). |
| `code`/`detail` | `detail` = `error.message.slice(0, 500)` nur für Fremdfehler (ssh2/Node). Für eigene Fehler (`LocalShellError`, `ContainerInputError`, `AgentError`, `HostKeyError` `store`) fehlt `detail`. Nie `stack`, nie `config`, nie `error.toString()` mit Ursachen. ssh2-Meldungen zu Schlüsseln („Cannot parse privateKey …“, „Encrypted private OpenSSH key detected, but no passphrase given“) enthalten kein Schlüsselmaterial. Der Schlüsselpfad im ENOENT-Rohtext ist eine Nutzereingabe (Spec 3). Test in `session.test.ts`: `detail.length <= 500` und kein `password` aus der Testverbindung im `detail`. |
| Fingerprints | Die Fingerprints (öffentliche SHA256-Hashes) stehen nur in `detail` von `hostkey-changed`, nicht in `message` (K19). Der Kube-Pfad (`access.ts` `reason`) bleibt ohne sie. |
| Abbrechen | Nur über `sshClose` (`requireSshSender` + `owned()`). Main antwortet mit `status: 'closed'` ohne `code`. Der Abbruch vor der Session-ID ist in K9 geregelt; es bleibt keine verwaiste Session. Ein offener Host-Key-Dialog im Main ist modal, Abbrechen ist dort nicht erreichbar. `isActive()` verhindert ohnehin das Speichern nach dem Schließen. |
| Neu verbinden | Immer `sshPrepare` + `sshConnect` mit neuer ID. Die alte Session ist im Main schon `finish`ed (aus `sessions` gelöscht), `sshAttach` wird nicht wiederholt (K10 `adoptRef`). Das Limit zählt im Main weiter. |
| Kube-Status | `attempt` ist eine Zahl, `trying` der Name einer Vault-SSH-Verbindung (wie das bestehende `host`). Keine kubeconfig-Inhalte, kein Server, kein Kontext. `KubeOpenResult.status` bekommt die Felder ebenso. Die kubeconfig verlässt den Main weiter nicht (`ipc.ts:73`-Kommentar bleibt wahr). |
| Vault-Fehler | Feste deutsche Sätze ohne Pfad und ohne Rohtext. Andere Fehler fallen auf den Sammeltext zurück. |
| Zwischenablage | „Fingerprint kopieren“ nutzt das bestehende `writeClipboardText`. Es wird nur geschrieben, nicht gelesen. |
| Edit-Bus | `edit-request.ts` ist renderer-lokal, ohne IPC. Er öffnet nur den Editor; Speichern verlangt wie heute einen Klick. |

---

## 5. Wellen und Tasks (Dateien disjunkt je Welle)

Pfade ohne Präfix liegen unter `src/renderer/src/`. „nur …“ heißt: Der Rest der Datei bleibt unberührt.

### Welle 1 – Fundament (6 parallel)

| Task | Dateien (exklusiv) | Pflichtpunkte | Tests | Abhängig |
|---|---|---|---|---|
| **1A Tokens + Theme** | `tokens.css`; `terminal-theme.ts`; `components/ConnectionForm.tsx` (nur Z. 136 → `'#aeb3bc'`); `components/navigation-ui.css` (nur Z. 68 `--size-dot`, Z. 71 `--color-warn`); `assistant-ui.css` (nur Z. 26 → `--color-text-muted`); `styles.css` (nur Z. 112 → `--color-border-strong`) | Spec 2.1 komplett; neue Tokens `--color-warn-bg`, `--color-ok-bg`, `--size-dot`, `--notice-ttl-info`, `--notice-ttl-ok` mit Rollenkommentar | `design-tokens.test.ts`, `terminal-theme.test.ts` (unverändert grün) | – |
| **1B Notice-Store + Toast + Edit-Bus** | `notice-store.ts` (neu), `notice-store.test.ts` (neu), `edit-request.ts` (neu), `edit-request.test.ts` (neu), `components/Toast.tsx`, `components/toast-ui.css`; löschen: `toast-state.ts`, `toast-state.test.ts` | 1.7–1.9, B1-Bridge, K1, K2, E1–E3, B3 (Balken), S3-1/S3-2/U5 (kein Escape, kein Fokus, `useNativeSurfaceBlock(notices.length > 0)`), `.toast-stack` fixed mit `z-index: var(--layer-toast)`, `.secondary-shell .toast-stack` | `notice-store.test.ts` (push, max 3, Dublette, close, remove, unbekannte ID), `edit-request.test.ts`, `design-tokens.test.ts` | 1A (Token-Namen) |
| **1C Shared-Verträge** | `src/shared/ssh.ts`, `src/shared/connection-errors.ts` (neu) + `.test.ts`, `src/shared/sftp.ts` (nur `SftpEvent.status`), `src/shared/kubernetes.ts` (nur 1.4), `src/shared/vault/connections.ts` (+ `connections.test.ts`), `status-words.ts` (neu) + `status-words.test.ts`, `components/TerminalPanel.tsx` (nur Z. 105, B2) | 1.1–1.5, 1.10, Texte 3.3/3.4 | die genannten | – |
| **1D Main SSH** | `src/main/ssh/session.ts`, `session.test.ts`, `known-hosts.ts`, `known-hosts.test.ts`, `client-config.ts`, `src/main/files/sftp-session.ts`, `src/main/rdp/host.ts`, `src/main/rdp/ipc.ts` | 1.17 (`classifyError`, `AgentError`, `HostKeyError`), K6, K12, K13, K19–K21, Limit-Texte, `detail` ≤ 500 | `session.test.ts`: Reihenfolge `reach < hostkey < auth < shell < status connected` (Loopback); Auth-Fehler `code: 'auth'`, `detail` enthält „authentication“; `closed-by-server` bei Server-Exit ohne Eingabe; kein `code` bei Exit nach Eingabe; lokale Shell nur `step: 'shell'`. `known-hosts.test.ts`: `kind`/`fingerprints`. `sftp-loopback.test.ts` grün | 1C |
| **1E Main Kube** | `src/main/kubernetes/session.ts`, `session.test.ts`, `access.ts`, `access.test.ts`, `ipc.ts` | 1.17 `onTry`, K7, B4 (Z. 44 und Z. 77) | `access.test.ts`: `onTry` je probiertem Host in Reihenfolge, nicht für übersprungene; `session.test.ts`: nach Host-Ausfall `reconnecting` mit `attempt: 1`, nach erstem Fehlversuch `attempt: 2`, `trying` während `establish`, ohne `trying` nach `ready` | 1C |
| **1F Vault-Fehler** | `src/shared/vault/write-errors.ts` (neu) + `write-errors.test.ts`, `src/main/vault/ipc.ts` (nur `saveCurrentVault`) | 1.6, K22 | `write-errors.test.ts` (alle Codes, unbekannter Code, `isVaultWriteMessage`) | – |

### Welle 2 – Komponenten (5 parallel)

| Task | Dateien (exklusiv) | Pflichtpunkte | Tests | Abhängig |
|---|---|---|---|---|
| **2A App-Integration** | `App.tsx`, `SecondaryWindow.tsx`, `hooks/useTabTransfer.ts`, `components/Toast.tsx` (nur Bridge entfernen), `styles.css` (nur neue Regeln `.area-error`, `.chevron`, `.chevron.is-up`) | Tabelle 3.1, K3, K4, B6 (Edit-Handler), B9, 3.5 `getErrorMessage`, `clearNotices()` in `resetForm`, alle `setError(null)` weg, Statusleiste, ok-Toast beim Workspace-Speichern, `useTabTransfer(terminals, views)` ohne `onError` (meldet über `notify`) | Typecheck; vorhandene Suites grün | 1B, 1C, 1F |
| **2B Terminal-Karten** | `components/TerminalPanel.tsx`, `components/ConnectingCard.tsx`, `components/ConnectionErrorCard.tsx`, `components/DisconnectedBar.tsx`, `components/connection-ui.css`, `connect-timeline.ts` + `connect-timeline.test.ts` (neu), `terminal-ui.css` (nur Z. 15 und neue Regel `.terminal-panel { position: relative }`) | 1.11, 1.12, 3.2 komplett (K5, K8–K11, K14–K17, E4–E6), B5, B7 (`embedded`, `stopPropagation`), Tabelle TerminalPanel-Meldungen, `statusWord` im Live-Span, Tick nur bei `visible` | `connect-timeline.test.ts` (Schritte vor dem ersten Mark, done/active, Slow-Text für `reach` und andere, `formatSeconds`, `formatAgo` 1 s/59 s/60 s), `design-tokens.test.ts` (`connection-ui.css`) | 1A, 1B, 1C, 1D |
| **2D Cluster-Leiste** | `components/kubernetes/ClusterView.tsx`, `components/kubernetes/ClusterStatusBar.tsx` (neu), `cluster-bar.ts` + `cluster-bar.test.ts` (neu), `kube-view.ts`, `kube-view.test.ts`, `kubernetes-ui.css`, `kube-commands.ts`, `kube-commands.test.ts`, `kube-menus.ts`, `kube-menus.test.ts`, `components/kubernetes/NodeStrip.tsx`, `components/kubernetes/ProblemBanner.tsx`, `components/kubernetes/DetailDock.tsx` | 1.13, 1.14, 3.6 (K7 Renderer-Teil, K23, K24), B8, `.kube-stale` weg, `.kube-connbar*`, `.kube-dot` als `--size-dot`-Kreis aus `currentColor`, NodeStrip ohne Glyph, Chevron mit `.chevron`/`.is-up` (K27), `embedded` an `TerminalPanel` in DetailDock (B7) | `cluster-bar.test.ts` (jede Zeile der Tabelle K23), `kube-view.test.ts` (`updatedAt` aus `at`, Fallback `now`), `kube-menus.test.ts`, `kube-commands.test.ts` | 1A, 1C, 1E; 2B (Prop `embedded`) |
| **2E BusyButton + Formulare** | `components/BusyButton.tsx` (neu), `components/busy-button.css` (neu), `components/ConnectionForm.tsx` (außer Z. 136), `components/FolderEditor.tsx`, `components/WorkspaceControls.tsx`, `components/ConfirmDialog.tsx`, `components/PermissionsDialog.tsx`, `components/kubernetes/ConfirmAction.tsx`, `components/VaultTree.tsx`, `components/WorkflowsDialog.tsx`, `components/AiSettingsDialog.tsx`, `connection-form.ts`, `connection-form.test.ts`, `cluster-form.ts`, `cluster-form.test.ts`, `file-browser.ts`, `file-browser.test.ts`, `components/navigation-ui.css` (`.workspace-menu-error` entfernen; `.tree-error` bleibt für `ContainerChildren`) | 1.15, K25, K26, Labels 3.7, Texte 2.4 + 3.4 außer App/Terminal/RDP/SFTP, `.area-error` in `VaultTree.tsx:226` und `WorkspaceControls.tsx:109` (Klasse aus 2A), `doneKey` nach erfolgreichem `onSave` | `cluster-form.test.ts:43` → „Gib einen Namen an.“; `connection-form.test.ts`; `design-tokens.test.ts` (`busy-button.css`) | 1A, 1C |
| **2F Container** | `container-view.ts`, `container-view.test.ts`, `components/containers/ContainerTable.tsx`, `components/containers/ContainerView.tsx`, `components/containers/ContainerDock.tsx`, `containers-ui.css`, `components/ConnectionPicker.tsx` | 1.16, 3.8, Chevron (K27), `embedded` in ContainerDock (B7), Picker-Text `sessionLimitText()` | `container-view.test.ts` (busy mit Aktion, Ende ohne Aktion, idempotent, gleiche Referenz bei No-op) | 1A, 1C; 2B (Prop `embedded`) |

`styles.css` und `navigation-ui.css` fasst je Welle nur eine Task an (1A in Welle 1, 2A bzw. 2E in Welle 2). `terminal-ui.css` gehört nur 2B. `SplitTerminalArea.tsx`, `kubernetes-dock.css` und `files-ui.css` bleiben unberührt.

### Welle 3 – Abschluss (3 parallel)

| Task | Dateien (exklusiv) | Pflichtpunkte | Tests |
|---|---|---|---|
| **3A Doku + Version** | `docs/design-system.md`, `docs/handbuch.md`, `CHANGELOG.md`, `package.json`, `package-lock.json` (beide über `npm run version:minor` → 0.11.0), `release-notes.ts` | Roter Faden („was leuchtet, ist Kupfer“), Marke, Regel „Kupfer nie Zustand, Gelb nie Akzent“, Token-Tabelle mit neuen Tokens und Werten, Gate-Tabelle Spec 2.7 mit E9 und ohne `.kube-stale`, Ausnahme `ConnectionForm.tsx:136` → `#aeb3bc`, Meldungs-Muster Feld/Bereich/global, Regeln (400 ms, `--size-dot`, Chevron als SVG) | `version.test.ts` |
| **3B Text-Lint** | `ui-text.test.ts` (neu) | Spec 2.4 + 3.4 (Kommentar-Strip), leere Erlaubnisliste, Fixture positiv/negativ | sich selbst |
| **3C RDP, SFTP, Tabs** | `components/RdpPanel.tsx`, `components/FilesPanel.tsx`, `components/TerminalTabs.tsx` | K16, `statusWord` (3.4), „…“ statt „...“, Neu verbinden über `attempt` | Typecheck, `ui-text.test.ts` |

Gate nach jeder Welle: `npm run typecheck` und `npx vitest run`. Danach je Task ein Commit in der Reihenfolge aus Abschnitt 2.
