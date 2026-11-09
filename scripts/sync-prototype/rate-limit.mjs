// Request budgets for the standalone server: token buckets per key and source address derivation.
import { isIP } from 'node:net';
export const DEFAULT_LIMITS = Object.freeze({ global: 600, source: 240, info: 30, login: 5, loginFailuresGlobal: 30, rendezvousToken: 180, connectionsPerSource: 8, maxKeys: 4096 });
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
let warned = false;
export function sourceOf(request, { trustedProxy = false } = {}) {
  const socketSource = normalize(request.socket?.remoteAddress ?? '') ?? '4:unknown';
  if (!trustedProxy) return socketSource;
  const header = request.headers?.['x-forwarded-for'];
  if (header === undefined) return socketSource;
  const last = String(header).split(',').pop().trim(); const forwarded = isIP(last) ? normalize(last) : null;
  if (forwarded) return forwarded;
  if (!warned) { warned = true; console.error('Ignoring invalid X-Forwarded-For header; using the socket address.'); }
  return socketSource;
}
