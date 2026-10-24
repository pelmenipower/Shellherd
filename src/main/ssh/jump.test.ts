import { describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { openJump } from './jump';
import type { JumpDependencies } from './jump';
import type { RemoteHost } from '../containers/runner';
import { AppError } from '../../shared/errors';
import type { ConnectionNode, SftpConnectionNode, SshConnectionNode } from '../../shared/vault/types';

const auth = { method: 'password', password: 'synthetic-password' } as const;
const target: SshConnectionNode = { id: 'app', type: 'connection', protocol: 'ssh', name: 'App', host: 'internal-01', port: 2222,
  tags: [], jumpHost: 'bastion', authentication: auth };
const bastion: SshConnectionNode = { id: 'bastion', type: 'connection', protocol: 'ssh', name: 'Bastion', host: 'web-01', port: 22,
  tags: [], authentication: auth };

/** Host whose forward answers with `channel` (or rejects). */
function fakeHost(forward: () => Promise<PassThrough>) {
  return { forward: vi.fn(forward), close: vi.fn(), run: vi.fn(), closed: false } as unknown as RemoteHost & { forward: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
}

function dependencies(nodes: ConnectionNode[], host = fakeHost(async () => new PassThrough())) {
  const openRemote = vi.fn(async (_connection: SshConnectionNode, _ownerId?: number, _isActive?: () => boolean) => host);
  const deps: JumpDependencies = {
    getConnection: id => nodes.find(node => node.id === id),
    openRemote,
  };
  return { deps, openRemote, host };
}

const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error('expected a rejection'); }, (error: unknown) => error);

describe('openJump', () => {
  it('returns undefined without a jump host and opens nothing', async () => {
    const { deps, openRemote } = dependencies([bastion]);
    expect(await openJump({ ...target, jumpHost: undefined }, deps)).toBeUndefined();
    expect(openRemote).not.toHaveBeenCalled();
  });

  it('reports a missing jump host with its id', async () => {
    const { deps, openRemote } = dependencies([]);
    const error = await failure(openJump(target, deps));
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'ssh.jumpHostMissing', params: { id: 'bastion' } });
    expect(openRemote).not.toHaveBeenCalled();
  });

  it.each([
    ['another protocol', { ...bastion, protocol: 'sftp' } as SftpConnectionNode],
    ['a disabled connection', { ...bastion, disabled: true }],
    ['a jump host of its own', { ...bastion, jumpHost: 'other' }],
  ])('refuses %s as jump host', async (_case, jump) => {
    const { deps, openRemote } = dependencies([jump as ConnectionNode, target]);
    const error = await failure(openJump(target, deps));
    expect(error).toMatchObject({ code: 'ssh.jumpHostUnusable', params: { name: 'Bastion' } });
    expect(openRemote).not.toHaveBeenCalled();
  });

  it('refuses the connection itself as jump host', async () => {
    const self: SshConnectionNode = { ...target, id: 'loop', name: 'Loop', jumpHost: 'loop' };
    const { deps, openRemote } = dependencies([self]);
    expect(await failure(openJump(self, deps))).toMatchObject({ code: 'ssh.jumpHostUnusable', params: { name: 'Loop' } });
    expect(openRemote).not.toHaveBeenCalled();
  });

  it('wraps a failed jump host login with its cause and the owner for prompts', async () => {
    const { deps, openRemote } = dependencies([bastion]);
    openRemote.mockRejectedValueOnce(new AppError('containers.hostKeyRejected'));
    const error = await failure(openJump(target, deps, 7));
    expect(error).toMatchObject({
      code: 'ssh.jumpHostFailed', params: { name: 'Bastion' },
      causes: [{ label: 'Bastion', error: { code: 'containers.hostKeyRejected' } }],
    });
    expect(openRemote).toHaveBeenCalledWith(bastion, 7, undefined);
  });

  it('maps a plain login failure of the jump host to a generic cause', async () => {
    const { deps, openRemote } = dependencies([bastion]);
    openRemote.mockRejectedValueOnce(new Error('socket hang up'));
    const error = await failure(openJump(target, deps));
    expect(error).toMatchObject({ code: 'ssh.jumpHostFailed', causes: [{ label: 'Bastion', error: { code: 'ssh.failed' } }] });
  });

  it('keeps the authentication failure of the jump host', async () => {
    const { deps, openRemote } = dependencies([bastion]);
    openRemote.mockRejectedValueOnce(Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' }));
    const error = await failure(openJump(target, deps));
    expect(error).toMatchObject({ causes: [{ label: 'Bastion', error: { code: 'ssh.authFailed' } }] });
  });

  it('reports an unreachable target and closes the jump host', async () => {
    const host = fakeHost(async () => { throw new Error('Unable to forward'); });
    const { deps } = dependencies([bastion], host);
    const error = await failure(openJump(target, deps));
    expect(error).toMatchObject({ code: 'ssh.jumpTargetUnreachable', params: { host: 'internal-01', port: 2222 } });
    expect(host.forward).toHaveBeenCalledWith('internal-01', 2222);
    expect(host.close).toHaveBeenCalledTimes(1);
  });

  it('returns the stream of the hop and closes channel and jump host once', async () => {
    const channel = new PassThrough();
    const destroy = vi.spyOn(channel, 'destroy');
    const host = fakeHost(async () => channel);
    const { deps } = dependencies([bastion], host);
    const jump = await openJump(target, deps);
    expect(jump).toMatchObject({ name: 'Bastion', sock: channel });
    jump!.close();
    jump!.close();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(host.close).toHaveBeenCalledTimes(1);
  });
});

describe('openJump session state', () => {
  it('passes the session check on to openRemote', async () => {
    const { deps, openRemote } = dependencies([bastion]);
    const isActive = () => true;
    await openJump(target, deps, 7, isActive);
    expect(openRemote).toHaveBeenCalledWith(bastion, 7, isActive);
  });

  it('closes the jump host and forwards nothing when the session ends during the login', async () => {
    const host = fakeHost(async () => new PassThrough());
    const { deps } = dependencies([bastion], host);
    let active = true;
    // The session closes while the jump host still asks for its 2FA code.
    deps.openRemote = vi.fn(async () => { active = false; return host; });
    const error = await failure(openJump(target, deps, 7, () => active));
    expect(error).toMatchObject({
      code: 'ssh.jumpHostFailed', params: { name: 'Bastion' },
      causes: [{ label: 'Bastion', error: { code: 'ssh.promptCancelled' } }],
    });
    expect(host.close).toHaveBeenCalledTimes(1);
    expect(host.forward).not.toHaveBeenCalled();
  });
});
