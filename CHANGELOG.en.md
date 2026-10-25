# Changelog

All notable changes to Shellherd (called Terminus up to 0.9.0). Version numbers follow [Semantic Versioning](https://semver.org/):
MAJOR for incompatible changes (e.g. to the vault format), MINOR for new features, PATCH for bug fixes.
Every version needs a section `## [x.y.z] – YYYY-MM-DD` here; the build fails otherwise.

## [0.26.0] – 2026-10-25

- New: Windows Hello. Settings → Vault → `Unlock with Windows Hello (PIN, face or fingerprint)` turns it on per vault and device. Afterwards `Unlock with Windows Hello` unlocks the lock screen, also after the automatic lock, and `Open with Windows Hello` opens the file in `Open vault`, also after a restart. The password keeps working.
- Security: Shellherd never stores the password for this, but the vault key, encrypted with a key that only a Windows Hello signature creates (with a TPM in the security chip). A replaced vault file or a newly set up Windows Hello makes it invalid; `×` under `Recently used` deletes it.

## [0.25.0] – 2026-10-25

- Security: The AI assistant masks secrets before anything goes to the provider: passwords, passphrases and API keys from the vault, private keys, `password=` and `secret:` values, passwords in addresses, Bearer and Basic headers, keys from AWS, GitHub, GitLab, Slack, Stripe, npm, OpenAI, Anthropic, Google and Azure, passwords in `.netrc` and `ConvertTo-SecureString`, JWTs and the data of Kubernetes secrets. The same value keeps the same placeholder in the history (`[SECRET_1]`); Shellherd never puts real values back into answers or commands.
- New: Below the question, the assistant shows how many sensitive values were masked. Commands with a placeholder carry a hint. Masking is on for every provider, local models included, and can be switched off per provider.
- Fixed: The assistant reads wrapped terminal lines as one line and cuts long output only at line boundaries.

## [0.24.0] – 2026-10-25

- New: Settings → Connections → `Manage server keys` lists all confirmed and imported server keys with SHA-256 fingerprint, with search and `Remove`. An intended key change can thus be accepted.
- New: Import from OpenSSH `known_hosts`, also with hashed names, `[host]:port` and several key types. `@revoked` is respected, `@cert-authority` and patterns are skipped. The import never changes keys confirmed in Shellherd.
- Security: While locked, all Shellherd windows are excluded from screen captures and screen sharing.
- Security: Shellherd opens vault files only from the file dialog, Explorer, `Recently used` or by dragging from a local drive. Network paths from other sources are refused.

## [0.23.0] – 2026-10-25

- New: Path field in the file view with `Ctrl+L`, also via ⚙ → `Go to…`; the double-click works as before. It understands `~`, paths from the current folder and locally `/` instead of `\`. Errors such as “The file or folder was not found.” or “This is not a folder.” appear at the field; the previous folder stays.
- New: Filter by name with `Ctrl+F` in the file list, separately per side. It checks “contains”, ignoring upper and lower case, and ends when the folder changes. Copy, move, delete and `Ctrl+A` act only on visible entries.
- New: ⚙ → `Hide hidden files/Show hidden files`, per side, for names starting with a dot. The default stays: show everything. The footer counts the hidden entries.
- Security: The local file view no longer opens device paths (`\\?\`, `\\.\`).

## [0.22.0] – 2026-10-25

- New: `Open vault` shows the up to eight most recently used vault files with date and folder. One click selects a file; missing files are marked and can be removed from the list with `×`. Only paths and times are stored in `settings.json`, never contents.
- New: Light theme. Settings → General → `Appearance` offers `System`, `Dark` and `Light`; the default stays `Dark`. The change applies at once in all windows, including window frames and Windows dialogs; in the light terminal Shellherd raises colors that are too pale to a readable contrast.
- Docs: chapter “Workflows” in the manual (palette, placeholders, managing, taking over from the assistant).

## [0.21.0] – 2026-10-24

- New: Import connections from OpenSSH (`~/.ssh/config`, choose the file), PuTTY and WinSCP (sessions from the Windows registry, not from a portable `WinSCP.ini`) and mRemoteNG (`confCons.xml`, choose the file). Find it under `New` → `Import` and on the welcome page. A preview shows all connections found with checkboxes before anything is saved. Existing connections stay unchanged. Reading runs apart from the rest of the app and stops after 5 seconds, so a damaged file cannot block Shellherd.
- New: Host, port, user name, key path, port forwards and the folders of WinSCP and mRemoteNG are imported. Passwords, passphrases and key contents are not: key files are never opened, only their path is stored. Enter the password once in the form. WinSCP sessions with SCP come in as SFTP; sessions of other protocols (such as FTP, Telnet or VNC) are left out. PuTTY keys (`.ppk`) get a hint, because Shellherd reads only format 2 with RSA. RDP connections from mRemoteNG arrive as remote desktop connections with a domain, without a password.
- New: Duplicates, that is connections with the same host, port and user name as an existing SSH or SFTP connection (RDP is compared with RDP), are marked and unchecked in advance. A jump host is imported only if it is exactly one hop to another entry of the same source and is selected too; WinSCP and mRemoteNG import no jump host. Port forwards do not start automatically after the import, only by click.
- New: The target folder is by default a new folder “OpenSSH import”, “PuTTY import”, “WinSCP import” or “mRemoteNG import” at the top level. You can also choose an existing folder or the top level. A new import folder can be taken back with one delete.
- New: Update notice. At most once a day, after unlocking, Shellherd asks GitHub for the latest version and shows it in the status bar. There you open the release notes or skip this version. The notice is on by default and can be switched off under Settings → General. Only the request to GitHub is sent, with your IP address and the Shellherd version, nothing from the vault. There is no automatic update; you install updates yourself.

## [0.20.0] – 2026-10-24

- New: Search in the terminal with `Ctrl+Shift+F`. `Enter` finds the next match, `Shift+Enter` the previous one, `Esc` closes the search. Upper and lower case do not matter. Matches are highlighted by the selection and are not copied to the clipboard. The terminals in the container and cluster docks have no search; there `Ctrl+Shift+F` goes to the terminal.
- New: Links in the terminal open in the browser with `Ctrl+click`. Only `http` and `https` addresses up to 2048 characters are allowed, without user name and password. Everything else stays text. Hovering over a link shows a hint in the terminal.
- New: Tab shortcuts in the focused pane: `Ctrl+Tab` and `Ctrl+Shift+Tab` switch the tab, `Ctrl+Shift+T` opens the connection picker, `Ctrl+Shift+W` closes the active tab with the usual confirmation. `Ctrl+F`, `Ctrl+T` and `Ctrl+W` stay with the shell (one character forward, swap characters, delete word), which is why the Shift variants are used.
- New: Settings → Terminal (after unlocking) for font, font size (8 to 32 pixels, default 14), scrollback (1,000 to 50,000 lines, default 5,000), cursor shape and blinking. The values apply at once to all open terminals of the vault; a smaller scrollback trims open terminals.
- New: When closed, the main window remembers its size, position and maximized state in `settings.json`, not in the vault. The next start restores them if the place is still visible. A window closed while minimized keeps the saved position.
- New: A tab whose terminal is not visible shows a ring after its name when new output arrives; the name turns bold and light. As soon as the tab becomes visible, the mark disappears.
- New: Input to all panes, in the pane header menu (from two panes). What you type goes to all connected SSH and local terminals of the shown view. Containers, pods, RDP, SFTP, clusters and the welcome page stay out. The panes show a warning line and the button “To all”, which stops the input. It ends when you switch views, and also when fewer than two terminals remain.
- Note: Older Shellherd versions remove the terminal settings when saving.

## [0.19.0] – 2026-10-24

- New: Servers that ask questions during sign-in (one-time code, PIN, second password, 2FA) open a "Sign in to …" dialog. If the server asks only for the password, Shellherd enters the stored password once automatically. Answers are never stored.
- New: Jump host for SSH and SFTP connections (exactly one hop). Shellherd connects to the jump host first and continues from there, in the terminal, the file view, containers, clusters and the connection test. Choose it under "More options".
- New: Port forwards on SSH connections: local (-L), remote (-R) and SOCKS proxy (-D). Local and SOCKS listen on 127.0.0.1 only. The "Port forwards" bar below the terminal starts and stops them; a port forward runs in only one tab at a time across the app. Changes apply from the next connection.
- Older Shellherd versions remove jump hosts and port forwards when saving.

## [0.18.1] – 2026-10-22

- The installer is about 14 MB smaller. The package ships only the German and English Chromium locale packs and no longer carries sourcemaps, TypeScript sources or duplicated UI libraries.

## [0.18.0] – 2026-10-21

- New: Canceled or failed transfers can be resumed with Resume from where they stopped, also after Reconnect. A leftover partial file is reused when the same file is transferred again and it matches the source.
- Cancel now keeps the partial file, Discard partial file deletes it (local files go to the recycle bin). Auto-upload still cleans up its own partial files.
- Transfers now keep many requests in flight instead of one at a time and copy up to four files of a folder in parallel. Over the internet they are many times faster.
- New: Verify compares the SHA-256 checksum of every file locally and on the server after a resumed transfer.
- New: Right-clicking a tab offers Rename. The name applies to the tab only, not to the saved connection.
- Removed: Connect without start commands from the tab menu.

## [0.17.0] – 2026-10-21

- New: In the file view, typing a letter jumps to the next entry that starts with it. Typing quickly builds a name prefix; the same letter again moves to the next match. This works on the local and the server side.
- New: Transfers show their speed (e.g. 12 MB/s) next to the progress after the first second.

## [0.16.0] – 2026-10-21

- New: SSH connections can become root after login (sudo -i). With password login, Shellherd answers the sudo prompt once with the stored password; with a key or agent, sudo asks in the terminal if NOPASSWD is not set up.
- New: Start commands per SSH connection, one line per command. They are typed after login, visible and in the shell history.
- New: Right-clicking an SSH tab offers Connect without start commands. This connects once without the root shell and without start commands.
- Older Shellherd versions remove these settings when saving.

## [0.15.0] – 2026-10-21

- New: Locking no longer disconnects. A lock screen covers the window; sessions and tabs keep running and are back after unlocking. New connections and Reconnect work only after unlocking. The credentials of open sessions stay in memory.
- New: Detached windows lock too and show their own lock screen; you unlock in the main window. The automatic lock no longer closes detached windows.
- New: On the lock screen, Other vault file switches the file after a confirmation and disconnects all sessions.
- The lock button locks without a confirmation.
- New: The welcome page is a tab. It appears when a vault opens, can be reopened from the + menu (Welcome page) and can only be closed.
- Without tabs, the stage shows the empty area instead of the welcome page.
- The local command prompt is now called cmd (local).

## [0.14.0] – 2026-10-21

- New: The vault locks automatically. `Lock automatically after … minutes without input` under Settings → Vault counts mouse and keyboard in all Shellherd windows; terminal output does not count. All sessions are disconnected, detached windows closed, and the start card names the reason. Unsaved input in the connection form is lost.
- Existing vaults now lock after 15 minutes without input (the value was already stored but had no effect). `0` turns the lock off.
- With a connected RDP session, any input on the computer counts, because the RDP window bypasses Shellherd.
- New: Settings → Connections with idle disconnect (default: never), keepalive interval and misses, and connection timeout. The values apply to SSH and SFTP, including containers and clusters over SSH, from the next connection.
- New: Under `More options` of an SSH or SFTP connection, the four values can be overridden one by one.
- New: After an idle disconnect, the disconnected bar shows “idle timeout”. Local shells, RDP and cluster views have no idle limit; a file view with a transfer, auto-upload or an open edit does not disconnect.
- Note: The connection timeout keeps running during the host key prompt; with a short value, accept new keys through `Test connection`. An older Shellherd removes the new values when saving the vault.

## [0.13.0] – 2026-10-20

- New: Auto-upload in the file view. A local folder is mirrored into a server folder while the file view is open; set up from the gear ⚙ in the local pane (`Auto-upload`). The binding is stored in the vault and starts by itself.
- Auto-upload only uploads local → server and never deletes on the server. A file that is newer there is skipped; `Overwrite anyway` replaces it.
- Excludes are patterns as in `.gitignore` (e.g. `node_modules/`, `*.log`, `/build/`), set when setting up and editable later. The defaults do not exclude `.env` and keys.
- After a lost connection, `Reconnect` catches up on missed changes; setting up and editing work in the main window only.

## [0.12.1] – 2026-10-20

- Fixed: Downloads from the file view only land in the chosen target folder; names Windows cannot store (`\`, `:`, device names, trailing dot or space) are skipped or rejected with a message.
- Fixed: When overwriting, the old file is kept until the new one has arrived completely.
- Fixed: Uploaded files keep their permissions when overwritten; new files get 0644 instead of 0666.
- Changed: `Edit` opens only text, configuration and source files in the default program; scripts and everything else open in Notepad, locally too.
- Changed: The AI assistant no longer types commands itself; `Type in` writes the suggestion to the input line.
- Fixed: The vault file is written to disk before it is renamed; saving while locking no longer returns a wrong result; after `.term` is appended, Shellherd remembers the new path.
- Fixed: Failed RDP connections show the error instead of staying on “Connecting”.
- Fixed: Moving a view to another window leaves no session behind when one of them has just ended.
- Fixed: The cluster view shows only the events of the selected object; the kubeconfig search works despite a login banner; the pod terminal names the cause.
- Fixed: The connection test waits while the host key dialog is open; the language setting reports when it cannot be saved.
- Fixed: Numbers in messages follow the language (e.g. “1,000 skipped”); the drag preview in other windows also disappears when the view is closed during the drag.

## [0.12.0] – 2026-10-19

- Shellherd is now available in German and English. It follows the Windows display language by default; “Language” in Settings (gear in the header, `Ctrl+,`, also on the start card) switches between System, Deutsch and English. The change applies to all windows at once, and open sessions keep running.
- New “Settings” dialog: the language, the `.term` file association, the question before disconnecting running sessions (per vault, previously without a switch) and the entry to the AI providers in one place.
- Error messages, dialogs, window titles and the AI assistant follow the selected language; the assistant answers in that language.
- Dates, numbers, file sizes, sorting and search follow the language. The “Describe” output in the cluster view now uses English field names like `kubectl describe`.
- The installer shows its texts in German or English to match the Windows language. Release notes and the manual are available in both languages (`docs/manual.md`).

## [0.11.0] – 2026-10-19

- New color scheme “Bernese Copper”: the accent is now copper instead of cyan, matching the Shellherd mark. Surfaces and text are a touch warmer; copper is used only for focus, selection and actions, and yellow, green and red only for states.
- Connecting in steps: if connecting takes longer than 0.4 seconds, the terminal shows “Reaching server”, “Checking server key”, “Signing in” and “Opening shell” with the time per step and a hint when the server answers slowly. `Esc` cancels.
- Understandable connection errors: a card in the terminal names the cause and the next step (sign-in rejected, server not responding, server key changed and more) and offers `Edit connection`, `Reconnect` or `Copy fingerprint`; `Details` shows the raw text.
- Disconnected sessions: the output stays in place, a bar shows how long ago the disconnect happened, and `Reconnect` (`Enter`) starts over. This also applies to RDP and the file view.
- Notices at the bottom right come in three levels: errors stay until you close them, info and success notices disappear after 5 and 3 seconds (a bar shows the time left). Error messages appear right at the field or in the area instead of only at the top of the window.
- Save buttons show “Saving…” and “Saved” without changing their width. Write errors of the vault file name the reason (read-only, locked, folder missing, drive full).
- Cluster view: the table stays readable while reconnecting. A status bar shows “Live” with the age of the data, while reconnecting the host and the attempt, and afterwards “Reconnected via <host>”. Actions are locked until then.
- Container view: while an action runs, the status cell shows the target state (“stopping”, “restarting”) instead of fading the row.
- Consistent texts: prompts without “please”, “…” as a single character, one status vocabulary for tabs, terminal, RDP and file view. Status dots have the same size everywhere, and arrows on banners and docks are icons instead of text characters.
- If connecting is waiting for you to confirm the server key, the card says so instead of warning about a slow connection.
- Fixed: release notes show `keys` and buttons as code instead of raw backticks; the dot in notices sits at the height of the title; “Details” in the error card no longer changes its width; checkboxes and radio buttons in forms have their normal size again.

## [0.10.0] – 2026-10-19

- First public release on GitHub: installer (`Shellherd-Setup-0.10.0.exe`) and portable version (`Shellherd-Portable-0.10.0.exe`) for Windows x64, MIT license.
- Terminus is now called Shellherd: new app icon in the window, taskbar, header and start card, new name in all texts. Vault files (`.term`, older `.terminus`) and their format stay unchanged.
- Settings migrate automatically on first start: known SSH host keys and the last opened vault file are taken over from the old Terminus folder; the old folder stays in place.
- File association: “Open with Shellherd” replaces the old entry the next time you associate; `.term` shows the Shellherd icon in Explorer.
- The RDP helper is now called `Shellherd.RdpHost.exe`; the developer switches are `SHELLHERD_RDP_DEBUG`, `SHELLHERD_RDP_MODE` and `SHELLHERD_RDP_SMARTSIZE`.
- Local interface preferences (selected AI provider, assistant open, release notes already seen) start over once after the move.

## [0.9.0] – 2026-10-18

- Container view for Docker and Podman, per SSH connection and for “This computer”: right-click → “Open container view” (locally “Open local container view”). Tabs for containers, images, volumes and networks with column filters, chips, grouping, sorting, context menus and keyboard shortcuts; filters and grouping apply per tab. The list refreshes every 10 seconds while the tab is visible, and with `F5`.
- Dock with logs, shell and inspect; inspect masks env values with sensitive names. Starting runs without confirmation, stopping, restarting and removing ask first, and removing requires typing the name.
- Container views of SSH hosts are saved in workspaces.
- Sidebar: under SSH connections and “This computer”, the entries “Docker view” and “Podman view” (only for installed runtimes) replace the container lists. One click opens the view or focuses the open tab; “Open Docker view” in the context menu opens another one. The tabs are fixed to their runtime and are saved with it in the workspace. Proxmox guests stay unchanged.
- Container view: with `sudo` in password mode, each poll now signs in only once, and the four lists run in a single command. A fixed Docker or Podman tab shows an error when the runtime is missing instead of querying the other runtime in the background. Inspect also masks secrets behind other entries on the same line in unparsable output.
- Consistent look: colors, shadows and layers come from a shared design system. Dialogs, the connection picker and the workspace and layout menus fade in briefly, and buttons give slightly when clicked. If Windows animation effects are turned off, only the fade-in remains. The help in the cluster and container views now sits above the header.
- Error messages appear as a notice at the bottom right and no longer shift the terminal. Bars, buttons, font sizes and spacing follow a fixed scale; the chip bar and pane headers are more compact.

## [0.8.0] – 2026-10-18

- Kubernetes table with column filters: text (contains), selection for namespace, status, type, node and roles, numbers (`>3`, `<=5`, `3`) and age (`<10m`, `>1h`, `<2d`). `/` jumps to the name filter (events: message), `F` resets all filters of the tab.
- “Group by” (e.g. namespace, node, status, owner) with collapsible groups; filters and grouping are kept per tab and in the workspace.
- The command line at the top right (`/` search and `:` commands such as `:ns`, `:filter`, `:status`) is gone. Namespaces without pods are reachable through “all” and the namespace filter. Text filters from the context menu (e.g. `app=api`) appear as a “Filter” chip.
- The last opened vault file is preselected on start.
- A cluster tab without a configured namespace starts with all namespaces.

## [0.7.0] – 2026-10-18

- Kubernetes search: multiple terms (AND), `"phrase"`, `!exclusion`, `key=value` and `key!=value` for labels, `field:value` qualifiers and number comparisons (`restarts>3`, `count>=5`); the help (`?`) lists syntax and qualifiers per tab.
- Chip bar with status filters and counts per tab; `w` shows only notable items, `F` resets search and chips, `:filter` and `:status` set them by command, and the context menu offers “Show only <filter>”. Search and chips are kept per tab.
- Jobs show their status, pods also Evicted and Unknown, nodes a hint under pressure.
- Events are sorted by “Last seen” descending by default.

## [0.6.0] – 2026-10-16

- Kubernetes context menus: right-click and `Shift+F10` on rows, containers, node tiles, problems, column headers, the bottom area and the background of the cluster tab.
- Copy (name, namespace, `kubectl` commands, YAML, describe) and jumps to owner, node, namespace and involved object; “Open SSH connection” finds the matching vault connection for the node.
- New actions with confirmation: resume, suspend and run a CronJob now, cordon and uncordon a node; `drain` only as a copyable command.

## [0.5.0] – 2026-10-16

- Kubernetes clusters (stage 1): setup from an SSH connection (“Set up as Kubernetes cluster…”), access through an SSH tunnel with failover across further access hosts; cluster tab with a live table for nodes, workloads, pods and events, drill-down, logs, shell, YAML, describe, restart, scale and delete with confirmation; production and read-only mode.

## [0.4.0] – 2026-10-15

- Disable connections (right-click → “Disable”): grayed out, cannot be opened and are skipped by “Connect all” and in workspaces; credentials are kept.

## [0.3.0] – 2026-10-14

- Containers and VMs under SSH connections: Docker, Podman and Proxmox (LXC/VMs) are detected on expanding; nothing needs to be installed on the server.
- Shell in containers and LXC by double-click, follow logs, start/stop/restart; serial console for Proxmox VMs.
- Local Docker Desktop or Podman under “This computer”.
- Option “Run container commands with sudo” (sudo -n) per SSH connection.

## [0.2.0] – 2026-10-14

- Remote desktop (RDP) right in the tab, without additional installation, with key combinations such as Ctrl+Alt+Del.
- Local PowerShell and Command Prompt as a connection type.
- SFTP file browser in WinSCP style: this computer on the left, the server on the right, a queue and a prompt for existing files.
- Edit server files (default program or Notepad); every save uploads automatically.
- Create new files and folders, change permissions (chmod), open files of an SSH connection.
- Undock tabs and whole views into their own windows and dock them back.
- Views combine several panes; workspaces save all views and windows.
- AI assistant next to SSH, PowerShell and CMD tabs (Ctrl+Shift+K): reads the terminal, explains, types commands into the input line without running them, and then interprets the output.
- Freely selectable AI provider: OpenAI-compatible (also Ollama, LM Studio, internal gateways), Azure AI Foundry, Anthropic and Google Gemini; keys encrypted in the vault.
- Workflows: saved commands with placeholders, searched via the palette (Ctrl+Shift+Space) and typed in without running them.
- AI CLIs as a tab: Claude Code, Codex CLI, Gemini CLI or a custom command, started in the selected project folder.
- Test a connection before it is saved.
- Move connections and folders by drag and drop; right-click a folder → “Connect all”.
- Welcome page instead of an empty form on start.
- Vault files are now called `.term` and open with a double-click in Windows; `.terminus` files keep working.
- Undocked windows disconnect their connections when closed.
- Vault format 2 with automatic migration and an encrypted backup of the old file.

## [0.0.1] – 2026-09-18

- First version: encrypted vault, SSH terminals, folders, split panes and workspaces.
