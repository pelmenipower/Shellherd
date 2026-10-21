import type { SFTPWrapper } from 'ssh2';
import { describe, expect, it, vi } from 'vitest';
import { sftpFileSystem } from './sftp-file-system';

describe('sftpFileSystem.write', () => {
  const open = (mode?: number) => {
    const createWriteStream = vi.fn();
    sftpFileSystem({ createWriteStream } as unknown as SFTPWrapper).write('/x', mode);
    return createWriteStream;
  };

  it('creates files as 0644 by default (ssh2 would use 0666)', () => {
    expect(open()).toHaveBeenCalledWith('/x', { mode: 0o644 });
  });

  it('keeps a given mode', () => {
    expect(open(0o600)).toHaveBeenCalledWith('/x', { mode: 0o600 });
  });
});

describe('sftpFileSystem handles', () => {
  const HANDLE = Buffer.from('h');
  const fake = (overrides: Record<string, unknown> = {}) => {
    const sftp = {
      open: vi.fn((_path: string, _flags: string, ...rest: unknown[]) => (rest[rest.length - 1] as (error: null, handle: Buffer) => void)(null, HANDLE)),
      fchmod: vi.fn((_handle: Buffer, _mode: number, callback: (error?: Error) => void) => callback()),
      write: vi.fn((_h: Buffer, _b: Buffer, _o: number, _l: number, _p: number, callback: (error?: Error) => void) => callback()),
      read: vi.fn(),
      close: vi.fn((_handle: Buffer, callback: (error?: Error) => void) => callback()),
      ...overrides,
    };
    return { sftp, fs: sftpFileSystem(sftp as unknown as SFTPWrapper) };
  };

  it('opens with r+ when resuming and w otherwise, passing the mode', async () => {
    const { sftp, fs } = fake();
    await fs.openWrite('/x', 0o600, true);
    expect(sftp.open).toHaveBeenLastCalledWith('/x', 'r+', 0o600, expect.any(Function));
    await fs.openWrite('/x', 0o600, false);
    expect(sftp.open).toHaveBeenLastCalledWith('/x', 'w', 0o600, expect.any(Function));
  });

  it('ignores a refused chmod', async () => {
    const { fs } = fake({ fchmod: vi.fn((_h: Buffer, _m: number, callback: (error?: Error) => void) => callback(new Error('refused'))) });
    await expect(fs.openWrite('/x', 0o644)).resolves.toBeDefined();
  });

  it('sends nothing on a closed write handle', async () => {
    const { sftp, fs } = fake();
    const handle = await fs.openWrite('/x');
    await handle.close();
    await expect(handle.write(Buffer.from('a'), 0)).rejects.toThrow('handle closed');
    expect(sftp.write).not.toHaveBeenCalled();
  });

  it('asks again after a short answer and stops at end of file', async () => {
    const answers = [10, 0];
    const read = vi.fn((_h: Buffer, _b: Buffer, _o: number, _l: number, _p: number, callback: (error: undefined, count: number) => void) => callback(undefined, answers.shift() ?? 0));
    const { fs } = fake({ read });
    const handle = await fs.openRead('/x');
    const data = await handle.read(16, 100);
    expect(data).toHaveLength(10);
    expect(read.mock.calls.map(call => [call[2], call[3], call[4]])).toEqual([[0, 16, 100], [10, 6, 110]]);
    await handle.close();
    await expect(handle.read(1, 0)).rejects.toThrow('handle closed');
  });
});
