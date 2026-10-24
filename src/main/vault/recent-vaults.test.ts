import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import { recentId, recentKey, RecentVaults } from './recent-vaults';

describe('recentKey and recentId', () => {
  it('compares Windows paths case-insensitively', () => {
    expect(recentKey('C:\\A\\x.term', 'win32')).toBe(recentKey('c:\\a\\X.TERM', 'win32'));
  });

  it('compares other platforms case-sensitively', () => {
    expect(recentKey('/a/x.term', 'linux')).not.toBe(recentKey('/A/x.term', 'linux'));
  });

  it('builds a 16 hex char id from the key', () => {
    expect(recentId('C:\\A\\x.term', 'win32')).toMatch(/^[0-9a-f]{16}$/);
    expect(recentId('C:\\A\\x.term', 'win32')).toBe(recentId('c:\\a\\x.TERM', 'win32'));
  });
});

describe('RecentVaults', () => {
  let dir: string;
  let settings: string;
  let legacy: string;
  let clock: number;
  const now = (): number => clock;
  const store = (): RecentVaults => new RecentVaults(settings, legacy, now);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shellherd-recent-'));
    settings = join(dir, 'settings.json');
    legacy = join(dir, 'last-vault.json');
    clock = 1_000;
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function vault(name: string): Promise<string> {
    const file = join(dir, name);
    await writeFile(file, 'x');
    return file;
  }

  it('is empty before anything was opened', async () => {
    expect(await store().list()).toEqual([]);
    expect(await store().latest()).toBeNull();
  });

  it('lists the newest touch first and merges duplicates', async () => {
    const a = await vault('a.term');
    const b = await vault('b.term');
    await store().touch(a);
    clock = 2_000;
    await store().touch(b);
    clock = 3_000;
    await store().touch(a);

    const list = await store().list();
    expect(list.map(entry => entry.filePath)).toEqual([a, b]);
    expect(list[0]).toMatchObject({ name: 'a.term', folder: dir, openedAt: 3_000, missing: false });
    expect(list[1]).toMatchObject({ name: 'b.term', openedAt: 2_000 });
  });

  it('keeps at most eight entries', async () => {
    for (let index = 0; index < 10; index++) {
      clock = 1_000 + index;
      await store().touch(await vault(`v${index}.term`));
    }
    const list = await store().list();
    expect(list).toHaveLength(8);
    expect(list[0].name).toBe('v9.term');
    expect(list[7].name).toBe('v2.term');
  });

  it('marks a missing file and skips it for latest()', async () => {
    const real = await vault('real.term');
    await store().touch(join(dir, 'gone.term'));
    clock = 5_000;
    await store().touch(real);

    const list = await store().list();
    expect(list.map(entry => [entry.name, entry.missing])).toEqual([['real.term', false], ['gone.term', true]]);
    expect(await store().latest()).toBe(real);
  });

  it('returns null from latest() when every file is missing', async () => {
    await store().touch(join(dir, 'gone.term'));
    expect(await store().latest()).toBeNull();
  });

  it('removes an entry by id and leaves the file alone', async () => {
    const file = await vault('keep.term');
    await store().touch(file);
    const [entry] = await store().list();

    const after = await store().remove(entry.id);
    expect(after).toEqual([]);
    expect(await store().list()).toEqual([]);
    expect((await stat(file)).isFile()).toBe(true);
  });

  it('rejects an unknown or non-string id with core.invalidRequest', async () => {
    await store().touch(await vault('a.term'));
    await expect(store().remove('0000000000000000')).rejects.toMatchObject({ code: 'core.invalidRequest' });
    await expect(store().remove(42)).rejects.toBeInstanceOf(AppError);
    expect(await store().list()).toHaveLength(1);
  });

  it('keeps an empty list after the last removal and does not reseed from the legacy file', async () => {
    const file = await vault('a.term');
    await writeFile(legacy, JSON.stringify({ filePath: file }));
    await store().touch(file);
    for (const entry of await store().list()) await store().remove(entry.id);
    expect(await store().list()).toEqual([]);
  });

  it('seeds the list once from last-vault.json when settings has no recentVaults', async () => {
    const file = await vault('legacy.term');
    await writeFile(legacy, JSON.stringify({ filePath: file }));
    await utimes(legacy, 7, 7);

    const list = await store().list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ filePath: file, openedAt: 7_000, missing: false });
  });

  it('does not seed when recentVaults is already set to an empty list', async () => {
    const file = await vault('legacy.term');
    await writeFile(legacy, JSON.stringify({ filePath: file }));
    await writeFile(settings, JSON.stringify({ recentVaults: [] }));
    expect(await store().list()).toEqual([]);
  });

  it('touch never throws when the settings folder does not exist', async () => {
    const orphan = new RecentVaults(join(dir, 'missing', 'settings.json'), legacy, now);
    await expect(orphan.touch(await vault('a.term'))).resolves.toBeUndefined();
  });

  it('list and latest survive a broken settings file', async () => {
    await writeFile(settings, '{not json');
    expect(await store().list()).toEqual([]);
    expect(await store().latest()).toBeNull();
  });
});
