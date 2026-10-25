import { describe, expect, it } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { hostFingerprint } from './known-hosts';
import { hashedNameMatches, keyType, MAX_KNOWN_HOSTS_LINE, MAX_PARSED_KEYS, parseKnownHosts } from './known-hosts-parse';

// Synthetic SSH public key blob: string(type) followed by a 32-byte body.
function blob(type: string, body: Buffer = Buffer.alloc(32, 7)): Buffer {
  const length = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  return Buffer.concat([length(type.length), Buffer.from(type), length(body.length), body]);
}
const ED25519 = blob('ssh-ed25519').toString('base64');
const line = (names: string, type = 'ssh-ed25519', data = ED25519) => `${names} ${type} ${data}`;

describe('known_hosts parser: plain names', () => {
  it('maps a plain name to port 22', () => {
    const [key] = parseKnownHosts(line('host')).keys;
    expect(key).toEqual({ kind: 'plain', name: 'host', port: 22, type: 'ssh-ed25519', fingerprint: hostFingerprint(blob('ssh-ed25519')) });
  });
  it('lowercases and reads [host]:port', () => {
    const result = parseKnownHosts(line('[Host]:2222'));
    expect(result.keys).toMatchObject([{ kind: 'plain', name: 'host', port: 2222 }]);
  });
  it('splits comma separated names into two keys', () => {
    const result = parseKnownHosts(line('host,10.0.0.1'));
    expect(result.keys).toMatchObject([{ name: 'host', port: 22 }, { name: '10.0.0.1', port: 22 }]);
    expect(result.skipped).toBe(0);
  });
  it('reads IPv6 in brackets with a port', () => {
    expect(parseKnownHosts(line('[::1]:2222')).keys).toMatchObject([{ kind: 'plain', name: '::1', port: 2222 }]);
  });
  it('accepts an underscore in the host name (K5)', () => {
    expect(parseKnownHosts(line('my_host')).keys).toEqual([
      { kind: 'plain', name: 'my_host', port: 22, type: 'ssh-ed25519', fingerprint: hostFingerprint(blob('ssh-ed25519')) },
    ]);
  });
  it('skips patterns, negations and [host] without a port', () => {
    for (const names of ['*.x', '!x', 'h?st', '[h]', '[h]:0', '[h]:70000']) {
      const result = parseKnownHosts(line(names));
      expect(result.keys, names).toEqual([]);
      expect(result.skipped, names).toBe(1);
    }
  });
});

describe('known_hosts parser: hashed names', () => {
  const salt = randomBytes(20);
  const hashFor = (name: string) => createHmac('sha1', salt).update(name).digest();

  it('reads |1|salt|hash as hashed with padded base64', () => {
    const hash = hashFor('host');
    const result = parseKnownHosts(line(`|1|${salt.toString('base64')}|${hash.toString('base64')}`));
    expect(result.keys).toEqual([{
      kind: 'hashed', salt: salt.toString('base64'), hash: hash.toString('base64'),
      type: 'ssh-ed25519', fingerprint: hostFingerprint(blob('ssh-ed25519')),
    }]);
  });
  it('skips a salt of 19 bytes, a |2| marker and an entry with extra fields', () => {
    const hash = hashFor('host').toString('base64');
    const short = randomBytes(19).toString('base64');
    for (const names of [`|1|${short}|${hash}`, `|2|${salt.toString('base64')}|${hash}`, '|1|a|b|c']) {
      const result = parseKnownHosts(line(names));
      expect(result.keys, names).toEqual([]);
      expect(result.skipped, names).toBe(1);
    }
  });
});

describe('known_hosts parser: markers', () => {
  it('reads @revoked as revoked', () => {
    const [key] = parseKnownHosts(`@revoked ${line('host')}`).keys;
    expect(key).toEqual({ kind: 'revoked', type: 'ssh-ed25519', fingerprint: hostFingerprint(blob('ssh-ed25519')) });
    expect(parseKnownHosts(`@revoked ${line('host')}`).skipped).toBe(0);
  });
  it('skips @cert-authority and unknown markers', () => {
    for (const marker of ['@cert-authority', '@foo']) {
      const result = parseKnownHosts(`${marker} ${line('host')}`);
      expect(result.keys, marker).toEqual([]);
      expect(result.skipped, marker).toBe(1);
    }
  });
});

describe('known_hosts parser: key types', () => {
  it('skips certificate, security key and DSA types', () => {
    for (const type of ['sk-ssh-ed25519@openssh.com', 'ssh-ed25519-cert-v01@openssh.com', 'ssh-dss']) {
      const result = parseKnownHosts(line('host', type, blob(type).toString('base64')));
      expect(result.keys, type).toEqual([]);
      expect(result.skipped, type).toBe(1);
    }
  });
  it('skips a blob whose inner type differs from the type field', () => {
    const result = parseKnownHosts(line('host', 'ssh-ed25519', blob('ssh-rsa').toString('base64')));
    expect(result.keys).toEqual([]);
    expect(result.skipped).toBe(1);
  });
  it('skips broken base64', () => {
    const result = parseKnownHosts(line('host', 'ssh-ed25519', '!!!not-base64!!!'));
    expect(result.keys).toEqual([]);
    expect(result.skipped).toBe(1);
  });
  it('keeps several key types for one host', () => {
    const rsa = blob('ssh-rsa').toString('base64');
    const result = parseKnownHosts(`${line('host')}\n${line('host', 'ssh-rsa', rsa)}`);
    expect(result.keys.map(k => k.kind === 'plain' ? k.type : '')).toEqual(['ssh-ed25519', 'ssh-rsa']);
  });
});

describe('known_hosts parser: fingerprint and layout', () => {
  it('matches hostFingerprint of the blob', () => {
    const key = blob('ecdsa-sha2-nistp256', randomBytes(64));
    const [parsed] = parseKnownHosts(line('host', 'ecdsa-sha2-nistp256', key.toString('base64'))).keys;
    expect(parsed).toMatchObject({ fingerprint: hostFingerprint(key) });
  });
  it('handles CRLF, tabs, comments and blank lines without counting them as skipped', () => {
    const text = `# comment\r\n\r\n${line('host').replace(' ', '\t')}\r\n   \r\n`;
    const result = parseKnownHosts(text);
    expect(result.keys).toHaveLength(1);
    expect(result.skipped).toBe(0);
  });
});

describe('known_hosts parser: limits', () => {
  it('skips a line longer than the line limit', () => {
    const long = `host ${'A'.repeat(MAX_KNOWN_HOSTS_LINE)}`;
    expect(long.length).toBeGreaterThan(MAX_KNOWN_HOSTS_LINE);
    const result = parseKnownHosts(long);
    expect(result.keys).toEqual([]);
    expect(result.skipped).toBe(1);
  });
  it('keeps at most 1000 keys and counts the rest as skipped', () => {
    const text = Array.from({ length: MAX_PARSED_KEYS + 1 }, (_, i) => line(`h${i}`)).join('\n');
    const result = parseKnownHosts(text);
    expect(result.keys.length).toBe(1000);
    expect(result.skipped).toBe(1);
  });
  it('finishes a 4 MiB hostile input in under one second without throwing', () => {
    const size = 4 * 1024 * 1024;
    const inputs = ['|'.repeat(size), '['.repeat(size), 'a,'.repeat(size / 2), ' '.repeat(size)];
    for (const input of inputs) {
      const start = performance.now();
      expect(() => parseKnownHosts(input)).not.toThrow();
      expect(performance.now() - start).toBeLessThan(1000);
    }
  });
});

describe('keyType', () => {
  it('returns null for short, empty, oversized and overlong buffers', () => {
    expect(keyType(Buffer.from([0, 0, 0]))).toBeNull();
    expect(keyType(Buffer.from([0, 0, 0, 0]))).toBeNull();
    expect(keyType(Buffer.from([0, 0, 0, 9, 1, 2]))).toBeNull();
    const long = Buffer.alloc(4 + 65, 97);
    long.writeUInt32BE(65, 0);
    expect(keyType(long)).toBeNull();
  });
  it('returns the type name of a valid blob', () => {
    expect(keyType(blob('ssh-ed25519'))).toBe('ssh-ed25519');
  });
});

describe('hashedNameMatches', () => {
  const salt = randomBytes(20);
  const hash = createHmac('sha1', salt).update('host').digest('base64');
  const hashOf = (name: string) => createHmac('sha1', salt).update(name).digest('base64');
  const saltText = salt.toString('base64');

  it('uses the bare host on port 22', () => {
    expect(hashedNameMatches(saltText, hash, 'host', 22)).toBe(true);
  });
  it('uses [host]:port on other ports', () => {
    expect(hashedNameMatches(saltText, hashOf('[host]:2222'), 'host', 2222)).toBe(true);
    expect(hashedNameMatches(saltText, hash, 'host', 2222)).toBe(false);
  });
  it('returns false for a different host', () => {
    expect(hashedNameMatches(saltText, hash, 'other', 22)).toBe(false);
  });
});
