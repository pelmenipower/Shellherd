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

describe('runWithSudo with a command function', () => {
  it('renders the command for none and noninteractive and passes the limit on', async () => {
    for (const [connection, mode] of [[ssh(), { kind: 'none' }], [withSudo(), { kind: 'noninteractive' }]] as const) {
      const host = fakeHost();
      const render = vi.fn((_mode: unknown) => 'rendered');
      expect(await runWithSudo(host, connection, render, 5_000, new SudoRejections(), 777)).toEqual(ok);
      expect(render).toHaveBeenCalledWith(mode);
      expect(host.run.mock.calls[0]).toEqual(['rendered', 5_000, undefined, 777]);
    }
  });
  it('renders the prompt mode with fresh markers and hands the limit to run', async () => {
    const host = fakeHost();
    const render = vi.fn((_mode: unknown) => 'rendered');
    await runWithSudo(host, withSudo('secret'), render, 5_000, new SudoRejections(), 888);
    const mode = render.mock.calls[0][0] as { kind: string; marker: string; ready: string; stdin: boolean };
    expect(mode).toMatchObject({ kind: 'prompt', stdin: true });
    expect(mode.marker).toMatch(/^\[terminus-sudo-[0-9a-f]{16}\]$/);
    expect(mode.ready).toMatch(/^\[terminus-ready-[0-9a-f]{16}\]$/);
    const [command, , prompt, limit] = host.run.mock.calls[0];
    expect(command).toBe('rendered');
    expect(prompt).toMatchObject({ marker: mode.marker, ready: mode.ready, password: 'secret' });
    expect(limit).toBe(888);
  });
  it('passes undefined as limit when none is given', async () => {
    const host = fakeHost();
    await runWithSudo(host, withSudo('secret'), () => 'x', 5_000, new SudoRejections());
    await runWithSudo(host, ssh(), ['docker', 'ps'], 5_000, new SudoRejections());
    expect(host.run.mock.calls[0][3]).toBeUndefined();
    expect(host.run.mock.calls[1][3]).toBeUndefined();
  });
  it('does not render or run when rejected or busy', async () => {
    const host = fakeHost();
    const render = vi.fn(() => 'x');
    const connection = withSudo('secret');
    const rejections = new SudoRejections();
    rejections.markRejected(connection.id, connectionFingerprint(connection));
    expect((await runWithSudo(host, connection, render, 5_000, rejections)).sudoRejected).toBe(true);
    const busy = new SudoRejections();
    const holder = await busy.acquire(connection.id);
    try { expect((await runWithSudo(host, connection, render, 10, busy)).sudoBusy).toBe(true); } finally { holder(); }
    expect(render).not.toHaveBeenCalled();
    expect(host.run).not.toHaveBeenCalled();
  });
});

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
