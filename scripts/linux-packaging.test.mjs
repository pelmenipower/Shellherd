import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);

it('supplies an executable AppImage launcher that never disables the sandbox', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-launcher-'));
  try {
    await require('./linux-after-pack.cjs')({ electronPlatformName: 'linux', appOutDir: directory });
    const launcher = await readFile(join(directory, 'AppRun'), 'utf8');
    expect(launcher).toContain('exec "$APPDIR/shellherd" "$@"');
    expect(launcher).not.toContain('--no-sandbox');
    if (process.platform === 'linux') expect((await stat(join(directory, 'AppRun'))).mode & 0o777).toBe(0o755);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
