import { expect, it } from 'vitest';
import { FuseV1Options } from '@electron/fuses';
import { checkWinPackage } from './check-win-package.mjs';

// Numeric FuseState values: 0x30 disabled, 0x31 enabled. Keys are FuseV1Options.
const good = () => ({
  wire: { [FuseV1Options.RunAsNode]: 0x31, [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: 0x30, [FuseV1Options.EnableNodeCliInspectArguments]: 0x31 },
  resources: ['app.asar', 'icon.ico', 'icon.png', 'rdp-host/Shellherd.RdpHost.exe', 'hello/Shellherd.Hello.exe'],
  asarFiles: ['/out/main/index.js', '/out/renderer/index.html', '/out/preload/index.cjs'],
  mainTexts: ['console.log("main")'],
  outFiles: [],
});

it('reports nothing for a good package', () => {
  expect(checkWinPackage(good())).toEqual([]);
});

it('reports a wrong fuse', () => {
  const input = good();
  input.wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable] = 0x31;
  expect(checkWinPackage(input)).toHaveLength(1);
  const off = good();
  off.wire[FuseV1Options.RunAsNode] = 0x30;
  expect(checkWinPackage(off)).toHaveLength(1);
  const inspect = good();
  inspect.wire[FuseV1Options.EnableNodeCliInspectArguments] = 0x30;
  expect(checkWinPackage(inspect)).toHaveLength(1);
});

it('reports a missing resource', () => {
  const input = good();
  input.resources = input.resources.filter((r) => r !== 'icon.ico');
  expect(checkWinPackage(input)).toHaveLength(1);
});

it('reports a lab marker in out/main', () => {
  const input = good();
  input.mainTexts = ['x RemoteLabHost y'];
  expect(checkWinPackage(input)).toHaveLength(1);
});

it('reports the media page in the asar', () => {
  const input = good();
  input.asarFiles.push('/out/renderer/remote-media.html');
  expect(checkWinPackage(input)).toHaveLength(1);
});

it('reports media files left in out/', () => {
  const input = good();
  input.outFiles = ['out/preload/remote-media.cjs'];
  expect(checkWinPackage(input)).toHaveLength(1);
});
