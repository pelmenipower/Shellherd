import { describe, expect, it, vi } from 'vitest';
import type { SshConnectionNode } from '../../shared/vault/types';
import { runWithSudo } from './sudo-run';
import type { RemoteHost } from './runner';
import { connectionFingerprint, SudoRejections } from './sudo-rejections';
import type { RunResult } from './parsers';

const ok: RunResult = { code: 0, stdout: 'done', stderr: '' };
const ssh = (overrides: Partial<SshConnectionNode> = {}): SshConnectionNode => ({ id: 'h1', type: 'connection', protocol: 'ssh', name: 'server01',
  host: 'server01', port: 22, username: 'admin', authentication: { method: 'agent' }, tags: [], ...overrides });
const withSudo = (password?: string): SshConnectionNode => ssh({
  containers: { sudo: true },
  authentication: password === undefined ? { method: 'agent' } : { method: 'password', password },
});

function fakeHost(result: RunResult = ok): RemoteHost & { run: ReturnType<typeof vi.fn> } {
  return { closed: false, close: vi.fn(), forward: vi.fn(), run: vi.fn(async () => result) } as unknown as RemoteHost & { run: ReturnType<typeof vi.fn> };
}

describe('runWithSudo', () => {
  it('runs the command directly when sudo is not enabled', async () => {
    const host = fakeHost();
    const result = await runWithSudo(host, ssh(), ['docker', 'ps'], 5_000, new SudoRejections());
    expect(result).toEqual(ok);
    expect(host.run).toHaveBeenCalledTimes(1);
    const [command, timeout, prompt] = host.run.mock.calls[0];
    expect(command).toContain('docker ps');
    expect(command).not.toContain('sudo');
    expect(timeout).toBe(5_000);
    expect(prompt).toBeUndefined();
  });

  it('does not run the command again after sudo rejected the stored password', async () => {
    const host = fakeHost();
    const connection = withSudo('secret');
    const rejections = new SudoRejections();
    rejections.markRejected(connection.id, connectionFingerprint(connection));
    const result = await runWithSudo(host, connection, ['docker', 'ps'], 5_000, rejections);
    expect(result).toEqual({ code: null, stdout: '', stderr: '', sudoRejected: true });
    expect(host.run).not.toHaveBeenCalled();
  });

  it('reports sudoBusy without running when another sudo authentication holds the gate', async () => {
    const host = fakeHost();
    const connection = withSudo('secret');
    const rejections = new SudoRejections();
    const holder = await rejections.acquire(connection.id);
    try {
      const result = await runWithSudo(host, connection, ['docker', 'ps'], 10, rejections);
      expect(result).toEqual({ code: null, stdout: '', stderr: '', sudoBusy: true });
      expect(host.run).not.toHaveBeenCalled();
    } finally { holder(); }
  });
});
