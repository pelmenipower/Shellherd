// electron-builder writes its AppRun before copying appOutDir into the AppImage.
// Supplying our own launcher prevents its automatic --no-sandbox fallback.
const { writeFile, chmod } = require('node:fs/promises');
const { join } = require('node:path');

module.exports = async ({ electronPlatformName, appOutDir }) => {
  if (electronPlatformName !== 'linux') return;
  await writeFile(join(appOutDir, 'AppRun'), `#!/bin/sh
set -eu
APPDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export APPDIR
exec "$APPDIR/shellherd" "$@"
`, { mode: 0o755 });
  await chmod(join(appOutDir, 'AppRun'), 0o755);
};
