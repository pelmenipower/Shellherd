# Shellherd – Manual

<img src="../resources/icon.png" width="96" alt="Shellherd">

Detailed description of the features. For a short overview, download and installation, see the [README](../README.md).

German version: [handbuch.md](handbuch.md)

Local connection manager for SSH, RDP, containers and Kubernetes with encrypted, portable vault files (`.term`).

Shellherd was called Terminus up to version 0.9.0; vault files (`.term`, older `.terminus`) remain compatible. On first start, Shellherd takes over the settings (known host keys, last opened vault file) once from `%APPDATA%\Terminus`; the old folder stays untouched. Repository: <https://github.com/pelmenipower/Shellherd>.

## Running locally

```powershell
npm install
npm run dev
```

DevTools are disabled in the app window, including during development.

## Checking quality

```powershell
npm run typecheck
npm test
npm run build
```

## Design system

Colors, sizes, radii, layers, shadows and motion come from a single file: `src/renderer/src/tokens.css`. The rules for new surfaces are in [`docs/design-system.md`](design-system.md). The test `src/renderer/src/design-tokens.test.ts` checks all CSS files for hard-coded colors and sizes, built-in easings, fixed durations and z-index values, as well as motion without `prefers-reduced-motion`.

## Icons

The app icon and interface glyphs are generated from `resources/brand/shellherd-master.png` and the small variants in `resources/brand/`. `npm run icons` produces `resources/icon.png`, `resources/icon.ico` and `resources/mark-64.png` from them.

## Current state

Create, open and lock vaults; create, edit and delete nested folders and SSH connections. Changes are saved encrypted.
Up to 16 SSH sessions can run at the same time as terminal tabs, including several
sessions of the same connection. Double-clicking or pressing Enter on a connection starts
a session in the focused pane. A single click only selects.
Search finds names, hosts, users, tags and folder paths. Folders can be
collapsed; the connection list can be resized and hidden.

`New` → `New connection` opens the compact form. `Save and connect`
saves encrypted and then starts SSH. Comment, tags, color and
target folder are under `More options`; key files can be selected.
Under `Icon and color` there are six icons and a freely selectable color per
connection. They appear in the connection list, terminal tabs and
connection picker. Changes also apply to tabs that are already running and are saved
in the encrypted vault; existing vaults use the terminal icon.
The edit icon of a row opens the properties. Unsaved
input is protected when you switch away. Folders can be renamed directly with F2.
Right-click → `Disable` grays out a connection: it can no longer be
opened, `Connect all` and workspaces skip it, and credentials are
kept. Tabs that are already running stay open. `Enable` releases it again.
Background tabs stay connected and
keep processing their output. In the tab strip, the arrow keys as well as
Home/End switch between tabs. Closing a tab only ends its session.
Locking the vault ends all sessions. Saved workspaces can be opened selectively after
unlocking; this starts new SSH sessions.

Selecting text in the terminal automatically copies the selection to the clipboard.
Right-click pastes the clipboard text into the terminal you clicked.
Pasting goes through xterm and respects the server's bracketed paste mode.
The usual copy and paste shortcuts remain available.

## Language

Shellherd follows the system language by default: German on a German Windows, English otherwise. The `Language` setting on the start card and on the welcome page offers `System`, `Deutsch` and `English`. A change takes effect immediately in all windows, without a restart. The choice is stored in `settings.json` in the user data folder (`%APPDATA%\Shellherd\settings.json`), not in the vault.

The AI assistant answers in the selected language. kubectl-like output and raw status values stay in English. The installer follows the Windows language.

## Split views and workspaces

Drag a terminal tab or the free title bar to the left, right, top or bottom
edge of a pane. A semi-transparent preview shows the new
layout before you release. In the middle, the tab is moved into the existing
pane. Escape cancels the drag. Up to four panes are possible;
invalid splits are marked in the preview. Source panes that are left empty
are merged automatically. Each pane has its own tabs.
The `+` right next to the tabs opens a searchable list of saved
connections and starts the chosen connection as a new tab in that pane.
Enter opens the first match, the arrow keys select and Escape closes the
list. The `×` inside the shared tab area closes its session.
In the tab strip, an insertion line shows where the tab will be placed. This way
existing panes can be merged again and tabs can be
reordered within their bar. The free title bar drags the pane's active tab. This also works
after several splits and moves; Escape or releasing
outside the terminal area discards the preview.

In the three-dot menu of each pane, `Split side by side`,
`Split top and bottom`, `Move active tab` and `Merge pane`
remain available as a keyboard alternative. Dividers can be dragged directly or
focused and adjusted with the arrow keys; double-clicking resets to equal sizes.
The maximize icon temporarily enlarges a pane. These actions
keep running sessions and their terminal output. In a small window, the
editor fills the work area while the terminals keep running in the background.

`Save` in the header updates the active workspace or asks for a name the
first time you save. Changes are marked there with `changed`.
The workspace menu contains Open, Rename, Delete and `Save as …`.
What is saved: the layout, size ratios, connection references
and the active connection per pane, in the encrypted vault. Terminal output
is not saved. `Save as …` creates another definition;
selecting an entry in the menu only changes the active workspace once you open it.
`Open workspace` replaces the current tabs and starts at most 16 sessions.
If sessions are running, a confirmation appears according to the vault setting.
`Close workspace` ends all tabs but keeps the saved
layout. `Delete workspace` only removes the saved definition.
Several tabs of the same connection are restored; their active instance
within a pane is set to the first instance of that connection.

The terminals support password, private key with optional
passphrase, and SSH agent. On Windows, without `SSH_AUTH_SOCK` the
OpenSSH agent at `\\.\pipe\openssh-ssh-agent` is used; the service must be running
and contain the matching key. On Unix, `SSH_AUTH_SOCK` must be set.
Agent forwarding is disabled. Interactive MFA / keyboard-interactive login
will follow in a later step.

## Containers and VMs

When you expand an SSH connection, Shellherd detects whether Docker and Podman
are installed and shows one entry per runtime, `Docker view` or
`Podman view`; a click opens the container view or switches to an
already open tab. Another tab can be opened from the entry's context menu
(`Open Docker view`). Proxmox LXC containers and VMs still appear as a
list. Every expansion reloads. Nothing is installed on the server.
Double-clicking or pressing Enter opens a shell only in running LXC containers. VMs
offer `Serial console` in the context menu; this only works with a
serial port.
The context menu of Proxmox guests contains `Open shell`, `Start`,
`Shut down` and `Stop`. A hard stop of a VM asks first.

`This computer` shows `Docker view` and `Podman view` if the respective
CLI is installed. This is checked after the vault is unlocked and can be repeated
via the context menu of the free area in the connection tree (`Find local runtimes`).

The SSH user needs access to Docker via the `docker` group; for Proxmox
they must be able to run the commands as root. Alternatively, the option
`Run container commands with sudo` runs the commands with sudo per SSH connection.
If the connection logs in with a password, Shellherd answers the sudo prompt
once with the saved password, but only if sudo actually asks. With
key or agent login, `sudo -n` is used; this requires a NOPASSWD rule
for that user. If sudo rejects the password, Shellherd does not send it
again until the connection settings have been changed.

Container tabs of SSH hosts are saved in workspaces, local container tabs
are not. This version offers no file browser in containers and no Proxmox API.
Kubernetes has its own section.

### Container view

For Docker and Podman there is also a view in the style of the cluster tab. It
opens from the context menu of an SSH connection (`Open container view`)
or, for your own machine, via `Open local container view` (heading
`This computer` or the free area in the connection tree). The view has four tabs:
Containers, Images, Volumes and Networks. Each tab has column filters, chips,
grouping and sorting; filters and grouping are kept per tab, `F`
resets the filters. A tab opened from the sidebar is fixed to its runtime.
The free tab (`Open container view`, `Open local container view`)
has a switch in the header if both Docker and Podman are installed. The list
refreshes every 10 seconds while the tab is visible, as well as after every
action and with `F5`.

The dock below the table shows logs (`l`), a shell (`s`, starts only on
button press, only for running containers) and inspect (`i`). Images, volumes and
networks only have inspect. Start runs without a prompt. Stop, Restart
and Remove open a dialog; when removing containers, images and volumes
you have to type the name or reference. Images and volumes that are in use
cannot be removed.

Limits:

- Inspect only masks the values in `Config.Env` whose name sounds sensitive. Labels,
  `Cmd` and mounts stay visible unchanged, so a secret in `Cmd` is readable.
  Credentials in values such as `DATABASE_URL=postgres://u:p@…` are not masked,
  because only the names are checked.
- Without sudo, Podman only shows the containers of the SSH user (rootless).
- A second tab of the same host polls twice. With `sudo` in password mode, every poll
  logs in once via sudo; this shows up in the host's auth log.
- If the runtime of a fixed tab is missing on the host, the tab shows an error. In the
  background it only checks, without sudo, whether the runtime is back.

## Kubernetes

A cluster is set up from an existing SSH connection: choose `Set up as Kubernetes cluster…`
in the context menu. Shellherd reads the kubeconfig on the host
and suggests name, context and further access hosts, such as `k8s-cp2` and
`k8s-cp3` in the same naming pattern. The access hosts are tried in order.
If one fails, Shellherd reconnects through the next one; the status bar
below the header shows which host the cluster is currently reachable through.

The kubeconfig is searched in this order: `$KUBECONFIG` of the login shell
(first file), `~/.kube/config`, then `/etc/kubernetes/admin.conf`. Shellherd reads the file under
`/etc/kubernetes` via sudo with the SSH connection's login:
if a password is saved, Shellherd answers the sudo prompt with it, otherwise
it uses `sudo -n` (the user needs NOPASSWD for that). Shellherd rejects kubeconfigs with `exec` or
`auth-provider` sections, because their plugins would run on this machine
instead of on the server.

In the setup form, “Production” is preselected; deselecting it is a deliberate
decision. “Read-only” blocks restart, scale, delete and the shell; logs, YAML,
events and describe stay allowed. Every change asks for confirmation. For
production you have to type the resource name before the button becomes active.

The cluster tab shows nodes, workloads, pods and events live. A status bar below the
header shows the state: “Live” with the age of the data (“Updated 12 s ago”); while
reconnecting, in yellow, the host and the attempt (“Connecting via k8s-cp2 … (attempt 2)”);
afterwards, briefly in green, “Reconnected via …”. The table stays readable and unchanged
during this and is no longer greyed out; actions that change something or need a connection
are locked until the cluster is reachable again. `Enter` drills down,
for example from a deployment through its pods to the containers, `Esc` goes back
one level. At the bottom, a pane opens for logs (`l`), shell (`s`), events
(`e`), YAML (`y`) and describe (`d`). `?` shows the help with all keys and filter forms.

Every column of the table has a filter field below the header: text (contains), a selection for
namespace, status, type, node and roles, numbers (`>3`, `<=5`, `3`) and age (`<10m`,
`>1h`, `<2d`). All filters apply together; invalid input is marked red and does not
filter. `/` jumps to the name filter (events: message), `F` resets all filters of the tab.
Above, a chip bar shows status filters with a counter (pods for example “Running”, “Waiting”,
“Error”, “Not ready”, “With restarts”; jobs “Running”, “Succeeded”, “Failed”;
events “Warning”, “Normal”, “Last 5 min”). Chips within a group combine with OR,
groups with each other with AND; `w` shows only what needs attention (for events only warnings).
Text filters from the context menu (e.g. `app=api`) appear as a “Filter: …” chip and can
be removed with ×. “Group by” (e.g. namespace, node, status, owner) combines rows
into groups that can be expanded and collapsed with a click. Each tab
remembers its filters and grouping, also in the workspace. Namespaces without pods are reached via “all”
and the namespace filter; without a configured namespace, the cluster tab starts with all
namespaces. Events are sorted by “Last seen” in descending order; jobs show their status, pods
also “Evicted” and “Unknown”, nodes a hint under pressure.

Right-click or `Shift+F10` opens a context menu in the cluster tab, also on node tiles,
problems and the bottom pane. It copies names, namespace, `kubectl` commands as well as
YAML and describe (masked the way they are displayed), jumps to owner, node and
related object, and with `Open SSH connection` opens the matching vault connection
to the node. New are Resume, Suspend and `Run now…` for CronJobs as well as
`Cordon node…` and `Uncordon node…`; all of them ask for confirmation and are blocked in
“Read only”. `drain` is only available as a copyable command.

The kubeconfig lives only in the main process's memory and is not written to
disk. The tunnel to the API server listens only on `127.0.0.1`.
Secret data is masked in the YAML view.

## Notices and connection state

Shellherd shows problems where they occur.

- **At the field:** An invalid entry appears in red directly below the field, and focus jumps to it.
- **In the pane:** If something fails in an area (sidebar, menu, terminal), a card with title, cause and button appears there.
- **Bottom right:** Background events appear as a notice. Errors stay until you close them. Info notices (5 seconds) and success notices (3 seconds) disappear on their own; a thin bar shows the time left, and it pauses while the mouse is over it or the window is hidden. At most three notices are visible.

**Connecting:** If connecting takes longer than 0.4 seconds, the pane shows the steps “Reaching server”, “Verifying server key”, “Signing in” and “Opening shell” with the time per step. `Esc` or `Cancel` aborts. If the server answers slowly, a hint appears.

**Errors:** If the connection fails, the card names the cause (for example “Sign-in rejected”, “Server not responding”, “Server key has changed”) and the next step. Depending on the case, `Edit connection`, `Connect again` or `Copy fingerprint` are offered; `Details` shows the server's raw text.

**Disconnected:** If the server ends the session or it drops, the output stays visible. A bar at the bottom says how long ago that was and offers `Reconnect` (`Enter`). This also applies to RDP and the file view.

**Saving:** Buttons show “Saving …” and then briefly “Saved” without changing their width. If saving the vault file fails, the notice names the reason (read-only, locked by another program, folder missing, drive full). For container actions, the status column shows the target state (“stopping”, “restarting”) until the list has refreshed.

## Server keys

On first contact, compare the displayed SHA-256 fingerprint with a
trusted source. Only explicitly confirmed keys
are saved in `known-hosts.json` in the Electron user data directory.
This file contains hosts, ports and public fingerprints, no credentials.
It is located at `%APPDATA%\Shellherd\known-hosts.json`; on first start Shellherd takes it over
once from `%APPDATA%\Terminus`. It is a separate
Shellherd trust file; OpenSSH's `known_hosts` is not yet
imported. Mismatching keys and corrupted trust files abort
the connection. A key change must be clarified with the server administrator;
a user interface for managing trusted hosts will follow later.

## Process boundaries and lifecycle

- Main: encrypted files, vault session key, `ssh2`, host key verification.
- Preload: explicit, typed IPC methods; events without the Electron event object.
- Renderer: React and xterm.js; no Node, file system or socket access.
- SSH requests use saved connection IDs and ownership-bound session IDs.
- Output pauses while xterm acknowledgements are pending; input and scrollback
  are limited. Terminal output is not logged to disk.
- Disconnecting, locking the vault, closing the window and a renderer crash end the SSH session.
  With active sessions, closing is confirmed according to the vault setting.

The SSH tests run a local `ssh2` server with test keys generated at runtime
and synthetic credentials. They check real handshakes,
shell I/O, resize, errors, ownership boundaries, parallel sessions and backpressure.
Further tests cover tab selection and closing individual tabs as well as
serialized host key confirmations.
