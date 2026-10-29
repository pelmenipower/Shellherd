import { EventEmitter } from 'node:events';
import type { Client, SFTPWrapper, Stats } from 'ssh2';
import { describe, expect, it, vi } from 'vitest';
import { remotePath } from './remote-path';
const attrs = (directory = false, mode = 0o100644): Stats => ({ mode, isDirectory: () => directory, isSymbolicLink: () => false } as Stats);
function fixture(options: { deny?: boolean; stall?: boolean; entries?: string[] } = {}) {
  const channel = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    realpath: vi.fn((path: string, cb: (error: unknown, path?: string) => void) => { if (!options.stall) cb(options.deny ? { code: 3 } : undefined, path === '.' ? '/home/demo' : path.replace(/\/$/, '') || '/'); }),
    stat: vi.fn((path: string, cb: (error: unknown, stats?: Stats) => void) => cb(path.includes('missing') ? { code: 2 } : undefined, attrs(false, 0o100755))),
    opendir: vi.fn((_path: string, cb: (error: unknown, handle: Buffer) => void) => cb(undefined, Buffer.from('dir'))),
    readdir: vi.fn(), close: vi.fn((_handle, cb) => cb()),
  });
  channel.readdir.mockImplementationOnce((_handle, cb) => cb(undefined, (options.entries ?? ['cpu.sh', 'cpu2.sh', 'ram.sh', 'folder', 'unsafe\nname']).map(filename => ({ filename, attrs: attrs(filename === 'folder') })))).mockImplementation((_handle, cb) => cb(undefined, false));
  const client = { sftp: (cb: (error: unknown, channel: SFTPWrapper) => void) => cb(undefined, channel as unknown as SFTPWrapper) } as Pick<Client, 'sftp'>;
  return { channel, client };
}
const register = () => () => {};
describe('read-only server path queries', () => {
  it('lists metadata, filters unsafe names, sorts directories first and closes its channel', async () => {
    const { client, channel } = fixture();
    const result = await remotePath(client, 'list', '~', () => true, register);
    expect(result.path).toBe('/home/demo');
    expect(result.entries?.map(entry => entry.name)).toEqual(['folder', 'cpu.sh', 'cpu2.sh', 'ram.sh']);
    expect(channel.end).toHaveBeenCalledOnce();
  });
  it('completes a home-relative filename without executing a shell', async () => {
    const { client, channel } = fixture();
    const result = await remotePath(client, 'complete', '${HOME}/cp', () => true, register);
    expect(result.entries?.map(entry => entry.name)).toEqual(['cpu.sh', 'cpu2.sh']);
    expect(channel.opendir).toHaveBeenCalledWith('/home/demo', expect.any(Function));
  });
  it('preserves trailing slash during home expansion and root completion', async () => {
    const { client, channel } = fixture();
    expect((await remotePath(client, 'complete', '~/folder/', () => true, register)).path).toBe('/home/demo/folder/');
    expect(channel.opendir).toHaveBeenCalledWith('/home/demo/folder', expect.any(Function));
    expect((await remotePath(fixture().client, 'complete', '/', () => true, register)).path).toBe('/');
  });
  it('checks file existence and executable bits', async () => {
    expect(await remotePath(fixture().client, 'validate', '$HOME/cpu.sh', () => true, register)).toMatchObject({ path: '/home/demo/cpu.sh', executable: true, directory: false });
    expect(await remotePath(fixture().client, 'validate', '/missing', () => true, register)).toMatchObject({ error: 'not-found' });
    expect(await remotePath(fixture({ deny: true }).client, 'list', '~', () => true, register)).toMatchObject({ error: 'denied' });
  });
  it('bounds results and marks partial directories', async () => {
    const result = await remotePath(fixture({ entries: Array.from({ length: 500 }, (_, i) => `${i}.sh`) }).client, 'list', '/', () => true, register);
    expect(result.entries).toHaveLength(200); expect(result.truncated).toBe(true);
  });
  it('times out stalled servers and closes channels', async () => {
    const { client, channel } = fixture({ stall: true });
    expect(await remotePath(client, 'list', '/', () => true, register, 10)).toMatchObject({ error: 'timeout' });
    expect(channel.end).toHaveBeenCalledOnce();
  });
  it('cancels on vault lock without returning metadata', async () => {
    const { client, channel } = fixture({ stall: true });
    let allowed = true, cancel = () => {};
    const result = remotePath(client, 'list', '/', () => allowed, callback => { cancel = callback; return () => {}; });
    allowed = false; cancel();
    expect(await result).toMatchObject({ error: 'unavailable' }); expect(channel.end).toHaveBeenCalledOnce();
  });
});
