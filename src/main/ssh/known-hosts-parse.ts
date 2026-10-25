import { createHash, createHmac } from 'node:crypto';

/** Host key formats ssh2 verifies; certificates, security keys and DSA are skipped. */
const KEY_TYPES = new Set(['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-rsa']);
/** Longer lines are skipped (an RSA-16384 key is about 2.8 KiB). */
export const MAX_KNOWN_HOSTS_LINE = 16_384;
/** Keys taken from one file; the rest counts as skipped. */
export const MAX_PARSED_KEYS = 1000;
// Linear patterns only: one character class, one bounded quantifier, no nesting.
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const HOST = /^[a-z0-9_.:%-]{1,253}$/;
const PORT = /^\d{1,5}$/;

export type ParsedHostKey =
  | { kind: 'plain'; name: string; port: number; type: string; fingerprint: string }
  | { kind: 'hashed'; salt: string; hash: string; type: string; fingerprint: string }
  | { kind: 'revoked'; type: string; fingerprint: string };
export interface ParsedKnownHosts { keys: ParsedHostKey[]; skipped: number }

/** Type name at the start of an SSH public key blob, or null if the blob is malformed. */
export function keyType(blob: Buffer): string | null {
  if (blob.length < 4) return null;
  const length = blob.readUInt32BE(0);
  if (length < 1 || length > 64 || 4 + length > blob.length) return null;
  return blob.toString('latin1', 4, 4 + length);
}

/** OpenSSH `|1|` entry: HMAC-SHA1 keyed with the salt over `host` (port 22) or `[host]:port`. */
export function hashedNameMatches(salt: string, hash: string, host: string, port: number): boolean {
  const name = port === 22 ? host : `[${host}]:${port}`;
  return createHmac('sha1', Buffer.from(salt, 'base64')).update(name).digest().equals(Buffer.from(hash, 'base64'));
}

const fingerprintOf = (blob: Buffer): string => `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;

/** `host` (port 22) or `[host]:port`, lowercased; null for patterns, negations and anything else. */
function plainName(raw: string): { name: string; port: number } | null {
  let name = raw.toLowerCase();
  let port = 22;
  if (name.startsWith('[')) {
    const end = name.indexOf(']:');
    const portText = end < 0 ? '' : name.slice(end + 2);
    if (!PORT.test(portText)) return null;
    port = Number(portText);
    if (port < 1 || port > 65535) return null;
    name = name.slice(1, end);
  }
  return HOST.test(name) ? { name, port } : null;
}

/** 20-byte base64 value, normalized to padded base64; null otherwise. */
function base64Of20(text: string | undefined): string | null {
  if (!text || !BASE64.test(text)) return null;
  const bytes = Buffer.from(text, 'base64');
  return bytes.length === 20 ? bytes.toString('base64') : null;
}

/** Parses an OpenSSH known_hosts text. Untrusted input: linear, bounded, never throws. */
export function parseKnownHosts(text: string): ParsedKnownHosts {
  const keys: ParsedHostKey[] = [];
  let skipped = 0;
  const add = (key: ParsedHostKey): void => { if (keys.length < MAX_PARSED_KEYS) keys.push(key); else skipped += 1; };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.length > MAX_KNOWN_HOSTS_LINE) { skipped += 1; continue; }
    const fields = line.split(/[ \t]+/);
    const marker = fields[0]!.startsWith('@') ? fields.shift() : undefined;
    const [names, type, data] = fields;
    if ((marker !== undefined && marker !== '@revoked') || !names || !type || !data || !KEY_TYPES.has(type) || !BASE64.test(data)) { skipped += 1; continue; }
    const blob = Buffer.from(data, 'base64');
    if (keyType(blob) !== type) { skipped += 1; continue; }
    const fingerprint = fingerprintOf(blob);
    if (marker === '@revoked') { add({ kind: 'revoked', type, fingerprint }); continue; }
    if (names.startsWith('|')) {
      const [empty, magic, saltText, hashText, ...rest] = names.split('|');
      const salt = base64Of20(saltText);
      const hash = base64Of20(hashText);
      if (empty !== '' || magic !== '1' || rest.length > 0 || !salt || !hash) { skipped += 1; continue; }
      add({ kind: 'hashed', salt, hash, type, fingerprint });
      continue;
    }
    for (const part of names.split(',')) {
      const plain = plainName(part);
      if (plain) add({ kind: 'plain', ...plain, type, fingerprint });
      else skipped += 1;
    }
  }
  return { keys, skipped };
}
