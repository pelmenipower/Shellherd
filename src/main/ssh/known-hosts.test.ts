import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostFingerprint, HostKeyError, KnownHosts } from './known-hosts';

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'terminus-host-test-'));
  directories.push(directory);
  return join(directory, 'known-hosts.json');
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('SSH known hosts', () => {
  it('trusts a confirmed key and reconnects without another prompt', async () => {
    const filePath = await fixture();
    const confirm = vi.fn(async () => true);
    const hosts = new KnownHosts(filePath, confirm);
    const key = Buffer.from('synthetic-public-host-key');
    expect(await hosts.verify('SERVER.test', 22, key, () => true)).toBe(true);
    expect(await hosts.verify('server.test', 22, key, () => true)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({ host: 'SERVER.test', port: 22, fingerprint: hostFingerprint(key) });
    const stored = JSON.parse(await readFile(filePath, 'utf8'));
    expect(Object.values(stored.hosts)).toEqual([hostFingerprint(key)]);
  });
  it('rejects a changed host key without offering an override', async () => {
    const confirm = vi.fn(async () => true);
    const hosts = new KnownHosts(await fixture(), confirm);
    await hosts.verify('server.test', 22, Buffer.from('old'), () => true);
    await expect(hosts.verify('server.test', 22, Buffer.from('changed'), () => true)).rejects.toThrow(expect.objectContaining({ code: 'ssh.hostKeyChanged' }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it('keeps different ports separate', async () => {
    const confirm = vi.fn(async () => true);
    const hosts = new KnownHosts(await fixture(), confirm);
    await hosts.verify('server.test', 22, Buffer.from('first'), () => true);
    await hosts.verify('server.test', 2222, Buffer.from('second'), () => true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
  it('does not remember a rejected or cancelled connection', async () => {
    const filePath = await fixture();
    const rejected = new KnownHosts(filePath, async () => false);
    expect(await rejected.verify('server.test', 22, Buffer.from('key'), () => true)).toBe(false);
    let active = true;
    const cancelled = new KnownHosts(filePath, async () => { active = false; return true; });
    expect(await cancelled.verify('server.test', 22, Buffer.from('key'), () => active)).toBe(false);
    await expect(readFile(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('fails closed on a malformed trust file', async () => {
    const filePath = await fixture();
    await writeFile(filePath, '{}');
    const confirm = vi.fn(async () => true);
    await expect(new KnownHosts(filePath, confirm).verify('server.test', 22, Buffer.from('key'), () => true)).rejects.toThrow(expect.objectContaining({ code: 'ssh.hostKeysUnreadable' }));
    expect(confirm).not.toHaveBeenCalled();
  });
  it('serializes concurrent trust decisions without losing hosts or duplicating prompts', async () => {
    const filePath = await fixture();
    let prompts = 0; let outstanding = 0; let maximumOutstanding = 0;
    const confirm = async () => {
      prompts++; outstanding++; maximumOutstanding = Math.max(maximumOutstanding, outstanding);
      await new Promise(resolve => setTimeout(resolve, 10)); outstanding--; return true;
    };
    const hosts = new KnownHosts(filePath, confirm);
    const accepted = await Promise.all([
      hosts.verify('first.test', 22, Buffer.from('first'), () => true),
      hosts.verify('second.test', 22, Buffer.from('second'), () => true),
      hosts.verify('first.test', 22, Buffer.from('first'), () => true),
    ]);
    expect(accepted).toEqual([true, true, true]);
    expect(prompts).toBe(2); expect(maximumOutstanding).toBe(1);
    expect(Object.keys(JSON.parse(await readFile(filePath, 'utf8')).hosts)).toHaveLength(2);
    await expect(hosts.verify('first.test', 22, Buffer.from('changed'), () => true)).rejects.toThrow(expect.objectContaining({ code: 'ssh.hostKeyChanged' }));
    expect(await hosts.verify('second.test', 22, Buffer.from('second'), () => true)).toBe(true);
  });
  it('reports a changed key with both fingerprints outside the message', async () => {
    const hosts = new KnownHosts(await fixture(), async () => true);
    await hosts.verify('server.test', 22, Buffer.from('old'), () => true);
    const error = await hosts.verify('server.test', 22, Buffer.from('changed'), () => true).catch(reason => reason);
    expect(error).toBeInstanceOf(HostKeyError);
    expect(error.kind).toBe('changed');
    expect(error.code).toBe('ssh.hostKeyChanged');
    expect(error.fingerprints).toEqual({ expected: hostFingerprint(Buffer.from('old')), received: hostFingerprint(Buffer.from('changed')) });
    expect(error.message).not.toContain('SHA256');
  });
  it('marks read failures as store errors', async () => {
    const filePath = await fixture();
    await writeFile(filePath, '{}');
    const error = await new KnownHosts(filePath, async () => true).verify('server.test', 22, Buffer.from('key'), () => true).catch(reason => reason);
    expect(error).toMatchObject({ kind: 'store' });
    expect(error.fingerprints).toBeUndefined();
  });
  it('marks a key changed during the prompt as changed', async () => {
    const filePath = await fixture();
    const hosts = new KnownHosts(filePath, async () => {
      await writeFile(filePath, JSON.stringify({ version: 1, hosts: { [JSON.stringify(['server.test', 22])]: hostFingerprint(Buffer.from('other')) } }));
      return true;
    });
    const error = await hosts.verify('server.test', 22, Buffer.from('key'), () => true).catch(reason => reason);
    expect(error).toMatchObject({ kind: 'changed', fingerprints: { expected: hostFingerprint(Buffer.from('other')), received: hostFingerprint(Buffer.from('key')) } });
  });

});
