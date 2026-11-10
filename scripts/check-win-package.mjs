// Verifies dist/win-unpacked after `npm run dist:win` (no GUI). Run by release.yml on the Windows runner.
import { readdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';

// FuseState values of @electron/fuses (the enum is not exported at runtime).
const FUSE_DISABLED = 0x30;
const FUSE_ENABLED = 0x31;
const LAB_MARKERS = ['SyncLabHost', 'RemoteLabHost', 'SHELLHERD_SYNC_LAB', 'SHELLHERD_REMOTE_LAB', 'remote-media.cjs'];
const REQUIRED_RESOURCES = ['rdp-host/Shellherd.RdpHost.exe', 'hello/Shellherd.Hello.exe', 'icon.ico', 'icon.png', 'app.asar'];
const MEDIA_ASAR_FILES = ['/out/preload/remote-media.cjs', '/out/renderer/remote-media.html'];
const MEDIA_OUT_FILES = ['out/preload/remote-media.cjs', 'out/renderer/remote-media.html'];

/**
 * Pure check. `wire` maps FuseV1Options keys to state bytes,
 * `resources` are paths relative to resources/ (posix), `asarFiles` the asar listing,
 * `mainTexts` the contents of out/main/**\/*.js, `outFiles` the media files found under out/.
 * Returns the list of problems (empty means OK).
 */
export function checkWinPackage({ wire, resources, asarFiles, mainTexts, outFiles }) {
  const problems = [];
  // node-pty's ConPTY fork needs RunAsNode on Windows; the Playwright smokes need --inspect. Change these checks and the comment in electron-builder.yml together.
  const expected = [
    ['EnableNodeOptionsEnvironmentVariable', FuseV1Options.EnableNodeOptionsEnvironmentVariable, FUSE_DISABLED],
    ['RunAsNode', FuseV1Options.RunAsNode, FUSE_ENABLED],
    ['EnableNodeCliInspectArguments', FuseV1Options.EnableNodeCliInspectArguments, FUSE_ENABLED],
  ];
  for (const [name, key, state] of expected) {
    if (wire[key] !== state) problems.push(`Fuse ${name} must be 0x${state.toString(16)} but is ${wire[key] === undefined ? 'missing' : `0x${wire[key].toString(16)}`}`);
  }
  for (const resource of REQUIRED_RESOURCES) {
    if (!resources.includes(resource)) problems.push(`Missing resource: ${resource}`);
  }
  for (const marker of LAB_MARKERS) {
    if (mainTexts.some((text) => text.includes(marker))) problems.push(`Release bundle must not contain lab code: ${marker} in out/main`);
  }
  for (const file of MEDIA_ASAR_FILES) {
    if (asarFiles.includes(file)) problems.push(`app.asar must not contain ${file}`);
  }
  for (const file of MEDIA_OUT_FILES) {
    if (outFiles.includes(file)) problems.push(`${file} must not exist in a release build`);
  }
  return problems;
}

const walk = async (dir) => (await Promise.all((await readdir(dir, { withFileTypes: true })).map((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))).flat();
const exists = (path) => access(path).then(() => true, () => false);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const require = createRequire(import.meta.url);
  const { listPackage } = createRequire(require.resolve('app-builder-lib/package.json'))('@electron/asar');
  const root = 'dist/win-unpacked';
  const resourcesDir = join(root, 'resources');
  const resources = (await walk(resourcesDir)).map((f) => f.slice(resourcesDir.length + 1).split('\\').join('/'));
  const mainTexts = await Promise.all((await walk('out/main')).filter((f) => f.endsWith('.js')).map((f) => readFile(f, 'utf8')));
  const outFiles = [];
  for (const file of MEDIA_OUT_FILES) if (await exists(file)) outFiles.push(file);
  const problems = checkWinPackage({
    wire: await getCurrentFuseWire(join(root, 'Shellherd.exe')),
    resources,
    asarFiles: listPackage(join(resourcesDir, 'app.asar')).map((f) => f.split('\\').join('/')),
    mainTexts,
    outFiles,
  });
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('Windows package verified: fuses, resources, lab-free bundle.');
}
