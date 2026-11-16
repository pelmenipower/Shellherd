// Storage login only. Never use this password as a Vault encryption key.
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_LIMITS } from './rate-limit.mjs';
const derive = promisify(scrypt);
const PASSWORD_WINDOW_MS = 600_000;
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
export const CUSTOM_PASSWORD_MIN = 20;
export const INITIAL_PASSWORD_FILE = 'initial-password.txt';
/** Writes the generated password next to `target` (tmp wx 0600, fsync, rename); it never goes to stdout. Returns the path. */
export async function writeInitialPassword(target, password) {
  check(typeof target === 'string' && typeof password === 'string' && password.length > 0);
  const directory = dirname(target); const file = join(directory, INITIAL_PASSWORD_FILE); const temporary = join(directory, randomBytes(16).toString('hex') + '.pw-tmp');
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(password + '\n'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
    const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return file;
}
const digestOf = value => createHash('sha256').update(value).digest();
function bytes(value, length) { check(typeof value === 'string'); const b = Buffer.from(value, 'base64'); check(b.length === length && b.toString('base64') === value); return b; }
export async function createAccount(username, password) {
  check(validUser(username) && typeof password === 'string' && password.length >= 12 && password.length <= 1024);
  const salt = randomBytes(16); const hash = await derive(password, salt, 32, parameters);
  try { return { username, algorithm: 'scrypt-v1', salt: salt.toString('base64'), hash: hash.toString('base64') }; }
  finally { hash.fill(0); }
}
export function accountAuth(account, clock = Date.now, limits = DEFAULT_LIMITS, roster = null) {
  check(account && Object.keys(account).sort().join(',') === 'algorithm,hash,salt,username' && validUser(account.username) && account.algorithm === 'scrypt-v1');
  const salt = bytes(account.salt, 16); const hash = bytes(account.hash, 32);
  const sessions = new Map(); let active = false;
  // Failure state per source (insertion order = LRU). The global password budget lives in RAM only: a restart resets it.
  const failures = new Map(); const FAILURE_MEMORY = 900_000;
  let passwordWindow = null; let passwordFailures = 0;
  const record = source => { const now = clock(); const r = failures.get(source); if (r && (now < r.last || now - r.last >= FAILURE_MEMORY)) failures.delete(source); return failures.get(source); };
  const fail = source => {
    const now = clock(); const rr = record(source) ?? { f: 0, last: now }; failures.delete(source);
    rr.f++; rr.last = now; failures.set(source, rr); if (failures.size > limits.maxKeys) failures.delete(failures.keys().next().value);
  };
  // Session and revocation proofs fail on their own budget: they must not feed the password backoff or the global password failure budget.
  const sessionFailures = new Map(); const SESSION_FREE = 10;
  const sessionRecord = source => { const now = clock(); const r = sessionFailures.get(source); if (r && (now < r.last || now - r.last >= FAILURE_MEMORY)) sessionFailures.delete(source); return sessionFailures.get(source); };
  const digest = token => createHash('sha256').update(token).digest('hex');
  const expire = () => { const now = clock(); for (const [key, session] of sessions) if (now < session.created || now >= session.expiresAt) sessions.delete(key); };
  return {
    isActive(key) { expire(); const session = sessions.get(key); return Boolean(session) && roster !== null && roster.isActive(session.device); },
    deviceOf(key) { return sessions.get(key)?.device; },
    hasSession(deviceId) { expire(); for (const session of sessions.values()) if (session.device === deviceId) return true; return false; },
    dropDevice(deviceId) { for (const [key, session] of sessions) if (session.device === deviceId) sessions.delete(key); },
    fail,
    /** Throws 429 while the source is backing off after repeated failed session attempts. */
    sessionGate(source) {
      const r = sessionRecord(source); if (!r || r.f < SESSION_FREE) return;
      const until = r.last + Math.min(60, 2 ** (r.f - SESSION_FREE)) * 1000; const now = clock();
      check(now >= until, 429, Math.max(1, Math.ceil((until - now) / 1000)));
    },
    failSession(source) {
      const now = clock(); const r = sessionRecord(source) ?? { f: 0, last: now }; sessionFailures.delete(source);
      r.f++; r.last = now; sessionFailures.set(source, r); if (sessionFailures.size > limits.maxKeys) sessionFailures.delete(sessionFailures.keys().next().value);
    },
    clearSession(source) { sessionFailures.delete(source); },
    openSession(deviceId) {
      check(roster !== null, 500); expire();
      const own = [...sessions].filter(([, session]) => session.device === deviceId);
      if (own.length >= 4) sessions.delete(own.sort((a, b) => a[1].created - b[1].created)[0][0]);
      check(sessions.size < 64, 429);
      const token = randomBytes(32).toString('hex'); const created = clock(); const expiresAt = created + 900000;
      sessions.set(digest(token), { created, expiresAt, device: deviceId }); return { token, expiresAt };
    },
    async verifyPassword(body, source = 'local') {
      const now = clock(); const r = record(source);
      if (passwordWindow !== null && (now < passwordWindow || now - passwordWindow >= PASSWORD_WINDOW_MS)) { passwordWindow = null; passwordFailures = 0; }
      if (r?.f >= 3) { const until = r.last + Math.min(60, 2 ** (r.f - 3)) * 1000; check(now >= until, 429, Math.max(1, Math.ceil((until - now) / 1000))); }
      // Hard global cap on wrong passwords per fixed window: everyone is refused before scrypt until the window ends.
      if (passwordFailures >= limits.passwordFailuresGlobal) check(false, 429, Math.max(1, Math.ceil((passwordWindow + PASSWORD_WINDOW_MS - now) / 1000)));
      check(!active, 429, 1);
      try { check(body && Object.keys(body).sort().join(',') === 'password,username' && typeof body.username === 'string' && body.username.length <= 64 && typeof body.password === 'string' && body.password.length > 0 && body.password.length <= 1024); }
      catch (error) { fail(source); throw error; }
      active = true; let candidate;
      try {
        candidate = await derive(body.password, salt, 32, parameters);
        const matches = timingSafeEqual(candidate, hash); const nameMatches = timingSafeEqual(digestOf(body.username), digestOf(account.username));
        if (!(matches && nameMatches)) { fail(source); if (passwordWindow === null) passwordWindow = clock(); passwordFailures++; }
        check(matches && nameMatches, 401);
        failures.delete(source); return true;
      } finally { candidate?.fill(0); active = false; }
    },
    authorize(header) {
      check(roster !== null, 500); expire(); check(typeof header === 'string' && /^Bearer [a-f0-9]{64}$/.test(header), 401);
      const key = digest(header.slice(7)); const session = sessions.get(key); check(session, 401);
      if (!roster.isActive(session.device)) { sessions.delete(key); check(false, 401); }
      return key;
    },
    refresh(header) { const key = this.authorize(header); const session = sessions.get(key); session.expiresAt = Math.min(clock() + 900000, session.created + 43200000); return { expiresAt: session.expiresAt }; },
    logout(header) { const key = this.authorize(header); sessions.delete(key); return { signedOut: true }; },
  };
}
