// Storage login only. Never use this password as a Vault encryption key.
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { DEFAULT_LIMITS } from './rate-limit.mjs';
const derive = promisify(scrypt);
const parameters = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const validUser = name => typeof name === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(name);
const check = (ok, status = 400, retryAfter) => { if (!ok) { const error = Error('Account request rejected'); error.status = status; if (retryAfter !== undefined) error.retryAfter = retryAfter; throw error; } };
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
// Rejection sampling keeps every character equally likely.
export function generatePassword() {
  const limit = 256 - (256 % ALPHABET.length); let out = '';
  while (out.length < 24) for (const byte of randomBytes(32)) { if (byte < limit && out.length < 24) out += ALPHABET[byte % ALPHABET.length]; }
  return out;
}
const digestOf = value => createHash('sha256').update(value).digest();
function bytes(value, length) { check(typeof value === 'string'); const b = Buffer.from(value, 'base64'); check(b.length === length && b.toString('base64') === value); return b; }
export async function createAccount(username, password) {
  check(validUser(username) && typeof password === 'string' && password.length >= 12 && password.length <= 1024);
  const salt = randomBytes(16); const hash = await derive(password, salt, 32, parameters);
  try { return { username, algorithm: 'scrypt-v1', salt: salt.toString('base64'), hash: hash.toString('base64') }; }
  finally { hash.fill(0); }
}
export function accountAuth(account, clock = Date.now, limits = DEFAULT_LIMITS) {
  check(account && Object.keys(account).sort().join(',') === 'algorithm,hash,salt,username' && validUser(account.username) && account.algorithm === 'scrypt-v1');
  const salt = bytes(account.salt, 16); const hash = bytes(account.hash, 32);
  const sessions = new Map(); let active = false;
  // Failure state per source (insertion order = LRU), plus a global failure window.
  const failures = new Map(); let failWindow = clock(); let failCount = 0; const FAILURE_MEMORY = 900_000;
  const record = source => { const now = clock(); const r = failures.get(source); if (r && (now < r.last || now - r.last >= FAILURE_MEMORY)) failures.delete(source); return failures.get(source); };
  const fail = source => {
    const now = clock(); if (now < failWindow || now - failWindow >= 60_000) { failWindow = now; failCount = 0; }
    failCount++; const r = record(source) ?? { f: 0, last: now }; failures.delete(source);
    r.f++; r.last = now; failures.set(source, r); if (failures.size > limits.maxKeys) failures.delete(failures.keys().next().value);
  };
  const digest = token => createHash('sha256').update(token).digest('hex');
  const expire = () => { const now = clock(); for (const [key, session] of sessions) if (now < session.created || now >= session.expiresAt) sessions.delete(key); };
  return {
    isActive(key) { expire(); return sessions.has(key); },
    fail,
    async login(body, source = 'local') {
      const now = clock(); const r = record(source);
      if (now - failWindow >= 60_000 || now < failWindow) { failWindow = now; failCount = 0; }
      if (r?.f >= 3) { const until = r.last + Math.min(60, 2 ** (r.f - 3)) * 1000; check(now >= until, 429, Math.max(1, Math.ceil((until - now) / 1000))); }
      // Once the global failure budget is spent, only sources that already failed are refused.
      check(!(r && failCount >= limits.loginFailuresGlobal), 429, Math.max(1, Math.ceil((failWindow + 60_000 - now) / 1000)));
      check(!active, 429, 1);
      try { check(body && Object.keys(body).sort().join(',') === 'password,username' && typeof body.username === 'string' && body.username.length <= 64 && typeof body.password === 'string' && body.password.length > 0 && body.password.length <= 1024); }
      catch (error) { fail(source); throw error; }
      active = true; let candidate;
      try {
        candidate = await derive(body.password, salt, 32, parameters);
        const matches = timingSafeEqual(candidate, hash); const nameMatches = timingSafeEqual(digestOf(body.username), digestOf(account.username));
        if (!(matches && nameMatches)) fail(source);
        check(matches && nameMatches, 401);
        failures.delete(source); expire(); check(sessions.size < 32, 429);
        const token = randomBytes(32).toString('hex'); const created = clock(); const expiresAt = created + 900000;
        sessions.set(digest(token), { created, expiresAt }); return { token, expiresAt };
      } finally { candidate?.fill(0); active = false; }
    },
    authorize(header) {
      expire(); check(typeof header === 'string' && /^Bearer [a-f0-9]{64}$/.test(header), 401);
      const key = digest(header.slice(7)); check(sessions.has(key), 401); return key;
    },
    refresh(header) { const key = this.authorize(header); const session = sessions.get(key); session.expiresAt = Math.min(clock() + 900000, session.created + 43200000); return { expiresAt: session.expiresAt }; },
    logout(header) { const key = this.authorize(header); sessions.delete(key); return { signedOut: true }; },
  };
}
