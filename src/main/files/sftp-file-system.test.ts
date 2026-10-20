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
