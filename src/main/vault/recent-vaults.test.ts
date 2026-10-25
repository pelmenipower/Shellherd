import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import { grantKey, recentId, recentKey, RecentVaults } from './recent-vaults';

describe('grantKey', () => {
  it('folds ASCII letters only', () => {
    expect(grantKey('C:\\Vaults\\A.term')).toBe(grantKey('c:\\vaults\\a.term'));
    expect(grantKey('\\\\nas.k\\s\\v.term')).not.toBe(grantKey('\\\\nas.\u212A\\s\\v.term'));
  });
});

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

  it('has() does not match a Kelvin sign for a k in a UNC share', async () => {
    await store().touch('\\\\nas.k\\s\\v.term');
    expect(await store().has('\\\\nas.K\\s\\v.term')).toBe(false);
    expect(await store().has('\\\\NAS.K\\S\\V.TERM')).toBe(true);
  });

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

  it('drops a legacy start value that is relative or longer than 4096 characters', async () => {
    await writeFile(legacy, JSON.stringify({ filePath: 'relative.term' }));
    expect(await store().list()).toEqual([]);
    await writeFile(legacy, JSON.stringify({ filePath: join(dir, 'a'.repeat(4096)) }));
    expect(await store().list()).toEqual([]);
  });

  describe('with an injected probe', () => {
    const names = ['a.term', 'b.term', 'c.term'];
    const probeOf = (present: string[], calls: string[]) => async (file: string) => {
      calls.push(file);
      return present.includes(file) ? { isFile: () => true } : null;
    };
    const writeEntries = async (): Promise<void> => {
      const recentVaults = names.map((name, index) => ({ filePath: join(dir, name), openedAt: 100 - index }));
      await writeFile(settings, JSON.stringify({ recentVaults }));
    };

    it('latest() stops at the first existing entry and does not probe the rest', async () => {
      await writeEntries();
      const calls: string[] = [];
      const latest = await new RecentVaults(settings, legacy, now, probeOf([join(dir, 'a.term'), join(dir, 'b.term')], calls)).latest();
      expect(latest).toBe(join(dir, 'a.term'));
      expect(calls).toEqual([join(dir, 'a.term')]);
    });

    it('latest() skips missing entries and stops at the first present one', async () => {
      await writeEntries();
      const calls: string[] = [];
      const latest = await new RecentVaults(settings, legacy, now, probeOf([join(dir, 'b.term')], calls)).latest();
      expect(latest).toBe(join(dir, 'b.term'));
      expect(calls).toEqual([join(dir, 'a.term'), join(dir, 'b.term')]);
    });

    it.skipIf(process.platform !== 'win32')('does not probe UNC paths and shows them as present', async () => {
      const unc = '\\\\server\\share\\vault.term';
      await writeFile(settings, JSON.stringify({ recentVaults: [{ filePath: unc, openedAt: 1 }] }));
      const calls: string[] = [];
      const store = new RecentVaults(settings, legacy, now, probeOf([], calls));
      const list = await store.list();
      expect(list[0]).toMatchObject({ filePath: unc, missing: false });
      expect(await store.latest()).toBe(unc);
      expect(calls).toEqual([]);
    });

    it.each(['//srv/s/v.term', '\\/srv\\s\\v.term'])('does not probe the two-slash path %s', async unc => {
      await writeFile(settings, JSON.stringify({ recentVaults: [{ filePath: unc, openedAt: 1 }] }));
      const calls: string[] = [];
      const list = await new RecentVaults(settings, legacy, now, probeOf([], calls)).list();
      expect(list[0]).toMatchObject({ missing: false });
      expect(calls).toEqual([]);
    });

    it('has() matches a stored path in another spelling and never probes', async () => {
      await writeEntries();
      const calls: string[] = [];
      const recent = new RecentVaults(settings, legacy, now, probeOf([], calls));
      expect(await recent.has(join(dir, 'A.TERM').toUpperCase())).toBe(true);
      expect(await recent.has(join(dir, 'x.term'))).toBe(false);
      expect(calls).toEqual([]);
    });
  });
});
