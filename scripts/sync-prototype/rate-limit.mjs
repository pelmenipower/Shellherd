// Request budgets for the standalone server: token buckets per key and source address derivation.
import { isIP } from 'node:net';
export const DEFAULT_LIMITS = Object.freeze({ global: 600, source: 240, info: 30, login: 5, passwordFailuresGlobal: 20, rendezvousToken: 180, challenge: 30, session: 20, deviceWrites: 60, connectionsPerSource: 8, concurrentPerSource: 4, maxKeys: 4096 });
export function createLimiter({ clock = Date.now, maxKeys = 4096 } = {}) {
  const buckets = new Map();
  return {
    take(key, { capacity, perMinute }) {
      const now = clock(); const bucket = buckets.get(key) ?? { tokens: capacity, last: now };
      buckets.delete(key); // re-insert below: Map order is the LRU order
      if (now > bucket.last) bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.last) * perMinute / 60_000);
      bucket.last = now; bucket.tokens = Math.min(bucket.tokens, capacity);
      buckets.set(key, bucket); if (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value);
      if (bucket.tokens >= 1) { bucket.tokens -= 1; return { ok: true }; }
      return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - bucket.tokens) * 60 / perMinute)) };
    },
  };
}
function groups(address) {
  let text = address.split('%')[0].toLowerCase(); const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) { const [a, b, c, d] = dotted[1].split('.').map(Number); text = text.slice(0, -dotted[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16); }
  const [head, tail] = text.split('::'); const left = head ? head.split(':') : []; const right = tail ? tail.split(':') : [];
  const all = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return all.map(g => parseInt(g, 16).toString(16));
}
function normalize(address) {
  const version = isIP(address.split('%')[0]); if (!version) return null;
  if (version === 4) return '4:' + address;
  const g = groups(address);
  if (g.slice(0, 5).every(v => v === '0') && g[5] === 'ffff') { const hi = parseInt(g[6], 16); const lo = parseInt(g[7], 16); return `4:${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`; }
  return `6:${g.slice(0, 4).join(':')}::/64`;
}
const trustError = (entry, reason) => Object.assign(Error(`Invalid trusted proxy entry "${entry}": ${reason}`), { hint: 'SHELLHERD_SERVER_TRUSTED_PROXY takes a comma-separated list of IPv4/IPv6 addresses with an optional /prefix, e.g. 172.31.87.1 or 10.0.0.0/8' });
/** Parses a comma-separated list of IPv4/IPv6 addresses with optional /prefix into an address matcher. */
export function parseTrustedProxies(text) {
  if (typeof text !== 'string') throw trustError(String(text), 'not a string');
  const rules = [];
  for (const raw of text.split(',')) {
    const entry = raw.trim();
    if (!entry) throw trustError(raw, 'empty entry');
    const [address, prefixText, ...rest] = entry.split('/');
    if (rest.length || address.includes('%')) throw trustError(entry, 'zone IDs and extra slashes are not allowed');
    let version = isIP(address); if (!version) throw trustError(entry, 'not an IP address');
    let value = toBigInt(address); let bits = version === 4 ? 32 : 128; let prefix = bits;
    if (prefixText !== undefined) {
      if (!/^[1-9]\d{0,2}$/.test(prefixText)) throw trustError(entry, 'invalid prefix');
      prefix = Number(prefixText);
    }
    if (version === 6 && value >> 32n === 0xffffn) { // IPv4-mapped entry: compared as IPv4
      if (prefixText !== undefined && prefix < 96) throw trustError(entry, 'prefix too short for a mapped address');
      value &= 0xffffffffn; version = 4; bits = 32; prefix = prefixText === undefined ? 32 : prefix - 96;
      if (prefix < 1) throw trustError(entry, 'invalid prefix');
    }
    if (prefix < 1 || prefix > bits) throw trustError(entry, 'prefix out of range');
    const hostBits = BigInt(bits - prefix);
    if ((value & ((1n << hostBits) - 1n)) !== 0n) throw trustError(entry, 'host bits set beyond the prefix');
    rules.push({ version, bits, prefix, network: value >> hostBits, hostBits });
  }
  return address => {
    const clean = typeof address === 'string' ? address.split('%')[0] : ''; let version = isIP(clean); if (!version) return false;
    let value = toBigInt(clean);
    if (version === 6 && value >> 32n === 0xffffn) { value &= 0xffffffffn; version = 4; }
    return rules.some(rule => rule.version === version && (value >> rule.hostBits) === rule.network);
  };
}
function toBigInt(address) {
  if (isIP(address) === 4) return address.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(octet), 0n);
  return groups(address).reduce((acc, group) => (acc << 16n) | BigInt(parseInt(group, 16)), 0n);
}
const warned = new Set();
const warnOnce = (key, message) => { if (warned.has(key) || warned.size >= 64) return; warned.add(key); console.error(message); };
/** `trustedProxy` is false or a matcher from parseTrustedProxies; X-Forwarded-For counts only from a matching socket peer. */
export function sourceOf(request, { trustedProxy = false } = {}) {
  const peer = request.socket?.remoteAddress ?? '';
  const socketSource = normalize(peer) ?? '4:unknown';
  const header = request.headers?.['x-forwarded-for'];
  if (header === undefined) return socketSource;
  if (typeof trustedProxy !== 'function' || !trustedProxy(peer)) { warnOnce('peer:' + peer, `Ignoring X-Forwarded-For from untrusted peer ${peer}`); return socketSource; }
  const last = String(header).split(',').pop().trim(); const forwarded = isIP(last) ? normalize(last) : null;
  if (forwarded) return forwarded;
  warnOnce('invalid', 'Ignoring invalid X-Forwarded-For header; using the socket address.');
  return socketSource;
}
