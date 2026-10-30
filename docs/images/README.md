# Screenshot gallery

The README gallery was captured on Linux from Shellherd **0.31.0** on 2026-10-30, using the real Electron app, Playwright and the repository's synthetic demo services. Images are 1440 × 874 pixels: the status bar is cropped to exclude the vault path. No real credentials, server data or user directories are shown. CPU/RAM toolbar readings are fixed demo responses, not measurements of the capture machine.

## Reproduce

Use a clean checkout/worktree, its own installed dependencies and a graphical desktop (or Xvfb). Do not run another demo driver or server on the same ports. Keep the same `SHELLHERD_RUN_DIR` for every command, outside your home directory. A new directory gives you a fresh synthetic vault.

```bash
npm ci
npm run build
export SHELLHERD_RUN_DIR=/tmp/shellherd-gallery-031

# Terminal 1, with the same SHELLHERD_RUN_DIR:
npm run drive:sshd

# Terminal 2, with the same SHELLHERD_RUN_DIR:
npm run drive

# Terminal 3, with the same SHELLHERD_RUN_DIR:
node .claude/skills/run-app/demo-setup.mjs
node .claude/skills/run-app/screens.mjs containers kubernetes settings assistant sftp --readme
node .claude/skills/run-app/release-screens.mjs
```

The demo setup selects German because the scene selectors use German labels. On Linux the Windows Hello fake is disabled. The SFTP scene also exercises cancel/resume and SHA-256 verification with a temporary 512 MiB synthetic file; allow enough free disk space. The release scene starts a temporary loopback SSH server, seeds toolbar buttons and status mappings in the demo vault, captures both themes and the editor, and restores the saved vault configuration in `finally`.

On a Linux capture host without a working Chromium sandbox, the driver alone supports `SHELLHERD_RUN_NO_SANDBOX=1 npm run drive`. This opt-in is only for isolated synthetic screenshots. It does not modify the packaged app or package smoke tests, and these screenshots do not validate production sandbox behavior.

After capture, close the driver through its authenticated `/quit` route and stop the demo-server process. See [run-app instructions](../../.claude/skills/run-app/SKILL.md) for the driver API, token and cleanup details. Inspect every image before committing.

## Files used by the README

| Image | Scene |
|---|---|
| `screenshot-terminals.png` | Dark theme: two SSH sessions, root login commands and toolbar |
| `screenshot-terminals-light.png` | The same sessions in the light theme |
| `screenshot-toolbar.png` | Dynamic-display editor with script path and refresh settings |
| `screenshot-sftp.png` | Synthetic local folder and remote SFTP home |
| `screenshot-containers.png` | Six demo Docker containers |
| `screenshot-kubernetes.png` | Demo production cluster, nodes and pod table |
| `screenshot-settings.png` | Settings from the top of the dialog |
| `screenshot-assistant.png` | Synthetic AI reply beside terminal output |

Other images and the older tour video in this directory are historical assets and are not part of the 0.31.0 README gallery.
