# Changelog

All notable changes to Shellherd (called Terminus up to 0.9.0). Version numbers follow [Semantic Versioning](https://semver.org/):
MAJOR for incompatible changes (e.g. to the vault format), MINOR for new features, PATCH for bug fixes.
Every version needs a section `## [x.y.z] – YYYY-MM-DD` here; the build fails otherwise.

## [0.11.0] – 2026-10-19

- Shellherd is now available in German and English. It follows the Windows display language by default; “Language” on the start card and the welcome page switches between System, Deutsch and English. The change applies to all windows at once, and open sessions keep running.
- Error messages, dialogs, window titles and the AI assistant follow the selected language; the assistant answers in that language.
- Dates, numbers, file sizes, sorting and search follow the language. The “Describe” output in the cluster view now uses English field names like `kubectl describe`.
- The installer shows its texts in German or English to match the Windows language. Release notes and the manual are available in both languages (`docs/manual.md`).

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
- The command line at the top right (`/` search and `:` commands such as `:ns`, `:filter`, `:status`) is gone. Namespaces without pods are reachable through “all” and the namespace filter. Text filters from the context menu (e.g. `app=api`) appear as a “Filter: …” chip.
- The last opened vault file is preselected on start.
- A cluster tab without a configured namespace starts with all namespaces.

## [0.7.0] – 2026-10-18

- Kubernetes search: multiple terms (AND), `"phrase"`, `!exclusion`, `key=value` and `key!=value` for labels, `field:value` qualifiers and number comparisons (`restarts>3`, `count>=5`); the help (`?`) lists syntax and qualifiers per tab.
- Chip bar with status filters and counts per tab; `w` shows only notable items, `F` resets search and chips, `:filter` and `:status` set them by command, and the context menu offers “Show only …”. Search and chips are kept per tab.
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
