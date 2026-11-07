import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it as linuxIt } from 'vitest';
import { Authority, Client, device } from './protocol.mjs';
import { FileStore } from './file-store.mjs';
// Persistence prototype relies on Linux permissions, directory fsync and process semantics.
const it = linuxIt.runIf(process.platform === 'linux');

it('persists encrypted offline snapshots and replays ancestry after restart', async () => {
  const path = await mkdtemp(join(tmpdir(), 'shellherd-sync-lab-'));
  const authority = new Authority('files'); const identity = device('local');
  try {
    const membership = authority.setMembers([identity]);
    const first = new Client(identity, authority.publicKey, 'files'); first.useMembership(membership);
    const files = new FileStore(path);
    const base = first.snapshot({ api: { password: 'FILE_SECRET_INITIAL' } });
    const baseId = await files.put(base);
    const edited = first.snapshot({ api: { password: 'FILE_SECRET_EDIT' } });
    const editedId = await files.put(edited);
    expect(await files.put(edited)).toBe(editedId);
    const restarted = new Client(identity, authority.publicKey, 'files'); restarted.useMembership(membership);
    const reopened = new FileStore(path);
    restarted.receive(await reopened.get(baseId));
    const head = restarted.receive(await reopened.get(editedId));
    expect(restarted.value(head).api.password).toBe('FILE_SECRET_EDIT');
    const names = await readdir(path);
    expect(names).toHaveLength(2);
    for (const name of names) expect(await readFile(join(path, name), 'utf8')).not.toContain('FILE_SECRET');
    await expect(reopened.get('../escape')).rejects.toThrow('Invalid file ID');
    await writeFile(join(path, `${editedId}.json`), base);
    await expect(reopened.get(editedId)).rejects.toThrow('File integrity');
  } finally {
    identity.destroy(); authority.destroy(); await rm(path, { recursive: true, force: true });
  }
});
