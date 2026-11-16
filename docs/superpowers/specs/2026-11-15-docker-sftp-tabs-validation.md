# SFTP-Eintrag je Host und Container-Shell als Tab: Validierung (bindend)

Prüfer: Opus, 2026-11-15. Geprüft wurden `2026-11-15-docker-sftp-tabs-design.md` und das Konzept `.superpowers/sdd/2026-11-15-docker-sftp-tabs-research.md` (K) gegen den Code auf `claude/feature/docker-sftp-tabs` (`b337195`, Vorab-Fix `3ea07d3` enthalten). Gelesen wurden `src/renderer/src/components/{ContainerChildren,VaultTree,LocalContainers,ConnectionIcon,SplitTerminalArea}.tsx`, `components/containers/{ContainerDock,ContainerView}.tsx`, `components/kubernetes/DetailDock.tsx` (Platzhalter zum Vergleich), `src/renderer/src/App.tsx` (`connectNode`, `openContainer`, `openContainerView`, `openPopout`, `containerTree`, Verdrahtung `:980-983`), `src/renderer/src/{terminal-tabs,container-tree,container-commands,container-menus}.ts`, `terminal-tabs.test.ts`, `components/navigation-ui.css`, `kubernetes-ui.css`, `styles.css`, `tokens.css`, `src/main/files/{sftp-session,ipc}.ts`, `src/main/containers/commands.ts`, `src/main/ssh/session.ts` (Ziel-Pfad, sudo), `src/shared/vault/types.ts`, `src/shared/locales/i18n-catalog.test.ts`, `src/shared/i18n.d.ts`, die Locale-Dateien `vault` und `containers`, `.claude/skills/run-app/{sshd,fixtures,screens,demo-setup,fakes.test}.mjs` und `SKILL.md`, `docs/design-system.md`, `docs/handbuch.md` (`:455-543`), `README.md` (`:37-38`) und `AGENTS.md`.

Ausgangslage: `npm run typecheck` ist grün. `npx vitest run`: 242 Dateien, 3979 Tests, 37 übersprungen. Unter Volllast fielen 1–2 zeitabhängige Tests aus (`src/main/files/sftp-loopback.test.ts` „opens a server file for editing …“, Timeout). Einzeln laufen sie grün (15/15). Das ist vorbestehend und kein Befund dieser Spec. Der Orchestrator wiederholt einen solchen Ausfall einzeln, bevor er ein Gate als rot wertet.

**Urteil: ready after corrections.** Es gibt 1 Blocker, 12 Korrekturen und 9 Entscheidungen bzw. Ergänzungen.

Dieser Anhang geht Spec und Konzept vor. Was hier nicht steht, gilt aus Spec und K weiter. §2 ersetzt K §3.3–§3.5 und K §4.2 (Platzhalter und Fake). §5 ersetzt K §3.4. §6 ersetzt K §7 und Spec „Wellen“.

---

## 0. Geprüfte Fakten (Grundlage der Befunde)

| Behauptung in K | Befund im Code | Folge |
|---|---|---|
| SFTP läuft ohne Terminal-Sitzung, mit Sprunghost, Prompts und Host-Key-Prüfung | Stimmt. `SftpSessionManager.open` (`sftp-session.ts:82-95`) baut einen eigenen ssh2-`Client`. `connect` (`:97-146`) öffnet bei `jumpHost` den Sprung über `openJump` (ohne Opener → `ssh.jumpHostUnusable`, kein stiller Direktweg) und prüft den Schlüssel über `verifyHost` → `knownHosts.verify` (`ipc.ts:107`, abgelehnt → `files.hostKeyRejected`). Keyboard-interactive geht über `prompts.ask` (`ipc.ts:108`), also über denselben Dialog wie im Terminal. Fehlt das Subsystem, folgt `files.noSftp` (`:122`). Nichts davon greift auf eine Terminal-Sitzung zu. | Feature 1 ist reine Navigation, Main bleibt unberührt (R9 bestätigt). |
| `planContainerView`/`sameTarget` tragen Dateien-Tabs | Stimmt. `toTerminalConnection(node, true)` ergibt `{ id, protocol: 'sftp', view: 'files' }` (`terminal-tabs.ts:24-27`). `sameTarget` vergleicht `id`, `view`, `runtime`, `target`, `kube` (`:67-70`). Shell-Tab (`view` undefined), Container-Ansicht (`'containers'`) und Container-Tab (`target`) desselben Hosts treffen also nie. `planContainerView` (`:79-85`) ist generisch, die Ordinale zählt der Reducer über `sameTarget` (`:119`). | Kein Umbau. Ein Test kommt dazu (E5). |
| Chevron nur für SSH-Hosts | Stimmt. `isHost` (`VaultTree.tsx:74`) verlangt `containers`, `type === 'connection'`, `protocol === 'ssh'`, nicht `disabled`, keine Suche. Das gilt **unabhängig von Docker**: Der Chevron steht vor jeder Erkennung, und auch „Keine Container-Laufzeit gefunden.“ zeigt die Kinder. `files-01` (`sftp`), RDP, Kubernetes und lokale Shells haben keinen Chevron. | Der Eintrag erscheint auch bei Hosts ohne Docker. Ausschlüsse ergeben sich aus `isHost`. |
| Zustandsnotizen sind frühe Rückgaben ohne `ul` | Stimmt (`ContainerChildren.tsx:33-39`). `.container-children` und `.vault-tree ul` haben `list-style: none; margin: 0; padding: 0` (`navigation-ui.css:3, 66`). `li > p` sieht also gleich aus. | K-Umbau ist optisch neutral (K11). |
| Risiko 1 („Dieser Computer“) | `LocalContainers` rendert nur bei `status === 'ready'` und `runtimeEntries(...).length > 0` (`LocalContainers.tsx:14`, `container-tree.ts:83-85`). Die drei Notiz-Zweige erreicht die lokale Liste nie. | Risiko 1 entfällt praktisch, die Szene `containers` bleibt Abnahme. |
| Baum-ARIA | Der Baum ist kein ARIA-`tree`: `nav > ul > li > div.vault-tree-row > button`, ohne `treeitem` und ohne Roving-Tabindex. Jede Zeile ist ein eigener Tab-Stopp, die Laufzeit-Zeilen ebenso. | Keine `treeitem`-Rollen in diesem Feature (E9). Die Fokusreihenfolge folgt dem DOM. |
| Chevron-Label | `vault:tree.runtimesShow` „Laufzeiten von {{name}} anzeigen“ (`VaultTree.tsx:177`). Mit dem Eintrag klappt der Chevron auch die Dateiansicht auf. | K3 |
| Shell als Tab existiert dreifach | Stimmt. Zeilenmenü `tab-shell` nur bei `running` (`container-menus.ts:92-101`). Dock-Knopf `.kube-dock-popout` ist sichtbar bei `terminalConnection && onPopout && !(shell && !running)` (`ContainerDock.tsx:195`), also **auch im Arm-Platzhalter**. `Strg+Umschalt+T` (`container-commands.ts:82-87`) läuft auch mit Fokus im Dock durch (`ContainerView.tsx:219`). Alle enden in `openTab` → `onPopout` → `App.openPopout` (`App.tsx:745-748`, nur Session-Limit). | Feature 2 ist nur Sichtbarkeit. |
| Arm-Schutz bleibt | `onArm` setzt nur den Dock-Zustand. `popout()` (`ContainerView.tsx:137-144`) liest `selected` und `state.dock`, berührt `armed` nicht und prüft dieselben Gründe wie `Strg+Umschalt+T`. Für Container gibt es weder `readOnly` noch `production` (beides nur `KubernetesConnectionNode`, `types.ts:159-160`) und keine Bestätigung für Shells (`confirmationFor` nur für Aktionen). | Der neue Knopf umgeht keine Absicherung (§2.4). |
| Fake-Befehl `^docker exec -it …` | **Falsch.** Main sendet `remoteCommand(terminalArgv(target), sudo)` (`session.ts:314`). Bei `sudo: none` ist das `PATH="$PATH:/usr/sbin:/sbin" docker exec -it api sh -c 'command -v bash >/dev/null 2>&1 && exec bash \|\| exec sh'` (`commands.ts:9, 11, 31, 79`), bei `noninteractive` mit `sudo -n ` davor. Ein `^docker`-Muster trifft nie. | B1 |
| `serveShell(stream, { prompt })` | `serveShell` schreibt `banner + prompt` (`sshd.mjs:180`). Ohne `banner` erscheint `undefined/ # `. | K5 |
| Namen aus `LISTS` | `LISTS` ist ein Objekt aus vier Listen (`sshd.mjs:38`). Die Containernamen stehen in `CONTAINERS[].Names` (`fixtures.mjs:17-24`, `api`, `worker`, `redis`, `db` laufen, `migrate` und `cron-legacy` sind beendet). Der Container-`ref` ist der Name (`shared/containers.ts:44`). | K5 |
| Zeilenverweise | `sshd.mjs:103` → `:104`, `:152` → `:153`, `:284-295` → `:280-296`. Die übrigen Verweise in K stimmen. `SKILL.md:25` fehlt schon `file-drop`. | K9 |

---

## 1. Blocker (mit Fix, bindend)

**B1: Der Fake erkennt den echten Container-Shell-Befehl nicht. Die Szene `container-shell-tab` kann nie verbinden.**
- Beleg: K §4.2 verlangt `^docker exec -it ([A-Za-z0-9_.-]+) sh -c `. Main schickt aber immer das `PATH=…`-Präfix (`commands.ts:31-32`), siehe §0. Der Befehl fällt deshalb in `execReply` auf `sh: 1: PATH=…: not found`, Exit 127 (`sshd.mjs:104`), und `targetExitError` macht daraus `ssh.noShellInContainer` (`session.ts:197`). Genau das soll L4 beheben.
- Fix (Task D, §2.5):
  - Das Muster ist `/(?:^|\s)docker exec -it ([A-Za-z0-9_.-]+) sh -c '[^']*'$/`. Es steht als exportierte reine Funktion `dockerExecRef(command)` neben `dockerLogsRef`.
  - `fakes.test.mjs` prüft das Muster **gegen den echten Befehl**: `remoteCommand(terminalArgv(target), { kind: 'none' })` und `{ kind: 'noninteractive' }` aus `src/main/containers/commands.ts`. Ändert Main den Befehl, wird der Test rot statt der Szene.
  - Im sudo-Modus `prompt` ist der Befehl in `sh -c '…'\''…'\''…; exit $?'` verpackt und trifft absichtlich nicht (Exit 127). Der Demo-Vault nutzt kein sudo für `web-01`. Das steht als Kommentar im Fake.

---

## 2. Vertrag (wörtlich umsetzen)

### 2.1 `ContainerChildren.tsx` (Task A)

```ts
interface ContainerChildrenProps extends Omit<ContainerTreeProps, 'state' | 'onExpand'> {
  … // unchanged
  /** File view entry of an SSH host, always the first child; omitted for "Dieser Computer". reuse=true focuses an open file tab. */
  files?: { onOpen: (reuse: boolean) => void };
}

type MenuTarget = { x: number; y: number } & ({ item: DiscoveredItem } | { runtime: ContainerRuntime } | { files: true });
```

**Aufbau (bindend):**
- Die drei frühen Rückgaben (`:33-39`) entfallen. Es gibt immer genau ein `wrap(<>{menu && <ContextMenu …/>}<ul className="container-children" aria-busy={…}>…</ul></>)`.
- `aria-busy={!discovery || discovery.status === 'loading' || (discovery.status === 'ready' && discovery.refreshing === true)}`.
- Reihenfolge der `li`:
  1. der Dateien-Eintrag (nur mit `files`, `key="files"`),
  2. bei `ready && refreshing` die Notiz `containers:tree.refreshing` wie heute,
  3. **genau eines** von: Notiz „Suche Laufzeiten …“ (`!discovery || loading`, `role="status"`), Fehler-Notiz mit `Erneut versuchen` (`error`, `role="alert"`), Notiz „Keine …“ (`ready`, aber `runtimes` und `groups` leer) oder die Laufzeit-Zeilen und Proxmox-Gruppen wie heute.
- Jede Notiz steht als `<li><p className="… container-note" style={indent} …>…</p></li>`. Klassen, `role` und Texte bleiben wie heute.
- `runtimeEntries`/`groupItems` werden nur bei `status === 'ready'` aufgerufen.
- `guestEntries`, `runtimeMenu`, die Gruppen und `where` bleiben unverändert.

**Dateien-Zeile:**

```tsx
<li key="files">
  <div className="vault-tree-row container-row" style={{ paddingLeft: `${depth * 14 + 14}px` }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) setMenu({ x: event.clientX, y: event.clientY, files: true }); }}>
    <span className="tree-toggle-spacer" />
    <button className="tree-node-button" type="button" disabled={disabled}
      title={t('vault:tree.filesEntryTitle', { host: hostName })}
      onClick={() => files.onOpen(true)}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); files.onOpen(true); }
        if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
          event.preventDefault();
          if (disabled) return;
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.left + 24, y: rect.bottom, files: true });
        }
      }}>
      <span className="container-entry-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM12 10v6m-3-3 3 3 3-3" /></svg>
      </span>
      <span className="tree-node-text"><span>{t('vault:tree.filesEntry')}</span></span>
    </button>
  </div>
</li>
```

(`files` ist im Zweig nicht `undefined`. Der Umsetzer bindet `const filesEntry = files` vor dem JSX, damit TypeScript in den Closures schmal typisiert.)

**Menü:**

```ts
const filesMenu = (): ContextMenuEntry[] => [
  { kind: 'item', label: t('vault:tree.filesOpenNew'), hint: t('containers:tree.newTab'), onSelect: () => files?.onOpen(false) },
];
const menuLabel = !menu ? '' : 'item' in menu ? t('containers:tree.actionsFor', { name: menu.item.name })
  : 'runtime' in menu ? t('containers:tree.actionsForView', { runtime: RUNTIME_LABEL[menu.runtime] }) : t('vault:tree.filesMenuLabel');
const menuEntries = !menu ? [] : 'item' in menu ? guestEntries(menu.item) : 'runtime' in menu ? runtimeMenu(menu.runtime) : filesMenu();
```

Es gibt kein „Aktualisieren“ im Dateien-Menü. Es gibt kein neues CSS und keine Bewegung.

### 2.2 `VaultTree.tsx` (Task A)

```ts
/** Opens an SSH connection as file browser; reuse focuses an open one. undefined/false = new tab. */
onOpenFiles?: (id: string, reuse?: boolean) => void;
```

- Das Host-Menü (`:158`) bleibt `onSelect: () => onOpenFiles(node.id)`.
- Ergänzt wird in `:217-218` das Prop `files={onOpenFiles ? { onOpen: reuse => onOpenFiles(node.id, reuse) } : undefined}`.
- Die Chevron-Texte ändern sich nur im Katalog (K3), nicht im Code.
- Sonst bleibt nichts anders. Das gilt ausdrücklich für `isHost`, `toggleHost` und die Pfeiltasten.

### 2.3 `App.tsx` (Task B)

Direkt nach `connectNode` steht:

```ts
/** File view of an SSH connection: reuse focuses an open one (active first), else a new tab; same checks as connectNode. */
function openFiles(id: string, reuse = false): void {
  const node = vault && findNode(vault.nodes, id);
  if (!node || node.type !== 'connection' || node.protocol !== 'ssh') return;
  if (node.disabled) { notifyDisabled(node); return; }
  navigateEditor(() => {
    const connection = toTerminalConnection(node, true);
    const plan = planContainerView(terminals.tabs, terminals.activeTabId, connection, reuse);
    if (plan.kind === 'focus') { terminals.select(plan.tabId); setEditorOpen(false); setEditorDirty(false); return; }
    if (plan.kind === 'limit') { notifySessionLimit(); return; }
    terminals.open(connection); setEditorOpen(false); setEditorDirty(false);
  });
}
```

- In `:983` gilt `onOpenFiles={(id: string, reuse?: boolean) => openFiles(id, reuse)}`. Die Parametertypen sind **explizit**, damit B gegen die alte und die neue `VaultTree`-Signatur typisiert (K1).
- `connectNode` und der Bereichskopf (`SplitTerminalArea` → `onConnect(id, paneId, true)`) bleiben unverändert.

### 2.4 `ContainerDock.tsx` und `kubernetes-ui.css` (Task C)

Der Zweig `terminalMode === 'shell' && !armed` (`:155-161`) wird zu:

```tsx
<div className="kube-placeholder">
  <p>{t('containers:dock.armHint')}</p>
  <div className="kube-placeholder-actions">
    <button type="button" className="primary-button" onClick={onArm}>{t('containers:menu.shellOpen')}</button>
    {onPopout && <button type="button" className="secondary-button" onClick={onPopout}>{t('containers:menu.shellTab')}</button>}
  </div>
</div>
```

In `kubernetes-ui.css` steht direkt nach `.kube-placeholder` (`:7`) die Regel `.kube-placeholder-actions { display: flex; flex-wrap: wrap; gap: var(--space-8); }`.

- `onPopout` ist `ContainerView.popout` mit den Gründen von `Strg+Umschalt+T`.
- Nichts anderes ändert sich im Dock: kein `armed`, kein `onArm`, und der Leistenknopf bleibt.
- **Sicherheitsregel:** Der Knopf ruft ausschließlich `onPopout`, nie `onArm`, und öffnet nichts ohne Klick. Der Tab entsteht über `App.openPopout`, der Main validiert `target` wie bei den drei vorhandenen Wegen (`session.ts:217-222`).

### 2.5 `sshd.mjs` (Task D)

```js
// Container shell: `docker exec -it <name> sh -c '<shell choice>'` (also behind the app's PATH=… and `sudo -n` prefixes) serves an echo shell for running
// containers from CONTAINERS; nothing from the command is executed. The sudo prompt mode wraps the command in sh -c and is not matched (exit 127).
const DOCKER_EXEC = /(?:^|\s)docker exec -it ([A-Za-z0-9_.-]+) sh -c '[^']*'$/;
/** Container name of a `docker exec -it <name> sh -c '…'` command, else undefined (nothing is executed). */
export const dockerExecRef = command => DOCKER_EXEC.exec(command)?.[1];

/** Echo shell of a running fixture container; unknown names and stopped containers fail like docker does. */
function serveContainerShell(stream, name) {
  const container = CONTAINERS.find(c => c.Names === name);
  const refuse = message => { stream.stderr.write(message); stream.exit(1); stream.end(); };
  if (!container) return refuse(`Error: No such container: ${name}\n`);
  if (container.State !== 'running') return refuse(`Error response from daemon: container ${container.ID} is not running\n`);
  serveShell(stream, { prompt: `root@${container.Names}:/# `, banner: '' });
}
```

- Im `exec`-Handler steht der Aufruf direkt nach dem Logs-Zweig (`:287-288`): `const shellOf = dockerExecRef(command); if (shellOf !== undefined) { serveContainerShell(stream, shellOf); return; }`.
- Der Prompt nimmt den Namen aus der Fixture und nicht aus dem Befehl.
- Der Kopfkommentar (`:5-10`) bekommt eine Zeile zur Container-Shell.

---

## 3. Korrekturen (bindend)

- **K1 Wellenplan: Jede Task ist allein grün.**
  - K trennt Locales (T4), `ContainerChildren` (T1) und `VaultTree` (T2) in drei Tasks. `t()` ist über `CustomTypeOptions` typisiert (`shared/i18n.d.ts:4-6`), deshalb ist T1 ohne T4 typrot. T2 übergibt `files`, das es ohne T1 nicht gibt. T4 ohne T1 erzeugt Waisen.
  - Fix: T1, T2 und T4 werden **Task A** (`ContainerChildren.tsx`, `VaultTree.tsx`, beide `vault.json`).
  - Task B nutzt explizite Parametertypen (§2.3). Damit ist A ohne B grün: Der Eintrag öffnet dann über das alte `id => connectNode(…, true)` immer neu, und B ohne A ist ebenfalls grün.
  - Der Fake (Task D) hängt an keiner UI-Änderung und läuft schon in Welle 1. §6 gilt.
- **K2 Icon:** K wählt den Vault-Ordner-Pfad (`VaultTree.tsx:59`). Dasselbe Zeichen steht 2 px größer an echten Vault-Ordnern, ein Host-Kind sähe aus wie ein Ordner im Vault. Fix: Es gilt das SFTP-Zeichen `files` aus `ConnectionIcon.tsx:27` (Ordner mit Pfeil, Standard-Icon von SFTP-Verbindungen) mit runden Linienenden, wie in §2.1.
- **K3 Chevron-Label:** Der Chevron klappt jetzt auch die Dateiansicht auf. Ein Screenreader hörte sonst nur „Laufzeiten …“. Fix: Nur die Texte von `vault:tree.runtimesShow` und `vault:tree.runtimesCollapse` ändern sich (§5), die Keys bleiben. Der Kontextmenüpunkt `vault:tree.showRuntimes` „Laufzeiten anzeigen“ bleibt, weil er wirklich neu erkennt.
- **K4 Menü-Union:** Die heutigen Ternaries `'item' in menu ? … : menu.runtime` typisieren mit der dritten Variante nicht. Fix: `'runtime' in menu` wird ausdrücklich geprüft (§2.1).
- **K5 Fake-Details:**
  - `banner: ''` ist Pflicht, sonst erscheint `undefined`.
  - Die Namen kommen aus `CONTAINERS` und nicht aus `LISTS`.
  - Nur laufende Container bekommen eine Shell.
  - Der Prompt ist `root@<name>:/# `, damit die Szene zwei Tabs unterscheiden kann.
  - Die Shell bedient nur die festen `outputs`. `exit` beendet sie mit Exit 0.
- **K6 Platzhalter-Knopf:** K sagt „einfacher Knopf“. Fix: `className="secondary-button"` (vorhanden, `styles.css:33`), in der Reihenfolge primär → sekundär, in `.kube-placeholder-actions` (§2.4). Der Platzhalter des Starten-Zweigs (`:148-154`) bleibt unverändert.
- **K7 Szene `files-entry` (Task E), bindende Schritte:**
  1. Den Chevron von `web-01` nur klicken, wenn er zugeklappt ist (`aria-expanded="false"`; das Label nach K3 lautet „Dateiansicht und Laufzeiten von web-01 anzeigen“). Die Szene merkt sich jeden Host, den sie aufklappt.
  2. `waitFor`, bis das erste `li` von `.container-children` im `li` von `web-01` den Text „Dateiansicht (SFTP)“ hat und davor kein anderes `li` steht.
  3. Klick → `waitFor` auf einen Tab „web-01 · Dateien“ mit `.tab-status-connected` und `.file-pane-remote [role=row][data-name]` ≥ 5. Es gibt **keinen** Tab mit dem Namen genau `web-01` (kein Terminal).
  4. Einen anderen Tab wählen (Willkommens-Tab), dann den Eintrag fokussieren und `Enter` drücken. Die Zahl der „web-01 · Dateien“-Tabs bleibt 1, und genau dieser Tab ist aktiv. Damit ist auch die Tastatur geprüft.
  5. Rechtsklick auf den Eintrag → `menuItem('Dateiansicht öffnen')` → ein zweiter Tab „web-01 · Dateien (2)“ ist verbunden. Shot `files-entry`.
  6. `legacy-app` (geschlossener Port) aufklappen. `waitFor` auf `.tree-error` unter dem Host, während der Eintrag weiter das erste `li` ist. Klick → im Dateien-Tab erscheint `.connect-error`. Das belegt „jeder Erkennungszustand“ und die Fehlerkarte.
  7. `app-intern` (über den Sprunghost `web-01`) aufklappen. Klick auf den Eintrag → Liste mit ≥ 5 Zeilen. Das belegt den Sprunghost.
  8. `finally`: Jeden Host, den die Szene aufgeklappt hat, wieder zuklappen. Sonst zeigen spätere `--readme`-Shots derselben Sitzung einen aufgeklappten Baum.
- **K8 Szene `container-shell-tab` (Task E), bindende Schritte:**
  1. `web-01` Host-Menü „Container-Ansicht öffnen“, Tabelle ≥ 6, erste Zeile, `waitFor` `.kube-dock-hint` = `api`.
  2. Taste `s` → `waitFor`: `.kube-placeholder` enthält „Die Shell startet erst auf Knopfdruck“ und einen Knopf „Shell als Tab öffnen“. Es gibt **kein** `.kube-dock-terminal`.
  3. Den Knopf klicken → `waitFor` auf Tab „api @ web-01“ mit `.tab-status-connected` und `root@api:/#` in dessen `.xterm-rows`. Shot `container-shell-tab`.
  4. Zurück zum Ansichts-Tab. Der Platzhalter steht noch, und es gibt **kein** `.kube-dock-terminal`. Die Prüfung läuft **vor** jedem Auswahlwechsel, weil ein Wechsel `armed` ohnehin löscht.
  5. Rechtsklick auf die Zeile `worker` → `menuItem('Shell als Tab öffnen')` → Tab „worker @ web-01“ mit `root@worker:/#`.
- **K9 Dateizuordnung Szenen:** Task E bekommt zusätzlich `.claude/skills/run-app/SKILL.md`:
  - Szenenliste `:25`, dabei auch das fehlende `file-drop` ergänzen;
  - Shot-Liste `:35` mit `files-entry.png` und `container-shell-tab.png`;
  - Exec-Liste `:153`;
  - ein Absatz nach `:212` zu Container-Shell-Fake und den beiden Szenen.

  Die Nutzungszeile `screens.mjs:2` nennt beide Szenen. Die Blöcke stehen am **Ende** von `blocks`, damit ein Gesamtlauf die README-Shots vorher macht.
- **K10 Tests des Fakes (Task D, `fakes.test.mjs`):**
  - Rein: `dockerExecRef` gibt für `remoteCommand(terminalArgv({ item: { kind: 'container', runtime: 'docker', ref: 'api', name: 'api' }, mode: 'shell' }), { kind: 'none' })` und für `{ kind: 'noninteractive' }` den Wert `'api'`.
  - Rein: `undefined` liefern `…'; rm -rf /`, `podman exec -it api sh -c 'x'`, `mydocker exec -it api sh -c 'x'` und der Logs-Befehl. `dockerLogsRef` des Exec-Befehls ist `undefined`.
  - Integration nach dem Muster `:96-116` (pty):
    - Der echte Befehl für `api` liefert `root@api:/# `. Nach `uptime\r` kommt die feste Ausgabe, nach `exit\r` folgt `close` mit Code 0.
    - `nope` endet mit Code 1 und `No such container: nope`, `migrate` mit Code 1 und `is not running`.
    - stdout wird jeweils mit `resume()` gelesen.
  - `terminalArgv` und `remoteCommand` kommen aus `../../../src/main/containers/commands`.
- **K11 Notizen und `aria-busy`:** Wie in §2.1. Während der Erkennung ist die Liste `aria-busy`, die Notiz behält `role="status"`.
- **K12 en-US-Titel:** „Files of {{host}} over SFTP, no terminal“ wird zu „Files on {{host}} over SFTP, without a terminal“ (§5).

---

## 4. Entscheidungen und Ergänzungen

- **E1 Ruling: Das Host-Menü läuft über `openFiles(id, false)`** — Das ist gleichwertig zu `connectNode(id, undefined, true)`: gleiche Prüfungen, `planContainerView` ohne `reuse` heißt Limit, dann öffnen. Ein Ort für Dateien-Tabs aus dem Baum. — Kosten: keine; R-DS-2 („unverändert“) gilt im Verhalten.
- **E2 Ruling: Zwei Anmeldungen beim Weg über den Chevron** — Das Aufklappen startet die Erkennung (eigene Verbindung, `runner.ts:49` mit `ask`), der Eintrag öffnet eine eigene SFTP-Sitzung. Bei `mfa-01` fragt Shellherd daher zweimal nach Passwort und Code. Bei jedem Passwort-Login ohne gespeichertes Passwort fragt er ebenfalls zweimal. — Kosten: ein zweiter Dialog. Wer das vermeiden will, nimmt das Host-Menü „Dateien öffnen (SFTP)“ (ohne Erkennung). Das steht im Handbuch (E3).
- **E3 Handbuch (Task F), wörtlich:**
  - In „Container und VMs“ kommt nach dem ersten Absatz (`handbuch.md:457-467`, endet mit „… fragt vorher nach.“) ein neuer Absatz: „Ganz oben unter jeder aufgeklappten SSH-Verbindung steht der Eintrag `Dateiansicht (SFTP)`, sofort und unabhängig davon, ob die Erkennung noch läuft, fehlschlägt oder keine Laufzeit findet. Ein Klick oder `Enter` wechselt zu einer offenen Dateiansicht dieser Verbindung oder öffnet eine; `Dateiansicht öffnen` im Kontextmenü des Eintrags öffnet immer eine weitere. Die Dateiansicht braucht keine Terminal-Sitzung: Sie meldet sich selbst an, mit demselben Sprunghost, denselben Anmeldedialogen und derselben Prüfung des Server-Schlüssels. Sie zeigt die Dateien des Hosts, nicht die eines Containers. Bietet der Server kein SFTP an, meldet der Tab „Der Server bietet kein SFTP an.“ Weil das Aufklappen selbst eine Verbindung für die Erkennung öffnet, fragen Verbindungen mit Code-Abfrage dabei zweimal; `Dateien öffnen (SFTP)` im Kontextmenü der Verbindung fragt nur einmal. Dieser Menüpunkt und der Knopf im Kopf eines SSH-Bereichs bleiben erhalten.“
  - In „Container-Ansicht“ kommt nach dem Dock-Absatz (`:500-510`, vor „Grenzen:“) neu: „Die Shell eines laufenden Containers lässt sich auch als eigener Tab öffnen: mit `Shell als Tab öffnen` im Kontextmenü der Zeile, mit dem gleichnamigen Knopf neben `Shell öffnen` im Dock, mit `Als Tab öffnen` in der Dock-Leiste oder mit `Strg+Umschalt+T`. Der Tab heißt etwa „api @ web-01“ und gehört fest zu diesem Container. Das Dock bleibt dabei unverändert; seine Shell startet weiterhin erst mit `Shell öffnen`.“
  - Der Satz „Diese Version bietet keinen Datei-Browser in Containern“ (`:484`) bleibt.
- **E4 README (Task F), wörtlich:**
  - `:37` bekommt nach dem ersten Satz „Every SSH host in the sidebar has a **File view (SFTP)** entry that opens it without a terminal session.“
  - In `:38` wird „with filters, logs, shell and inspect.“ zu „with filters, logs, shell and inspect; logs and shell also open as tabs of their own.“
  - Kein `CHANGELOG.md`, kein `package.json` (AGENTS.md:9).
- **E5 Test `terminal-tabs.test.ts` (Task B), im `describe('container view tabs')`:** Es gibt drei Tabs desselben Hosts: Shell (`toTerminalConnection(node)`), Container-Ansicht und Dateien (`toTerminalConnection(node, true)`). Erwartet wird:
  - Dateien mit `reuse` → `focus` auf den Dateien-Tab. Bei zwei Dateien-Tabs gewinnt der aktive.
  - Ohne `reuse` → `open`.
  - Nur Shell und Container-Ansicht vorhanden, mit `reuse` → `open`.
  - Bei `MAX_SSH_SESSIONS` Tabs inklusive Dateien-Tab mit `reuse` → `focus`, ohne Dateien-Tab → `limit`.
  - Ein Dateien-Tab eines anderen Hosts → `open`.
- **E6 Restrisiken (zur Kenntnis):**
  - Dateien-Tabs in einem Zweitfenster findet `reusableTab` nicht. Der Klick öffnet dann einen neuen Tab im Hauptfenster, wie bei der Container-Ansicht.
  - Ein fokussierter Dateien-Tab kann getrennt oder fehlerhaft sein. Er zeigt dann seine Leiste bzw. Karte mit `Neu verbinden`/`Erneut versuchen`, wie heute.
  - Dateien-Tabs starten aktive Auto-Upload-Bindungen der Verbindung (`sftp-session.ts:139`), wie jeder Dateien-Tab. Die Wiederverwendung senkt die Zahl paralleler Ansichten eher.
- **E7 Ruling: Kein entsprechender Knopf im Kube-Dock** — Der Nutzerwunsch betrifft Docker. Kube hat dieselben drei Wege. — Kosten: Der Platzhalter sieht bei Kube anders aus. Das ist ein Kandidat für eine spätere Angleichung.
- **E8 Ruling: Doppelte Tab-Knöpfe im Arm-Zustand** — Leiste und Platzhalter zeigen beide einen Tab-Weg (K Risiko 3). — Kosten: Redundanz; der Platzhalter-Knopf ist der auffindbare.
- **E9 Ruling: Keine ARIA-`tree`-Rollen** — Der ganze Baum nutzt Knöpfe in Listen. Ein Eintrag mit `treeitem` wäre inkonsistent, und ein Umbau des Baums ist nicht Gegenstand. Die Zeile ist ein benannter Knopf (sichtbarer Text, `title`). `Enter`, Leertaste, `Kontextmenü` und `Umschalt+F10` funktionieren. Die Fokusreihenfolge ist Host → Verbinden/Bearbeiten → Dateiansicht → Laufzeiten. — Kosten: keine neuen.

---

## 5. Texte (wörtlich; ersetzt K §3.4)

| Datei (Task) | Key | de-DE | en-US |
|---|---|---|---|
| vault (A) | `tree.filesEntry` | Dateiansicht (SFTP) | File view (SFTP) |
| vault (A) | `tree.filesEntryTitle` | Dateien von {{host}} per SFTP, ohne Terminal | Files on {{host}} over SFTP, without a terminal |
| vault (A) | `tree.filesMenuLabel` | Aktionen für Dateiansicht | Actions for file view |
| vault (A) | `tree.filesOpenNew` | Dateiansicht öffnen | Open file view |
| vault (A) | `tree.runtimesShow` (ändern) | Dateiansicht und Laufzeiten von {{name}} anzeigen | Show file view and runtimes of {{name}} |
| vault (A) | `tree.runtimesCollapse` (ändern) | Dateiansicht und Laufzeiten von {{name}} zuklappen | Collapse file view and runtimes of {{name}} |

Wiederverwendet ohne Änderung: `containers:tree.newTab`, `containers:menu.shellOpen`, `containers:menu.shellTab`, `containers:dock.armHint`. Die Keys stehen im Code nur als volle Literale (`t('vault:tree.filesEntry')` usw.). Jeder neue Key entsteht in derselben Task wie seine Verwendung (A), deshalb gibt es nach jeder Task keine Waisen. Der Platzhalter `{{host}}` ist in beiden Sprachen gleich, und der Test (f) ist erfüllt (keine `...`, keine deutschen Anführungszeichen im en-US).

---

## 6. Wellen und Tasks (ersetzt K §7 und Spec „Wellen“; dateidisjunkt je Welle)

| Welle | Task | Dateien (ausschließlich) | Inhalt | grün nach |
|---|---|---|---|---|
| 1 | **A Baum-Eintrag** | `src/renderer/src/components/ContainerChildren.tsx`, `src/renderer/src/components/VaultTree.tsx`, `src/shared/locales/de-DE/vault.json`, `src/shared/locales/en-US/vault.json` | §2.1, §2.2, K2, K3, K4, K11, Texte §5 | Task |
| 1 | **B App-Öffner** | `src/renderer/src/App.tsx`, `src/renderer/src/terminal-tabs.test.ts` | §2.3, E1, E5 | Task |
| 1 | **C Dock-Platzhalter** | `src/renderer/src/components/containers/ContainerDock.tsx`, `src/renderer/src/kubernetes-ui.css` | §2.4, K6 | Task |
| 1 | **D Fake** | `.claude/skills/run-app/sshd.mjs`, `.claude/skills/run-app/fakes.test.mjs` | B1, §2.5, K5, K10 | Task |
| 2 | **E Szenen** | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | K7, K8, K9 | Task (mit laufender App) |
| 2 | **F Doku** | `docs/handbuch.md`, `README.md` | E3, E4. Kein `CHANGELOG.md`, `package.json`, `package-lock.json` | Task |

**Abhängigkeiten und Gates:**
- Welle 1: A, B, C und D sind unabhängig, und nach **jeder einzelnen** Task sind `npm run typecheck` und `npx vitest run` grün (K1). Zwischenstand A ohne B: Der Eintrag öffnet bei jedem Klick einen neuen Tab. Das ist zulässig und endet mit B. Am Wellenende prüft der Orchestrator beide Befehle (einen zeitabhängigen Ausfall wie in der Ausgangslage einzeln wiederholen).
- Welle 2 braucht die ganze Welle 1. E startet die App nach Skill `run-app` mit **neu gestartetem** Testserver (geänderter Fake) und läuft `file-drop`, `files-entry`, `container-shell-tab`, `containers`, `container-logs` und `sftp`. Die Shots `files-entry` und `container-shell-tab` werden angesehen. In `containers` ist kein Host aufgeklappt. F ist von E unabhängig.
- Keine Task fasst `src/main/**`, IPC-Schemas, `tokens.css`, `design-tokens.test.ts` oder `docs/design-system.md` an. Es gibt keine neuen Tokens und keine Bewegung. Die einzige neue CSS-Regel nutzt `var(--space-8)`.

**Review-Schwerpunkte:**
- Der Platzhalter-Knopf ruft nur `onPopout`.
- `armed` bleibt unberührt.
- Der Fake führt nichts aus und nutzt keinen Pfad aus dem Befehl.
- Dateien-Tabs entstehen nur durch Klick, `Enter` oder einen Menüpunkt, das Aufklappen öffnet keine SFTP-Sitzung.
- Kein Eintrag erscheint unter „Dieser Computer“, an `sftp`-, RDP-, Kube- oder lokalen Knoten, an deaktivierten Hosts oder in der Suche.
