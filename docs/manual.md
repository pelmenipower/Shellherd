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
Locking does not disconnect: sessions keep running in the background, and all tabs are back after unlocking. New connections and `Reconnect` work only after unlocking. `Other vault file` on the lock screen always asks and disconnects everything. Saved workspaces can be opened selectively after
unlocking; this starts new SSH sessions.

### Recently used vaults

`Open vault` lists up to eight vault files under `Recently used` that you opened, created or saved last, newest first, with date and folder. A click selects the file; only the password is left. At start the newest file that still exists is preselected. If a file is gone (moved, deleted or network drive disconnected), it shows `File not found` and cannot be selected; it stays until you remove it. The `×` next to an entry only takes it off the list, the file stays untouched. The list holds paths and times only, never passwords or contents, and lives in `settings.json` in the user data folder. Paths show the folder and therefore often your Windows user name; keep that in mind before you share a screenshot of the start screen.

Shellherd opens a vault file only if it comes from `Select vault file`, a double-click in Explorer, `Recently used`, or by dragging it from a local drive. A vault file on a network share (`\\server\…`) you open once via `Select vault file`; after that it is listed under `Recently used`. Shellherd refuses to open a file dragged from a network share. This way, injected code cannot make Shellherd trigger a network sign-in to a foreign server.

### Locking and the welcome tab

The lock button in the header locks without a confirmation. An opaque lock screen covers the window; the keyboard reaches nothing behind it. Detached windows are locked too and show their own lock screen (without a password field); you unlock in the main window.

- **Credentials in memory:** The credentials of open sessions stay in Shellherd's memory while locked. A changed, unsaved connection editor keeps its content, including the connection's stored password; an unchanged editor closes on lock. The lock does not protect against reading the process memory.
- **Screen captures:** While locked, Shellherd excludes all its windows from screen captures and screen sharing (Teams, Zoom, Snipping Tool); there the background appears instead. After unlocking this is lifted. Photos of the screen and the preview of a minimized window in the taskbar are not reliably covered by this.
- **Idle disconnect:** It keeps running while locked. A long lock can disconnect sessions; the disconnected bar waits after unlocking.
- **Assistant:** Automatic assistant requests (reading output) fail while locked with “No vault is unlocked.”
- **Host key:** An open host key prompt can appear above the lock screen. It shows only the host and fingerprint.
- **Welcome tab:** When a vault opens, the welcome page appears as a tab. Reopen it from the `+` menu (`Welcome page`). The tab can only be closed: no dragging, no splitting, no moving to another window. It is not saved in a workspace and counts toward the limit of 16 tabs.

Selecting text in the terminal automatically copies the selection to the clipboard.
Right-click pastes the clipboard text into the terminal you clicked.
Pasting goes through xterm and respects the server's bracketed paste mode.
The usual copy and paste shortcuts remain available.

Search in the terminal with `Ctrl+Shift+F`. `Enter` finds the next match, `Shift+Enter` the previous one, `Esc` closes the search. Upper and lower case do not matter. Matches are highlighted by the selection and are not copied to the clipboard. The terminals in the container and cluster docks have no search; there `Ctrl+Shift+F` goes to the terminal.

Open links with `Ctrl+click`. Only `http` and `https` addresses up to 2048 characters without user name or password are allowed; everything else stays text. Hovering over a link shows a hint in the terminal that names the target: “Ctrl+click opens <host> in your browser”. If a link appears under the resting mouse, move the mouse briefly to another line.

A tab whose terminal is not visible shows a ring after its name when new output arrives; the name turns bold and brighter. The mark disappears once you see the tab.

When closed, the main window remembers its size, position and maximized state. The values are stored in `settings.json` in the user data folder, not in the vault. A window closed while minimized keeps its previous position.

File view: `Edit` opens only text, configuration and source files in the default program, everything else in Notepad.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+,` | Open settings |
| `Ctrl+Shift+K` | Show or hide the AI assistant |
| `Ctrl+Shift+Space` | Open the workflow palette |
| `Ctrl+Shift+F` | Search in the terminal |
| `Ctrl+click` | Open a link in the terminal (http and https only) |
| `Ctrl+Tab` | Next tab in the focused pane |
| `Ctrl+Shift+Tab` | Previous tab in the focused pane |
| `Ctrl+Shift+T` | Open the connection picker of the focused pane |
| `Ctrl+Shift+W` | Close the active tab of the focused pane (with confirmation) |

`Ctrl+F`, `Ctrl+T` and `Ctrl+W` stay with the shell (one character forward, swap characters, delete word), which is why the Shift variants are used. The tab shortcuts do nothing while a dialog is open or while you type in a text field; in the terminal itself they work. `Ctrl+Shift+T` and `Ctrl+Shift+W` do not repeat when you hold the keys down.

### Input to all panes

In the pane header menu, `Send input to all panes` turns it on; the entry appears from two panes. What you type then goes to all connected SSH and local terminals of the shown view. Containers, pods, RDP, SFTP, clusters and the welcome page stay out. Workflows and the assistant still type into one tab only. Member panes show a warning line and the button `To all`; a click on it stops the input. It also ends when you switch views or when fewer than two terminals remain.

## Settings

The gear on the right of the header opens the settings, as does `Ctrl+,`. Before unlocking, the `Settings` link at the bottom of the start card leads there. Every value applies immediately; there is no “Save”. Detached windows have no settings of their own; language, appearance and vault settings still apply there. While an RDP session has the focus, shortcuts go to the remote computer, `Ctrl+,` included.

### Language

Shellherd follows the system language by default: German on a German Windows, English otherwise. The `Language` setting under Settings → General offers `System`, `Deutsch` and `English`. A change takes effect immediately in all windows, without a restart. The choice is stored in `settings.json` in the user data folder (`%APPDATA%\Shellherd\settings.json`), not in the vault.

The AI assistant answers in the selected language. kubectl-like output and raw status values stay in English. The installer follows the Windows language.

### Appearance

`Appearance` under Settings → General offers `System`, `Dark` and `Light`; the default is `Dark`. `System` follows the Windows app color mode and changes along when you switch it. The change applies to all windows at once, without a restart; open sessions keep running. Window frames and Windows dialogs follow too. In light mode the terminal, manifests and code are light as well; Shellherd lifts terminal colors that are too faint to at least 4.5:1 contrast. The picture of a Remote Desktop session stays unchanged. Like the language, the choice is stored in `settings.json` in the user data folder, not in the vault, so it applies before unlocking.

### File association

`Add to Windows` under Settings → General associates `.term` files with Shellherd: a double-click in Explorer or right-click → “Open with Shellherd” opens the vault. The association applies to the signed-in user only (HKCU) and needs no administrator rights. `Remove association` takes it out again.

### Updates

`Check for new versions` under Settings → General is on by default. At most once a day, after unlocking, Shellherd asks GitHub for the latest version (`releases/latest`) and shows it in the status bar. A click opens the release notes or skips this version. Only the request itself is sent, that is your IP address and `User-Agent: Shellherd/<version>`, nothing from the vault. Before unlocking there is no network request, and with the switch off there is none at all. The switch is also available without a vault. Shellherd does not install updates; you download and install them yourself.

### Vault

`Ask before disconnecting running sessions` (default: on) asks before closing a tab or window or switching workspaces ends running sessions. The setting belongs to the vault and is saved encrypted with it; it appears only after unlocking.

`Lock automatically after … minutes without input (0: never)` locks the vault when neither mouse nor keyboard was used in any Shellherd window (range 0 to 1,440, default 15). Open sessions and tabs are kept. The value is taken over on blur or `Enter` and applies immediately.

- **What counts:** Only mouse and keyboard in Shellherd windows. Terminal output does not count: if you only watch a long run, the vault locks. Work in other programs does not count either.
- **RDP:** While an RDP session is connected, any input on the computer counts as well, because mouse and keyboard in the RDP window bypass Shellherd.
- **Nothing is asked:** The lock works like manual locking, without a confirmation. Open settings and provider dialogs close. Detached windows are locked, not closed. After the lock, the lock screen names the reason.
- **Imprecision:** The lock comes up to 10 seconds earlier or up to 30 seconds later than set; after waking from sleep, Shellherd locks immediately if the time has run out.
- **Existing vaults:** Every vault carries the value 15, so from this version on they lock after 15 minutes; `0` turns the lock off.

### Connections

Settings → Connections (after unlocking only) holds four values for SSH and SFTP of this vault. They also apply to container and cluster access over SSH and are saved with the vault. Each field takes its value on blur or `Enter`; a number outside the limits appears as an error below the field.

| Value | Default | Limits |
|---|---|---|
| `Disconnect when idle after … minutes without input or output (0: never)` | 0 | 0 to 1,440 |
| `Keepalive every … seconds` | 15 | 5 to 300 |
| `Disconnect after … unanswered keepalives` | 3 | 1 to 10 |
| `Connection timeout … seconds` | 120 | 5 to 300 |

- **Applies from the next connection.** Open sessions keep their values; `Reconnect` picks up the new ones.
- **Idle:** Input or output resets the time. Afterwards the bar shows “idle timeout” and `Reconnect` (`Enter`). This applies to SSH terminals, container tabs, pod terminals and the file view. Local shells, RDP and cluster views have no idle limit. A file view with a running transfer, active auto-upload or an open edit does not disconnect when idle.
- **Per connection:** Under `More options` of an SSH or SFTP connection, the four values can be overridden one by one (`Idle disconnect (min)`, `Keepalive (s)`, `Keepalive misses`, `Connection timeout (s)`). Empty means: default from the settings. Containers and clusters inherit the values of the SSH node they use.
- **Short connection timeout:** It keeps running while the host key prompt is open. With a very short value, accepting a new key fails if you read for longer. Accept new keys through `Test connection` (its timer pauses in the prompt) or set a larger value.

### Terminal

Under Settings → Terminal (after unlocking) there are font, font size, scrollback, cursor shape and blinking. The values apply at once to all open terminals of this vault and are saved with it. Older Shellherd versions remove them when saving.

| Value | Default | Limits |
|---|---|---|
| `Font` | Consolas | at most 64 characters: letters, digits, spaces, `.`, `_`, `-` |
| `Font size` | 14 pixels | 8 to 32 |
| `Scrollback` | 5,000 lines | 1,000 to 50,000 |
| `Cursor` | Block | Block, Bar or Underline |
| `Cursor blinks` | yes | yes or no |

- **Font:** A name, not a list of installed fonts. Empty or not installed on this computer, Shellherd uses Consolas, then Cascadia Mono and a standard monospace font.
- **Scrollback:** Every line takes memory; 10,000 lines need about 15 MB per terminal, up to 240 MB with 16 open terminals. A smaller value trims the scrollback of open terminals.

### AI providers

Settings → AI assistant shows the number and the default of the configured providers. `Manage providers` opens the provider list, `Done` returns to the settings. The gear in the assistant panel opens the same list; keys are stored encrypted in the vault.

### Masking in the AI assistant

Before the assistant sends anything to a provider, Shellherd replaces secrets with placeholders such as `[SECRET_1]`. This applies to your question, the terminal excerpt, read output and the history sent along. The same value always gets the same placeholder within a history, so the model can refer to it. A value recognized once stays hidden in the whole history, even where no pattern shows; for this Shellherd remembers the last 1,000 recognized values per history, vault values always. `Clear history` starts over.

Recognized are:
- passwords, passphrases and API keys stored in this vault (6 characters or more), wherever they appear in the text,
- private keys (`-----BEGIN … PRIVATE KEY-----`), also cut off and base64-encoded,
- values after names such as `password`, `DB_PASSWORD`, `secret`, `token`, `api_key`, `client_secret` or `AccountKey`, with `=` or `:` and as an option (`--password …`),
- passwords in addresses (`postgres://app:…@db`),
- `Authorization: Bearer …` and `Basic …`,
- keys from AWS (`AKIA…`), GitHub (`ghp_…`, `github_pat_…`), Slack (`xox…`, webhooks), OpenAI and Anthropic (`sk-…`) and Google (`AIza…`), Azure signatures (`sig=`) and JWTs,
- values under `data:` and `stringData:` when the text contains a Kubernetes secret (`kind: Secret`).

Below your question, the assistant then shows “Sensitive values masked: 2”. The answer shows the placeholders unchanged. Shellherd never puts real values into answers or commands; otherwise injected terminal text could make the model write your password into a command. If a suggested command contains a placeholder, it shows “Contains masked values. Fill them in yourself before pressing Enter.”

Masking is on for every provider, local models included, because a local endpoint may log or forward requests. It can be switched off per provider under `Manage providers` → `Edit` → `Mask secrets before sending`. The assistant then shows “Masking is off for this provider”. If a text cannot be checked, Shellherd sends nothing.

**Limits.** Masking recognizes patterns and known values; it does not understand content. Not recognized are, for example:
- passwords without a recognizable name, such as right after a short option (`mysql -pSecret`, `sshpass -p Secret`, `curl -u admin:Secret`) or in running text, unless they are stored in the vault,
- vault passwords shorter than 6 characters, the vault password itself and answers to login prompts,
- altered values: base64 or hex encoded, split up or with spaces, `;` or `&` without quotes (then only up to that character),
- passwords in addresses that contain `/`, `?` or `#` unencoded, and values longer than 4,096 characters (then only the beginning),
- keys without a fixed format, such as plain hex keys from Azure, unless they follow a name such as `api-key`,
- Kubernetes secrets as JSON (`-o json`),
- a single line longer than the excerpt sent along (6,000 or 8,000 characters); it is cut.

Hashes, commit IDs and UUIDs stay on purpose. AI command line tools in their own tabs (Claude Code, Codex …) send by themselves and do not go through this masking. If sensitive output is on the screen, clear it (`clear`) before asking the assistant.

## Workflows

Workflows are saved commands that Shellherd types into a terminal for you. They are stored encrypted in the vault (at most 1,000) and are available in every window.

### Palette

`Ctrl+Shift+Space` or the `Workflows` button in the header opens the palette; the same shortcut closes it. It only works while the vault is unlocked, in secondary windows too. The title names the target tab (`Workflows → web-01`) or `no terminal selected`.

The search looks at name, tags, description and command, ignoring case; with several words, each must match. Workflows for the shell of the active tab and for all shells come first, alphabetically; workflows for another shell follow dimmed and can still be chosen. `↑` and `↓` select, `Enter` or a click takes the workflow, `Esc` or a click outside the palette closes it.

Without placeholders Shellherd types the command at once and closes the palette. Nothing runs: you press `Enter` yourself. Workflows go only into connected SSH, PowerShell and CMD tabs and container and pod shells; not into the file view, the container view itself, the cluster view, Remote Desktop or the welcome page. If the terminal is disconnected or runs a full-screen program such as `vim`, `less` or `top`, the palette stays open and tells you why. `Send input to all panes` does not apply to workflows; they always go into the active tab only.

### Placeholders

`{{name}}` in a command is a placeholder. Letters, digits, spaces, `_`, `.` and `-` are allowed, up to 40 characters. If a workflow has placeholders, the palette asks for each name once, in order of first use; the same name in several places gets the same value. A preview below shows the finished command. Shellherd removes line breaks and control characters from the values; an empty field stays an empty spot. `Type in` (or `Enter`) types the command, `Copy` puts it on the clipboard and closes the palette, `Back` or `Esc` returns to the list.

### Managing workflows

`Manage workflows` at the bottom of the palette opens the list, in the main window only. `New workflow` adds one, `Edit` changes it, `Delete` removes it at once without asking. `Done` closes the list. Every change is saved encrypted in the vault right away.

| Field | Rule |
|---|---|
| `Name` | required, at most 120 characters |
| `Command (single line)` | required, one line, at most 4,000 characters; join several commands with `&&` or `;` |
| `Description (optional)` | at most 2,000 characters, shown in the palette below the command |
| `Tags (comma-separated)` | at most 20 tags of up to 40 characters each; duplicates are dropped |
| `For shell` | `All`, `SSH`, `PowerShell` or `CMD`; orders the palette but blocks nothing |

Below the command field the form lists the placeholders it found.

### From the assistant

When the AI assistant suggests a command, `As workflow` opens the form with that command. Fill in the name and the other fields; `Save` adds the workflow, `Cancel` discards it. `As workflow` is available in the main window only.

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
The workspace menu contains Open, Rename, Delete and `Save as…`.
What is saved: the layout, size ratios, connection references
and the active connection per pane, in the encrypted vault. Terminal output
is not saved. `Save as…` creates another definition;
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

Agent forwarding is disabled.

If the server asks for more information during sign-in (one-time code, PIN, second
password), the dialog "Sign in to …" opens in the tab's window (terminal and file view); for containers, clusters and
the connection test it opens in the most recently used Shellherd window. Your answers go
only to this server; they are not stored and not logged. If the server asks
exactly once for a password and the connection has a stored password, Shellherd
enters it once automatically; every other question goes to the dialog. At most 6
prompts per connection, after which it fails with a message. Cancel in the dialog
ends the attempt. The connection timeout (Settings → Connections) keeps running
during the prompt; with 2FA, set the connection timeout to at least 60 s. The
dialog never appears over the lock screen; locking cancels an open prompt. Several
tabs with prompts ask one after another.


### After login

For each SSH connection, the form lets you define what happens after login.
Both apply on every connect, including `Reconnect` and when a workspace is
restored.

- `Become root after login (sudo -i)` starts the shell as root. With password
  login, Shellherd answers the sudo prompt exactly once with the stored
  password; neither the password nor the sudo call appears in the history. With
  a key or the SSH agent, Shellherd checks with `sudo -n true` whether sudo works
  without a password (NOPASSWD, also next to a `%sudo` rule). If not, a note
  appears in the terminal and sudo asks itself: you type the password once and
  it continues. There is no separate sudo password field. If sudo refuses the
  stored password, Shellherd tries again only after the login data changes.
- `Start commands` are free text, one line per command: at most 20 lines of at
  most 500 characters, no control characters and no tab (use spaces instead).
  Blank lines are dropped. Shellherd types them after login, as you would. They
  are visible and end up in the shell history. Do not put passwords or tokens in
  them.

With `root`, the start commands go out only after sudo succeeded, in the root
shell. Without `root`, they go out right after the shell starts. If the server
asks something first (expired password, selection menu, a prompt in `.bashrc`),
the start commands land there. A startup script on the server that discards
input sent ahead makes the commands disappear; Shellherd does not repeat them.
A full-screen or input program (`vim`, `top`, `ssh`) belongs on the last line
only, otherwise it reads the following lines as key presses. Typed commands can
appear twice, once as an echo before the prompt and once at the input line; that
is normal for input typed ahead.

The root shell starts without a greeting (no MOTD, no `Last login`), and `exit`
in it closes the tab instead of returning to the user shell. Every sudo call
appears in the server's auth.log; that is normal.

Older Shellherd versions remove these settings when the connection is saved.

Right-click a tab (Shift+F10 or the menu key work too) to `Rename` it. The
name applies to this tab only, not to the saved connection, and it travels
with the tab to other windows. An empty name restores the connection name. A
workspace does not save it.

## Jump host

An SSH or SFTP connection can run through another SSH connection (jump host,
bastion). In the form, choose the connection under `Jump host` in `More options`.
Shellherd connects to the jump host first and continues from there to the host
and port in the form; those are seen from the jump host.

- Exactly one hop. The jump host may not have a jump host of its own and may not be
  the connection itself. Chains are not supported yet. The form rejects both;
  Shellherd checks again when connecting.
- Deactivated SSH connections are marked; a connection cannot be saved while it
  uses a deactivated jump host.
- The jump host uses its own credentials, timeouts and host key check. If it asks
  for 2FA, the dialog names it.
- The jump host applies to the terminal, the file view, containers, clusters and the
  connection test. The connection test shows the step "Jump host … connected".
- Deleting: the selection in other connections stays, and the delete dialog states
  how many use it. Those connections fail with a message until you choose another
  jump host or `None`. Shellherd does not silently switch to a direct connection,
  because that would bypass the bastion.
- A changed key of the jump host appears as the cause in the error card, without
  fingerprints. `Test connection` on the jump host shows it.

Risks:

- **known_hosts:** The same internal address (e.g. `10.0.0.5:22`) behind two
  different jump hosts shares one key entry in Shellherd. The second connection then
  reports "key changed". Shellherd has no alias like OpenSSH `HostKeyAlias`. Avoid
  connections with the same target address behind different jump hosts.
- **Several 2FA hosts:** If you open a workspace with many connections through 2FA
  jump hosts, the prompts come one after another. Later sessions can run into the
  connection timeout; then use `Reconnect`.
- **No sharing:** Each tab builds its own jump host hop and is asked the 2FA again.
- **Older versions** (0.18 and older) remove the setting when saving.

## Port forwards

Under `More options` of an SSH connection you define port forwards (at most 16).
They belong to a terminal session of this connection.

| Kind | What happens |
|---|---|
| Local (-L) | Listens on 127.0.0.1 of this computer only. The target (host and port) is seen from the server. |
| Remote (-R) | Listens on the server at `localhost`. Other machines reach the port only with `GatewayPorts` in `sshd_config`. The target is seen from this computer. |
| Dynamic (-D) | SOCKS5 proxy without authentication on 127.0.0.1. Enter it as SOCKS proxy in your browser or program. TCP only, no UDP. |

- The "Port forwards" bar below the terminal shows each forward with its state and a
  button to start or stop it. It appears as soon as the connection is up.
- With "Start on connect", Shellherd starts the forward after sign-in if it is not
  running in another tab. This happens only for a connection you open yourself.
- A forward runs at most once across the app. If it runs in another tab, the bar
  shows only "running in another tab". As soon as the other tab stops or closes it,
  a "Start" button appears here.
- Changes to the list apply from the next connection; `Reconnect` picks them up.
- Ending the session (closing the tab, disconnecting, idle timeout) stops its
  forwards. Open connections through a forward keep the session from idling out.
- While locked, running forwards keep running; starting is not possible.
- If the port is already used on this computer, the bar says so. If the server refuses,
  the cause is usually `AllowTcpForwarding` or a port in use on the server.
- Pods and services in the cluster are not included; the cluster view still offers
  the `kubectl port-forward` command to copy.
- **Risk remote:** With `GatewayPorts yes` on the server, the port is reachable from
  the network. Shellherd does not prevent this; without that setting it stays on
  `localhost` of the server.
- **Older versions** (0.18 and older) remove the forwards when saving.

## Importing connections

`New` → `Import` (or the welcome page) takes over connections from other programs. The source is read only after the click; a preview with checkboxes shows everything found before anything is saved. Existing connections stay unchanged. Reading runs apart from the rest of the app and stops after 5 seconds, so a damaged file cannot block Shellherd.

- **OpenSSH:** the file `~/.ssh/config`, chosen in the file dialog (default `%USERPROFILE%\.ssh\config`).
- **PuTTY:** the sessions under `HKCU\Software\SimonTatham\PuTTY\Sessions`, read only, via `reg.exe export`.
- **WinSCP:** the sessions under `HKCU\Software\Martin Prikryl\WinSCP 2\Sessions`, also read only. Sessions from a portable `WinSCP.ini` are not read. SFTP sessions become file connections, SCP sessions become SFTP.
- **mRemoteNG:** the file `confCons.xml`, chosen in the file dialog (default `%APPDATA%\mRemoteNG\confCons.xml`). If the file is fully encrypted, the import stops with a note. RDP connections arrive as remote desktop connections with a domain, without a password.

Imported are host, port, user name, key path, port forwards and, for WinSCP and mRemoteNG, the folders. Not imported are passwords, passphrases and key contents. Key files are never opened; Shellherd stores only the path. PuTTY keys (`.ppk`) get a hint, because Shellherd reads only format 2 with RSA.

- **Duplicates:** a connection with the same host, port and user name as an existing SSH or SFTP connection is marked and unchecked in advance; RDP is compared with RDP. You can still select it.
- **Jump host:** imported only if it is exactly one hop to another entry of the same source and is selected too. WinSCP and mRemoteNG import no jump host.
- **Port forwards** do not start automatically after the import, only by click.
- **Target folder:** by default a new folder “OpenSSH import”, “PuTTY import”, “WinSCP import” or “mRemoteNG import” at the top level. You can also choose an existing folder or the top level. A new import folder can be taken back with one delete.
- **Not imported:** sessions of other protocols such as FTP, Telnet or VNC. The preview names their number.

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
header shows the state: “Live” with the age of the data (“updated 12 s ago”); while
reconnecting, in yellow, the host and the attempt (“Connecting via k8s-cp2… (attempt 2)”);
afterwards, briefly in green, “Reconnected via <host>”. The table stays readable and unchanged
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
Text filters from the context menu (e.g. `app=api`) appear as a “Filter” chip and can
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

## File view: keyboard and transfers

Typing in the file list jumps to the next entry whose name starts that way. The search follows the order shown, folders first. When you type quickly, Shellherd searches for the whole prefix (`no` finds `notes.md`); the same letter repeated moves to the next match each time. After a one-second pause the search starts over. Upper and lower case do not matter. This works on the local and the server side. The space bar, combinations with `Ctrl` or `Alt` and characters that need `AltGr` (such as `@`) do not jump.

`Ctrl+L` in the file list, a double-click on the path bar or ⚙ → `Go to…` turns the path bar into an input field. `Enter` opens the folder, `Esc` cancels. On the server, `~` and `~/…` lead to the home folder; a path without a leading `/` starts from the current folder. Locally, drive paths (`D:\Projects`, also with `/`), network shares (`\\server\share`), `~` and paths starting from the current folder work; device paths such as `\\?\` do not. If the folder is missing, is a file or you lack the rights, the error appears under the field and the previous folder stays.

`Ctrl+F` in the list or ⚙ → `Filter…` shows a filter field. It shows only entries whose name contains the text; upper and lower case do not matter. `Enter` or `↓` returns to the list. `Esc`, `×` or a folder change removes the filter.

⚙ → `Hide hidden files` hides names that start with a dot (`.bashrc`, `.git`). This applies separately to the local and the server side and is remembered for all connections. Locally only the dot counts, not the Windows attribute “Hidden”. The default is to show everything.

Hidden and filtered-out entries cannot be selected, copied, moved or deleted; `Ctrl+A` selects only what is visible. A folder is always copied or deleted completely, including the hidden files inside it. The status line shows how many entries are hidden (`4 hidden`). Nothing from the file view can be dragged into Explorer. To download, select the target folder on the left (for example with `Ctrl+L`) and press `F5`.

Running transfers show their speed next to the progress after the first second (`12 MB/s`), smoothed over the last few seconds. While the question about an existing file is open and on finished transfers no speed is shown. Auto-upload shows none. Shellherd keeps just under four megabytes of requests in flight and copies up to four files of a folder in parallel; the row names the files currently running.

Canceled or failed transfers can be resumed with `Resume`, also after `Reconnect`. This applies to uploads and downloads. Each file is first written as `name.part` and replaces the target only at the end. If you transfer the same file again later, Shellherd resumes automatically; there is no automatic reconnecting.

Before resuming, Shellherd checks the leftover `.part`: it must not be larger or older than the source, and the last megabyte before the resume point must equal the source. Shellherd resumes just under four megabytes before the end of the partial file, because data up to that point may still have been in flight; the megabyte before it is compared with the source. The row then shows “resumed from 4.1 GB”. If the partial file does not match, the transfer starts over and the row says so. A partial file of up to just under four megabytes is rewritten without a check and without a note.

`Cancel` keeps the partial file. `Discard partial file` deletes it (local files go to the recycle bin) and is unavailable while a transfer is running. For uploads it needs a connection. To start over, discard the partial file and transfer again. For folders Shellherd asks about files that are already finished as usual; `Only if newer` with `For all` skips them. Resuming works per file. Auto-upload still cleans up its own partial files.

`Verify` on a finished, resumed transfer computes the SHA-256 checksum of every file locally and with `sha256sum` (or `shasum` on macOS) on the server and shows whether they match. This needs a shell on the server; SFTP-only accounts report that no checksum is possible. File names with characters such as `&`, `$`, `\` or `'` cannot be verified. `Verify` is not offered for moves, covers up to 10,000 files per transfer and works only in the session in which the transfer ran.

Limits: If the source gets shorter while a resumed transfer runs, the target stays too long; `Verify` reveals it. Shellherd treats a file named `name.part` as its own. A folder with that name is never touched; the transfer reports an error instead.

## File view: auto-upload

Auto-upload mirrors a local folder into a server folder while the connection's file view is open. You set it up in the local pane: the gear ⚙ in the pane header offers `New file`, `New folder` and `Auto-upload` for the folder shown. Right-clicking a folder works too. The dialog asks for the local folder, the server folder (prefilled with the current server folder) and the excludes. `Start auto-upload` begins the comparison; a list below shows each binding as “Watching”, “Syncing…” or the error. The binding is stored in the vault and starts by itself the next time the file view opens.

**Rules:**

- **Local → server only.** Nothing is downloaded; Shellherd never fetches changes from the server.
- **Never deletes.** If you delete or rename a local file, the old one stays on the server (also for `Foo` → `foo`: the server then has both).
- **At start** size and modification time are compared: missing and locally newer files are uploaded once, afterwards only changes.
- **Newer on the server:** A file that is newer on the server, or was changed there by someone else, is skipped. The row shows the number (“2 skipped, newer on the server”), a notice the names. `Overwrite anyway` replaces all skipped files with the local ones.
- **Pause, Resume, Edit, Remove** are on the row. `Remove` only deletes the binding, no files.
- **Lost connection:** The binding pauses with the connection. After `Reconnect` it starts again and catches up on everything missed.

**Excludes** are a list of patterns, one per line, as in `.gitignore`. The defaults are `.git`, `node_modules/`, `~$*`, `*.swp`, `*.tmp` and `.DS_Store`.

| Pattern | Matches |
|---|---|
| `.git` | any file or folder `.git` at any level, with its contents |
| `node_modules/` | folders of that name only (trailing `/`) |
| `*.log` | all files ending in `.log`, hidden ones too |
| `/build/` | only the folder `build` directly in the bound folder, not `src/build` |
| `secrets/**/*.pem` | `.pem` files under `secrets` at any depth, from the bound folder only |

Without `/` a pattern applies at every level, with a leading or inner `/` only from the bound folder, with a trailing `/` only to folders. `\` counts as `/`. Upper and lower case do not matter (`Build/` also excludes `build`). There are no exceptions with `!`. Excluded folders are not traversed.

**Good to know:**

- **Exclude secrets:** The defaults do not exclude `.env`, keys or credential files. Exclude them yourself (for example `.env` and `*.pem`), otherwise they land on the server, new files with permissions 0644.
- **Renaming folders:** While the file view with an active binding is open, Windows does not let you rename or move the parent folder. Pause the binding or close the file view.
- **Unreadable subfolders:** If Shellherd cannot read a local subfolder, the comparison stops and the binding shows an error. Exclude the folder with a pattern.
- **Two bindings, one server folder:** Allowed. They do not overwrite each other silently but skip with a notice.
- **Paths are machine-specific:** The local path only applies on the computer that created the binding. On another computer the row reports that the folder is missing; you can edit or remove it there.
- **Set up in the main window only:** Setting up, editing, pausing and removing work in the main window only. In other windows bindings keep running, and `Overwrite anyway` works everywhere.
- **Network drives:** Changes on shares are reported unreliably; anything missed is caught up at the next start.

## Notices and connection state

Shellherd shows problems where they occur.

- **At the field:** An invalid entry appears in red directly below the field, and focus jumps to it.
- **In the pane:** If something fails in an area (sidebar, menu, terminal), a card with title, cause and button appears there.
- **Bottom right:** Background events appear as a notice. Errors stay until you close them. Info notices (5 seconds) and success notices (3 seconds) disappear on their own; a thin bar shows the time left, and it pauses while the mouse is over it or the window is hidden. At most three notices are visible.

**Connecting:** If connecting takes longer than 0.4 seconds, the pane shows the steps “Reaching server”, “Checking server key”, “Signing in” and “Opening shell” with the time per step. `Esc` or `Cancel` aborts. If the server answers slowly, a hint appears.

**Errors:** If the connection fails, the card names the cause (for example “Sign-in rejected”, “Server not responding”, “Server key has changed”) and the next step. Depending on the case, `Edit connection`, `Reconnect` or `Copy fingerprint` are offered; `Details` shows the server's raw text.

**Disconnected:** If the server ends the session or it drops, the output stays visible. A bar at the bottom says how long ago that was and offers `Reconnect` (`Enter`). This also applies to RDP and the file view. If Shellherd ended the session because of the configured idle time (see Settings → Connections), the bar names the reason “idle timeout”.

**Saving:** Buttons show “Saving…” and then briefly “Saved” without changing their width. If saving the vault file fails, the notice names the reason (read-only, locked by another program, folder missing, drive full). For container actions, the status column shows the target state (“stopping”, “restarting”) until the list has refreshed.

## Server keys

On first contact, compare the displayed SHA-256 fingerprint with a trusted source. Only explicitly confirmed keys are saved in `known-hosts.json` in the Electron user data directory. This file contains hosts, ports and public fingerprints, no credentials. It is located at `%APPDATA%\Shellherd\known-hosts.json`; on first start Shellherd takes it over once from `%APPDATA%\Terminus`. Mismatching keys and corrupted trust files abort the connection.

Settings → Connections → `Manage server keys` shows all confirmed and imported keys with host and port (hashed entries: “Hashed host name”), type for imported entries and SHA-256 fingerprint. The search field filters by host, type or fingerprint. `Remove` deletes an entry immediately; on the next connection Shellherd asks again. To accept an intended key change: remove the old entry, connect again, check the new fingerprint and confirm it. You find a hashed entry by the fingerprint that the error card names as `expected`.

`Import from known_hosts…` reads an OpenSSH file that you choose in the dialog (suggested: `%USERPROFILE%\.ssh\known_hosts`, at most 4 MiB). Taken over are host names, `[host]:port` and hashed names (`|1|…`) with Ed25519, ECDSA and RSA keys, also several per server. The list shows hashed entries as “Hashed host name”. `@revoked` lines apply to all hosts: a key marked this way is never accepted by Shellherd, not even after a prompt. Skipped are `@cert-authority`, patterns such as `*.example.com` or `!host`, certificates and security keys (`sk-…`). The import does not change any key you have confirmed in Shellherd: for such servers Shellherd's entry continues to apply, and if the file deviates from it, the result names the server. Shellherd reads `known_hosts` only after this click and never writes it.

## Process boundaries and lifecycle

- Main: encrypted files, vault session key, `ssh2`, host key verification.
- Preload: explicit, typed IPC methods; events without the Electron event object.
- Renderer: React and xterm.js; no Node, file system or socket access.
- SSH requests use saved connection IDs and ownership-bound session IDs.
- Output pauses while xterm acknowledgements are pending; input and scrollback
  are limited. Terminal output is not logged to disk.
- Disconnecting, idle disconnect, closing the window, `Other vault file` and a renderer crash end the SSH session. Locking the vault (manual or automatic) does not; the credentials of open sessions stay in memory for that.
  With active sessions, closing is confirmed according to the vault setting.

The SSH tests run a local `ssh2` server with test keys generated at runtime
and synthetic credentials. They check real handshakes,
shell I/O, resize, errors, ownership boundaries, parallel sessions and backpressure.
Further tests cover tab selection and closing individual tabs as well as
serialized host key confirmations.
