import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executableOnPath, platformCapabilities } from './index';
import { VaultPathGrants, droppedVaultPath } from '../vault/path-grants';
import { localFileSystem } from '../files/file-system';
import { agentSocket } from '../ssh/client-config';

it('advertises Windows helpers only on Windows', () => {
  expect(platformCapabilities('win32')).toMatchObject({ rdp: true, windowsHello: true, localShells: ['powershell', 'cmd'] });
  expect(platformCapabilities('linux')).toMatchObject({ rdp: false, windowsHello: false, fileAssociation: false });
  expect(platformCapabilities('darwin').localShells).toEqual([]);
});
it('Linux grants preserve case and normalize path segments', () => {
  const grants = new VaultPathGrants('linux');
  grants.grant('/home/alice/../alice/Prod.term');
  expect(grants.has('/home/alice/Prod.term')).toBe(true);
  expect(grants.has('/home/alice/prod.term')).toBe(false);
  expect(droppedVaultPath('/home/alice/../alice/Prod.term', 'linux')).toBe('/home/alice/Prod.term');
  for (const path of ['relative.term', '//server/v.term', 'C:\\v.term', '/a\0.term']) expect(droppedVaultPath(path, 'linux')).toBeNull();
});
it('uses the Unix SSH agent socket and reports a missing agent', () => {
  expect(agentSocket('linux', '/run/user/1000/agent.sock')).toBe('/run/user/1000/agent.sock');
  expect(() => agentSocket('linux', '')).toThrow(expect.objectContaining({ code: 'ssh.noAgent' }));
});
describe.runIf(process.platform === 'linux')('Linux executable and filesystem operations', () => {
  it('rejects shell syntax, relative PATH entries and non-executable files', () => {
    const root = mkdtempSync(join(tmpdir(), 'shellherd-path-'));
    try {
      writeFileSync(join(root, 'bash'), '#!/bin/sh\n', { mode: 0o700 });
      writeFileSync(join(root, 'zsh'), '#!/bin/sh\n', { mode: 0o600 });
      expect(executableOnPath('bash', { PATH: root })).toBe(join(root, 'bash'));
      expect(executableOnPath('zsh', { PATH: root })).toBeNull();
      expect(executableOnPath('bash;id', { PATH: root })).toBeNull();
      expect(executableOnPath('bash', { PATH: '.' })).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('lists and reads native paths, preserving case', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shellherd-files-'));
    try {
      mkdirSync(join(root, 'folder'));
      writeFileSync(join(root, 'A.txt'), 'upper');
      writeFileSync(join(root, 'a.txt'), 'lower');
      expect((await localFileSystem.list(root)).map(entry => entry.name).sort()).toEqual(['A.txt', 'a.txt', 'folder']);
      const handle = await localFileSystem.openRead(localFileSystem.join(root, 'A.txt'));
      try { expect((await handle.read(5, 0)).toString()).toBe('upper'); } finally { await handle.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
