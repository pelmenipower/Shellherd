// electron-builder writes its AppRun before copying appOutDir into the AppImage.
// Supplying our own launcher prevents its automatic --no-sandbox fallback.
// The same hook flips the Electron fuses (see the comment in electron-builder.yml).
const { writeFile, chmod } = require('node:fs/promises');
const { join } = require('node:path');

module.exports = async (context) => {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'linux' && electronPlatformName !== 'win32') return;

  // Windows keeps RunAsNode: node-pty's ConPTY cleanup forks a helper via ELECTRON_RUN_AS_NODE.
  const { FuseVersion, FuseV1Options } = await import('@electron/fuses');
  const fuses = { version: FuseVersion.V1, [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false };
  if (electronPlatformName === 'linux') fuses[FuseV1Options.RunAsNode] = false;
  await context.packager.addElectronFuses(context, fuses);

  if (electronPlatformName !== 'linux') return;
  await writeFile(join(appOutDir, 'AppRun'), `#!/bin/sh
set -eu
APPDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export APPDIR
exec "$APPDIR/shellherd" "$@"
`, { mode: 0o755 });
  await chmod(join(appOutDir, 'AppRun'), 0o755);
};
