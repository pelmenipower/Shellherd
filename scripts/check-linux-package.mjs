import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'));
const { listPackage } = builderRequire('@electron/asar');

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'shellherd-package-'));
try {
  const image = resolve(`dist/Shellherd-${version}-x86_64.AppImage`);
  const deb = resolve(`dist/Shellherd-${version}-amd64.deb`);
  execFileSync(image, ['--appimage-extract'], { cwd: directory, stdio: 'ignore' });
  execFileSync('dpkg-deb', ['-x', deb, join(directory, 'deb')]);
  assert.equal(execFileSync('dpkg-deb', ['-f', deb, 'Architecture'], { encoding: 'utf8' }).trim(), 'amd64');
  for (const root of [join(directory, 'squashfs-root'), join(directory, 'deb/opt/Shellherd')]) {
    const launcher = await readFile(join(root, 'AppRun'), 'utf8');
    assert.ok(launcher.includes('exec "$APPDIR/shellherd" "$@"'));
    assert.ok(!launcher.includes('--no-sandbox'));
    const resources = await readdir(join(root, 'resources'));
    assert.ok(!resources.includes('rdp-host') && !resources.includes('hello'));
    assert.ok(resources.includes('icon.png'));
    const files = listPackage(join(root, 'resources/app.asar'));
    assert.ok(!files.some(file => /\.(exe|dll)$/i.test(file)), 'Windows binaries must not ship on Linux');
    assert.ok(!files.some(file => /^\/node_modules\/(?:vitest|typescript|electron-builder|playwright-core)\//.test(file)), 'Development tools must not ship');
    assert.ok(files.some(file => file.includes('node-pty') && file.endsWith('pty.node')));
    // Use Electron's bundled Node runtime, including its rebuilt native PTY.
    const probe = `const p=require(${JSON.stringify(join(root, 'resources/app.asar/node_modules/node-pty'))}).spawn('/bin/bash',['-c','printf packaged-pty-ok'],{cols:80,rows:24});let out='';p.onData(s=>out+=s);p.onExit(e=>{if(e.exitCode||!out.includes('packaged-pty-ok'))process.exitCode=1;});`;
    execFileSync(join(root, 'shellherd'), ['-e', probe], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10_000, stdio: 'pipe' });
  }
  const profile = await readFile(join(directory, 'deb/opt/Shellherd/resources/apparmor-profile'), 'utf8');
  assert.ok(profile.includes('/opt/Shellherd/shellherd') && profile.includes('userns,'));
  const desktop = await readFile(join(directory, 'deb/usr/share/applications/shellherd.desktop'), 'utf8');
  assert.ok(desktop.includes('Categories=System;'));
  assert.ok(!desktop.includes('--no-sandbox'));
  console.log('AppImage and DEB verified: architecture, launchers, icon, desktop entry, production dependencies and bundled native PTY.');
} finally { await rm(directory, { recursive: true, force: true }); }
