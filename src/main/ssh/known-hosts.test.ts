import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostFingerprint, HostKeyError, KnownHosts, MAX_STORED_IMPORTED, MAX_STORED_REVOKED } from './known-hosts';
import { parseKnownHosts } from './known-hosts-parse';

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'terminus-host-test-'));
  directories.push(directory);
  return join(directory, 'known-hosts.json');
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

// Synthetic key blobs: deterministic made-up bytes, the type name is the first SSH string.
const sshString = (value: Buffer | string): Buffer => {
  const body = Buffer.from(value);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  return Buffer.concat([head, body]);
};
const keyBytes = (type: string, ...parts: (Buffer | string)[]): Buffer => Buffer.concat([sshString(type), ...parts.map(sshString)]);
const syntheticBytes = (label: string, length: number): Buffer =>
  Buffer.concat([0, 1, 2, 3, 4].map(i => createHash('sha512').update(`${label}:${i}`).digest())).subarray(0, length);
const ed25519 = (label: string): Buffer => keyBytes('ssh-ed25519', syntheticBytes(label, 32));
const ecdsa = (label: string): Buffer => keyBytes('ecdsa-sha2-nistp256', 'nistp256', Buffer.concat([Buffer.from([4]), syntheticBytes(label, 64)]));
const rsa = (label: string): Buffer => keyBytes('ssh-rsa', Buffer.from([1, 0, 1]), Buffer.concat([Buffer.from([0]), syntheticBytes(label, 256)]));
const line = (names: string, type: string, key: Buffer): string => `${names} ${type} ${key.toString('base64')}`;
const addr = (host: string, port = 22): string => JSON.stringify([host, port]);

const SALT = syntheticBytes('salt', 20);
const demoText = [
  '# Synthetic demo data only',
  `${line('build-01,10.20.0.11', 'ssh-ed25519', ed25519('build-01'))} demo`,
  line('[db-01]:2200', 'ecdsa-sha2-nistp256', ecdsa('db-01')),
  `|1|${SALT.toString('base64')}|${createHmac('sha1', SALT).update('legacy-01').digest('base64')} ssh-ed25519 ${ed25519('legacy-01').toString('base64')}`,
  line('[127.0.0.1]:2222', 'ssh-ed25519', ed25519('demo-conflict')),
  line('@revoked *', 'ssh-rsa', rsa('revoked')),
  line('@cert-authority *.example.internal', 'ssh-ed25519', ed25519('ca')),
  line('*.internal', 'ssh-ed25519', ed25519('pattern')),
  'web-02 ssh-ed25519 !!!notbase64',
].join('\n') + '\n';

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

describe('known hosts with imported and revoked entries', () => {
  it('loads, verifies and lists a 0.23.0 file without the new fields', async () => {
    const filePath = await fixture();
    const key = Buffer.from('old-key');
    await writeFile(filePath, JSON.stringify({ version: 1, hosts: { [addr('server.test')]: hostFingerprint(key) } }));
    const confirm = vi.fn(async () => true);
    const hosts = new KnownHosts(filePath, confirm);
    expect(await hosts.verify('server.test', 22, key, () => true)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(await hosts.list()).toEqual([{ id: expect.any(String), host: 'server.test', port: 22, type: null, fingerprint: hostFingerprint(key), origin: 'confirmed' }]);
  });
  it('keeps imported and revoked entries when a new server is confirmed', async () => {
    const filePath = await fixture();
    const hosts = new KnownHosts(filePath, async () => true);
    await hosts.importKeys(parseKnownHosts(demoText));
    await hosts.verify('new.test', 22, Buffer.from('new'), () => true);
    const stored = JSON.parse(await readFile(filePath, 'utf8'));
    expect(stored.imported).toHaveLength(5);
    expect(stored.revoked).toHaveLength(1);
    expect(Object.keys(stored.hosts)).toEqual([addr('new.test')]);
  });
  it('trusts an imported plain or hashed entry without asking', async () => {
    const confirm = vi.fn(async () => true);
    const hosts = new KnownHosts(await fixture(), confirm);
    await hosts.importKeys(parseKnownHosts(demoText));
    expect(await hosts.verify('build-01', 22, ed25519('build-01'), () => true)).toBe(true);
    expect(await hosts.verify('legacy-01', 22, ed25519('legacy-01'), () => true)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
  it('reports a same-type imported key with another fingerprint as changed', async () => {
    const hosts = new KnownHosts(await fixture(), async () => true);
    await hosts.importKeys(parseKnownHosts(demoText));
    const plain = await hosts.verify('build-01', 22, ed25519('other'), () => true).catch(reason => reason);
    expect(plain).toMatchObject({ code: 'ssh.hostKeyChanged', kind: 'changed', fingerprints: { expected: hostFingerprint(ed25519('build-01')), received: hostFingerprint(ed25519('other')) } });
    const hashed = await hosts.verify('legacy-01', 22, ed25519('other'), () => true).catch(reason => reason);
    expect(hashed).toMatchObject({ code: 'ssh.hostKeyChanged', fingerprints: { expected: hostFingerprint(ed25519('legacy-01')) } });
  });
  it('asks when only another key type is imported for the server', async () => {
    const confirm = vi.fn(async () => true);
    const hosts = new KnownHosts(await fixture(), confirm);
    await hosts.importKeys(parseKnownHosts(line('build-01', 'ssh-ed25519', ed25519('build-01'))));
    expect(await hosts.verify('build-01', 22, ecdsa('build-01'), () => true)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it('lets a confirmed key win over an imported one for the same server', async () => {
    const hosts = new KnownHosts(await fixture(), async () => true);
    await hosts.importKeys(parseKnownHosts(line('server.test', 'ssh-ed25519', ed25519('imported'))));
    expect(await hosts.verify('server.test', 22, ecdsa('confirmed'), () => true)).toBe(true);
    const error = await hosts.verify('server.test', 22, ed25519('imported'), () => true).catch(reason => reason);
    expect(error).toMatchObject({ code: 'ssh.hostKeyChanged', fingerprints: { expected: hostFingerprint(ecdsa('confirmed')) } });
  });
  it('rejects a revoked key even when the server is confirmed', async () => {
    const confirm = vi.fn(async () => true);
    const hosts = new KnownHosts(await fixture(), confirm);
    await hosts.verify('server.test', 22, rsa('revoked'), () => true);
    await hosts.importKeys(parseKnownHosts(line('@revoked *', 'ssh-rsa', rsa('revoked'))));
    await expect(hosts.verify('server.test', 22, rsa('revoked'), () => true)).rejects.toMatchObject({ code: 'ssh.hostKeyRevoked' });
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it('does not trust a key that the same file revokes', async () => {
    const confirm = vi.fn(async () => true);
    const hosts = new KnownHosts(await fixture(), confirm);
    const { result } = await hosts.importKeys(parseKnownHosts(`${line('server.test', 'ssh-ed25519', ed25519('same'))}\n${line('@revoked *', 'ssh-ed25519', ed25519('same'))}`));
    expect(result).toMatchObject({ added: 0, revoked: 1, skipped: 1 });
    await expect(hosts.verify('server.test', 22, ed25519('same'), () => true)).rejects.toMatchObject({ code: 'ssh.hostKeyRevoked' });
    expect(confirm).not.toHaveBeenCalled();
  });
  it('imports the demo fixture: five new entries without a confirmed demo server', async () => {
    const hosts = new KnownHosts(await fixture(), async () => true);
    const { result } = await hosts.importKeys(parseKnownHosts(demoText));
    expect(result).toEqual({ added: 5, known: 0, revoked: 1, skipped: 3, conflicts: [] });
  });
  it('imports the demo fixture against a confirmed demo server: four new, one known, one conflict', async () => {
    const hosts = new KnownHosts(await fixture(), async () => true);
    await hosts.verify('127.0.0.1', 2222, ed25519('other-demo'), () => true);
    const { result } = await hosts.importKeys(parseKnownHosts(demoText));
    expect(result).toEqual({ added: 4, known: 1, revoked: 1, skipped: 3, conflicts: ['127.0.0.1:2222'] });
  });
  it('writes nothing when the same data is imported again', async () => {
    const hosts = new KnownHosts(await fixture(), async () => true);
    await hosts.importKeys(parseKnownHosts(demoText));
    const write = vi.spyOn(hosts as unknown as { write: (next: unknown) => Promise<void> }, 'write');
    const { result } = await hosts.importKeys(parseKnownHosts(demoText));
    expect(result).toMatchObject({ added: 0, known: 6, skipped: 3 });
    expect(write).not.toHaveBeenCalled();
  });
  it('counts imports beyond the store caps as skipped', async () => {
    const filePath = await fixture();
    const imported = Array.from({ length: MAX_STORED_IMPORTED }, (_, index) => ({ name: `h${index}.test`, port: 22, type: 'ssh-ed25519', fingerprint: hostFingerprint(Buffer.from(`h${index}`)) }));
    const revoked = Array.from({ length: MAX_STORED_REVOKED }, (_, index) => ({ type: 'ssh-ed25519', fingerprint: hostFingerprint(Buffer.from(`r${index}`)) }));
    await writeFile(filePath, JSON.stringify({ version: 1, hosts: {}, imported, revoked }));
    const hosts = new KnownHosts(filePath, async () => true);
    const { result } = await hosts.importKeys(parseKnownHosts(`${line('extra.test', 'ssh-ed25519', ed25519('extra'))}\n${line('@revoked *', 'ssh-ed25519', ed25519('extra-revoked'))}`));
    expect(result).toMatchObject({ added: 0, revoked: 0, skipped: 2 });
  });
  it('removes confirmed, imported and revoked entries by id', async () => {
    const confirm = vi.fn(async () => true);
    const hosts = new KnownHosts(await fixture(), confirm);
    await hosts.verify('server.test', 22, ed25519('server'), () => true);
    await hosts.importKeys(parseKnownHosts(`${line('build-01', 'ssh-ed25519', ed25519('build-01'))}\n${line('@revoked *', 'ssh-rsa', rsa('revoked'))}`));
    const byOrigin = async (origin: string): Promise<string> => (await hosts.list()).find(entry => entry.origin === origin)!.id;
    expect(await hosts.remove(await byOrigin('imported'))).toHaveLength(2);
    expect(await hosts.remove(await byOrigin('revoked'))).toHaveLength(1);
    expect(await hosts.remove(await byOrigin('confirmed'))).toEqual([]);
    expect(await hosts.verify('server.test', 22, ed25519('server'), () => true)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
  it('rejects an unknown id', async () => {
    const hosts = new KnownHosts(await fixture(), async () => true);
    await expect(hosts.remove('0123456789abcdef')).rejects.toMatchObject({ code: 'core.invalidRequest' });
  });
  it('lists stable ids and no host name for hashed entries', async () => {
    const hosts = new KnownHosts(await fixture(), async () => true);
    await hosts.importKeys(parseKnownHosts(demoText));
    const first = await hosts.list();
    expect((await hosts.list()).map(entry => entry.id)).toEqual(first.map(entry => entry.id));
    expect(new Set(first.map(entry => entry.id)).size).toBe(first.length);
    expect(first.find(entry => entry.origin === 'imported' && entry.host === null)).toMatchObject({ port: null, type: 'ssh-ed25519' });
    expect(first.find(entry => entry.origin === 'revoked')).toMatchObject({ host: null, port: null, type: 'ssh-rsa' });
  });
  it('does not lose a write when an import runs alongside a confirmation', async () => {
    const filePath = await fixture();
    const hosts = new KnownHosts(filePath, async () => true);
    const [report] = await Promise.all([
      hosts.importKeys(parseKnownHosts(demoText)),
      hosts.verify('new.test', 22, ed25519('new'), () => true),
    ]);
    const stored = JSON.parse(await readFile(filePath, 'utf8'));
    expect(report.result.added).toBe(5);
    expect(stored.imported).toHaveLength(5);
    expect(stored.hosts).toEqual({ [addr('new.test')]: hostFingerprint(ed25519('new')) });
  });
});
