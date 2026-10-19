<div align="center">

<img src="resources/icon.png" width="112" alt="Shellherd logo">

# Shellherd

**A local, encrypted connection manager for SSH, RDP, containers and Kubernetes.**

[![Release](https://img.shields.io/github/v/release/pelmenipower/Shellherd?sort=semver)](https://github.com/pelmenipower/Shellherd/releases/latest)
[![CI](https://github.com/pelmenipower/Shellherd/actions/workflows/ci.yml/badge.svg)](https://github.com/pelmenipower/Shellherd/actions/workflows/ci.yml)
![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078D6)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[**Download**](https://github.com/pelmenipower/Shellherd/releases/latest) · [Changelog](CHANGELOG.md) · [User guide (German)](docs/handbuch.md)

</div>

<p align="center">
  <img src="docs/images/screenshot-terminals.png" alt="Shellherd with two SSH sessions side by side and the connection tree on the left" width="100%">
</p>

<table>
  <tr>
    <td width="50%"><img src="docs/images/screenshot-connection-error.png" alt="Connection error card with cause, next step and actions"></td>
    <td width="50%"><img src="docs/images/screenshot-notice.png" alt="Success notice after saving a workspace"></td>
  </tr>
  <tr>
    <td align="center"><sub>Clear connection errors with the next step</sub></td>
    <td align="center"><sub>Notices that tell you what happened</sub></td>
  </tr>
</table>

Shellherd keeps all your servers, desktops and clusters in one window. Connections and their credentials live in a single encrypted vault file (`.term`) that you can carry around, back up or keep in sync – no account and no cloud service required.

> The user interface is in German.

## Features

- **SSH terminals** – up to 16 sessions as tabs, password, private key (with passphrase) or SSH agent, verified host keys.
- **Split views and workspaces** – drag tabs into up to four panes and save the layout as a named workspace.
- **Remote Desktop (RDP)** – embedded in a tab, no extra install, including shortcuts like Ctrl+Alt+Del.
- **SFTP file browser** – two-pane, WinSCP style, with a transfer queue and edit-and-upload for remote files.
- **Docker and Podman** – a container view per SSH host or for the local machine: containers, images, volumes and networks with filters, logs, shell and inspect.
- **Proxmox** – LXC containers and VMs under their host, with shell, serial console and power actions.
- **Kubernetes** – set up a cluster from an existing SSH connection; live nodes, workloads, pods and events with drill-down, logs, shell, YAML and describe. Production clusters ask you to type the resource name before any change.
- **Local shells** – PowerShell and CMD tabs next to your remote sessions.
- **AI assistant** (optional) – reads the terminal, explains output and types commands for you to review. Works with OpenAI-compatible endpoints (including Ollama and LM Studio), Azure AI Foundry, Anthropic and Google Gemini.

## Installation

Download the latest version from the [releases page](https://github.com/pelmenipower/Shellherd/releases/latest):

| File | Use it when |
|---|---|
| `Shellherd-Setup-x.y.z.exe` | You want a normal installation with Start menu entry. No admin rights needed. |
| `Shellherd-Portable-x.y.z.exe` | You want to run Shellherd without installing it, e.g. from a USB stick. |

The builds are not code-signed yet, so Windows SmartScreen may warn on first start. Choose **More info → Run anyway**.

**Requirements:** Windows 10 or 11 (x64).

## Security

- Vault files are encrypted with **AES-256-GCM**; the key is derived from your password with **Argon2id**.
- The renderer has no Node, file system or network access; everything sensitive stays in the main process.
- Server host keys must be confirmed once and are pinned afterwards; a changed key aborts the connection.
- Terminal output is never written to disk. Kubeconfigs stay in memory, the API tunnel only listens on `127.0.0.1`, and secrets are masked in YAML and inspect views.

Found a vulnerability? Please open a [private security advisory](https://github.com/pelmenipower/Shellherd/security/advisories/new) instead of a public issue.

## Development

Requires [Node.js](https://nodejs.org/) 24 and Windows (the RDP helper is compiled with the C# compiler that ships with .NET Framework 4.8).

```powershell
git clone https://github.com/pelmenipower/Shellherd.git
cd Shellherd
npm install
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Start the app with hot reload |
| `npm run typecheck` | TypeScript checks for main and renderer |
| `npm test` | Run the test suite (Vitest) |
| `npm run dist` | Build installer and portable exe into `dist/` |

Built with Electron, TypeScript, React, xterm.js, ssh2 and the Kubernetes JavaScript client. UI rules are documented in [`docs/design-system.md`](docs/design-system.md).

### Releasing

1. Bump the version: `npm run version:minor` (or `:patch` / `:major`).
2. Add a matching `## [x.y.z] – YYYY-MM-DD` section to [`CHANGELOG.md`](CHANGELOG.md) – the build fails without it.
3. Commit, tag and push:
   ```powershell
   git commit -am "chore(release): 0.11.0"
   git tag v0.11.0
   git push origin main v0.11.0
   ```

The [release workflow](.github/workflows/release.yml) then builds both executables and publishes a GitHub release with the changelog section as release notes.

## License

[MIT](LICENSE) © Alexander Schmidt
