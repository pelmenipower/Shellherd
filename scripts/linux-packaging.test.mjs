import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);

it('supplies an executable AppImage launcher that never disables the sandbox', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-launcher-'));
  try {
    const requested = [];
    const packager = { addElectronFuses: async (_context, fuses) => { requested.push(fuses); } };
    await require('./linux-after-pack.cjs')({ electronPlatformName: 'linux', appOutDir: directory, packager });
    const launcher = await readFile(join(directory, 'AppRun'), 'utf8');
    expect(launcher).toContain('exec "$APPDIR/shellherd" "$@"');
    expect(launcher).not.toContain('--no-sandbox');
    if (process.platform === 'linux') expect((await stat(join(directory, 'AppRun'))).mode & 0o777).toBe(0o755);
    const { FuseV1Options } = await import('@electron/fuses');
    expect(requested).toHaveLength(1);
    expect(requested[0][FuseV1Options.RunAsNode]).toBe(false);
    expect(requested[0][FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('keeps RunAsNode on Windows for the node-pty ConPTY helper but disables NODE_OPTIONS', async () => {
  const requested = [];
  const packager = { addElectronFuses: async (_context, fuses) => { requested.push(fuses); } };
  await require('./linux-after-pack.cjs')({ electronPlatformName: 'win32', appOutDir: tmpdir(), packager });
  const { FuseV1Options } = await import('@electron/fuses');
  expect(requested).toHaveLength(1);
  expect(requested[0][FuseV1Options.RunAsNode]).toBeUndefined();
  expect(requested[0][FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false);
});
