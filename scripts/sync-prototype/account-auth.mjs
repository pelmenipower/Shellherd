// Storage login only. Never use this password as a Vault encryption key.
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const parameters = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const validUser = name => typeof name === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(name);
const check = (ok, status = 400) => { if (!ok) { const error = Error('Account request rejected'); error.status = status; throw error; } };
function bytes(value, length) { check(typeof value === 'string'); const b = Buffer.from(value, 'base64'); check(b.length === length && b.toString('base64') === value); return b; }
export async function createAccount(username, password) {
  check(validUser(username) && typeof password === 'string' && password.length >= 12 && password.length <= 1024);
  const salt = randomBytes(16); const hash = await derive(password, salt, 32, parameters);
  try { return { username, algorithm: 'scrypt-v1', salt: salt.toString('base64'), hash: hash.toString('base64') }; }
  finally { hash.fill(0); }
}
export function accountAuth(account, clock = Date.now) {
  check(account && Object.keys(account).sort().join(',') === 'algorithm,hash,salt,username' && validUser(account.username) && account.algorithm === 'scrypt-v1');
  const salt = bytes(account.salt, 16); const hash = bytes(account.hash, 32);
  const sessions = new Map(); let active = false; let attempts = 0; let start = clock();
  const digest = token => createHash('sha256').update(token).digest('hex');
  const expire = () => { const now = clock(); for (const [key, session] of sessions) if (now < session.created || now >= session.expiresAt) sessions.delete(key); };
  return {
    async login(body) {
      const now = clock(); if (now < start || now - start >= 60000) { start = now; attempts = 0; }
      check(++attempts <= 10 && !active, 429);
      check(body && Object.keys(body).sort().join(',') === 'password,username' && typeof body.username === 'string' && body.username.length <= 64 && typeof body.password === 'string' && body.password.length > 0 && body.password.length <= 1024);
      active = true; let candidate;
      try {
        candidate = await derive(body.password, salt, 32, parameters);
        const matches = timingSafeEqual(candidate, hash); check(matches && body.username === account.username, 401);
        expire(); check(sessions.size < 32, 429);
        const token = randomBytes(32).toString('hex'); const created = clock(); const expiresAt = created + 900000;
        sessions.set(digest(token), { created, expiresAt }); return { token, expiresAt };
      } finally { candidate?.fill(0); active = false; }
    },
    authorize(header) {
      expire(); check(typeof header === 'string' && /^Bearer [a-f0-9]{64}$/.test(header), 401);
      const key = digest(header.slice(7)); check(sessions.has(key), 401); return key;
    },
    logout(header) { const key = this.authorize(header); sessions.delete(key); return { signedOut: true }; },
  };
}
