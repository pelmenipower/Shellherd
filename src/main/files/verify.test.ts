import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { Client } from 'ssh2';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256Local, sha256Remote, verifyCommand, verifyCopies } from './verify';

const HEX = 'a'.repeat(64);

function fakeClient(reply: (command: string) => { out?: string; error?: Error; streamError?: boolean }) {
  const commands: string[] = [];
  const client = {
    exec: (command: string, callback: (error: Error | undefined, stream?: unknown) => void) => {
      commands.push(command);
      const answer = reply(command);
      if (answer.error) { callback(answer.error); return; }
      const stream = Object.assign(new PassThrough(), { stderr: new PassThrough() });
      callback(undefined, stream);
      setImmediate(() => {
        if (answer.streamError) { stream.emit('error', new Error('boom')); stream.emit('close'); return; }
        if (answer.out) stream.write(answer.out);
        stream.end();
      });
    },
  };
  return { client: client as unknown as Client, commands };
}

const code = async (promise: Promise<unknown>) => promise.then(() => 'ok', (error: { code: string }) => error.code);

describe('verifyCommand', () => {
  it('quotes the path as the only argument of sh -c', () => {
    expect(verifyCommand("/srv/it's here.bin")).toBe(
      `sh -c 'sha256sum -- "$1" 2>/dev/null || shasum -a 256 -- "$1"' sh '/srv/it'\\''s here.bin'`);
  });
});

describe('sha256Remote', () => {
  it('returns the digest of a hex line', async () => {
    const { client } = fakeClient(() => ({ out: `${HEX}  /srv/a.bin\n` }));
    expect(await sha256Remote(client, '/srv/a.bin')).toBe(HEX);
  });

  it('finds the digest after a login banner and lowercases it', async () => {
    const { client } = fakeClient(() => ({ out: `Welcome\n${'A'.repeat(64)}  /srv/a.bin\n` }));
    expect(await sha256Remote(client, '/srv/a.bin')).toBe(HEX);
  });

  it('keeps the tail of a long banner', async () => {
    const { client } = fakeClient(() => ({ out: `${'x'.repeat(9000)}\n${HEX}  /srv/a.bin\n` }));
    expect(await sha256Remote(client, '/srv/a.bin')).toBe(HEX);
  });

  it('reports a missing tool as unavailable', async () => {
    const { client } = fakeClient(() => ({ out: 'sh: sha256sum: not found\n' }));
    expect(await code(sha256Remote(client, '/srv/a.bin'))).toBe('files.verifyUnavailable');
  });

  it('reports an exec error and a stream error as unavailable', async () => {
    expect(await code(sha256Remote(fakeClient(() => ({ error: new Error('no') })).client, '/srv/a.bin'))).toBe('files.verifyUnavailable');
    expect(await code(sha256Remote(fakeClient(() => ({ streamError: true })).client, '/srv/a.bin'))).toBe('files.verifyUnavailable');
  });

  it('passes a path with a quote only as a quoted argument', async () => {
    const { client, commands } = fakeClient(() => ({ out: `${HEX}  x\n` }));
    await sha256Remote(client, "/srv/it's here.bin");
    expect(commands[0]).toContain(`'/srv/it'\\''s here.bin'`);
  });

  it.each([
    '/srv/a&b.bin', '/srv/x\\y.bin', '/srv/$(id).bin', '/srv/a\nb.bin', '/srv/a!.bin',
    '/srv/a"b.bin', '/srv/`id`.bin', '/srv/a;b.bin', '/srv/$HOME', '/srv/a%b', '/srv/a\rb',
  ])('rejects %j without running a command', async path => {
    const { client, commands } = fakeClient(() => ({ out: `${HEX}  x\n` }));
    expect(await code(sha256Remote(client, path))).toBe('files.verifyUnsafeName');
    expect(commands).toEqual([]);
  });

  it.each(['/srv/-rf', '/srv/a b.bin', '/srv/Größe (1).txt', '-x'])('accepts %j and puts it after the script', async path => {
    const { client, commands } = fakeClient(() => ({ out: `${HEX}  x\n` }));
    expect(await sha256Remote(client, path)).toBe(HEX);
    expect(commands[0]).toMatch(/^sh -c '[^']*' sh /);
  });
});

describe('verifyCopies', () => {
  let dir = '';
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ''; });

  it('hashes a local file as a stream', async () => {
    dir = await mkdtemp(join(tmpdir(), 'verify-'));
    await writeFile(join(dir, 'f'), 'abc');
    expect(await sha256Local(join(dir, 'f'))).toBe(createHash('sha256').update('abc').digest('hex'));
  });

  it('lists the names whose digests differ', async () => {
    dir = await mkdtemp(join(tmpdir(), 'verify-'));
    await writeFile(join(dir, 'x.bin'), 'abc');
    await writeFile(join(dir, 'y.bin'), 'abc');
    const digest = createHash('sha256').update('abc').digest('hex');
    const pairs = [{ source: join(dir, 'x.bin'), target: '/srv/x.bin' }, { source: join(dir, 'y.bin'), target: '/srv/y.bin' }];
    const same = fakeClient(() => ({ out: `${digest}  x\n` }));
    expect(await verifyCopies(same.client, pairs, 'upload')).toEqual([]);
    const other = fakeClient(command => ({ out: `${command.includes('y.bin') ? HEX : digest}  x\n` }));
    expect(await verifyCopies(other.client, pairs, 'upload')).toEqual(['y.bin']);
  });

  it('reads the local side from the target on downloads', async () => {
    dir = await mkdtemp(join(tmpdir(), 'verify-'));
    await writeFile(join(dir, 'x.bin'), 'abc');
    const digest = createHash('sha256').update('abc').digest('hex');
    const { client } = fakeClient(() => ({ out: `${digest}  x\n` }));
    expect(await verifyCopies(client, [{ source: '/srv/x.bin', target: join(dir, 'x.bin') }], 'download')).toEqual([]);
  });
});
