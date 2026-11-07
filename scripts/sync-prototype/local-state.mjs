// Local-only encrypted checkpoint. Never upload this file: it contains private keys.
// Linux filesystem semantics only, with a private directory controlled by the user.
import { constants } from 'node:fs';
import { mkdir, lstat, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sodium from 'libsodium-wrappers';
import { argon2id } from 'hash-wasm';
import { Authority, Client } from './protocol.mjs';
await sodium.ready;

const MAX_PLAIN = 16 * 1024 * 1024;
const MAX_FILE = 24 * 1024 * 1024;
const encode = value => JSON.stringify(value);
const b64 = value => sodium.to_base64(value, sodium.base64_variants.ORIGINAL);
const hash = wire => createHash('sha256').update(wire).digest('hex');
const check = (ok, message) => { if (!ok) throw Error(message); };
function decode(value, length) {
  check(typeof value === 'string' && value.length <= MAX_FILE, 'State encoding');
  const bytes = sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
  check(b64(bytes) === value && (length === undefined || bytes.length === length), 'State length'); return bytes;
}
function headerValid(header) {
  check(Array.isArray(header) && header.length === 8 && header[0] === 'shellherd-lab-local-v1' && header[1] === 'argon2id' && header[2] === 65536 && header[3] === 3 && header[4] === 1 && header[7] === 'xchacha20poly1305', 'State format/KDF');
  decode(header[5], 16); decode(header[6], 32);
}
async function derive(password, header) {
  check(typeof password === 'string' && Buffer.byteLength(password) > 0 && Buffer.byteLength(password) <= 1024, 'State password bounds');
  const secret = Buffer.from(password, 'utf8'); let result;
  try {
    result = await argon2id({ password: secret, salt: decode(header[5], 16), memorySize: header[2], iterations: header[3], parallelism: header[4], hashLength: 32, outputType: 'binary' });
    return Buffer.from(result);
  } finally { secret.fill(0); if (result) sodium.memzero(result); }
}
async function privateDirectory(file) {
  check(process.platform === 'linux', 'Local checkpoint currently supports Linux only');
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const stat = await lstat(dirname(file));
  check(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid(), 'Private state directory required');
}
async function readCurrent(file) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    check(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() && (stat.mode & 0o077) === 0 && stat.size <= MAX_FILE, 'State file bounds/permissions');
    // Fixed-size read avoids growth races causing an unbounded allocation.
    const buffer = Buffer.alloc(MAX_FILE + 1);
    try {
      let used = 0;
      while (used < buffer.length) {
        const { bytesRead } = await handle.read(buffer, used, buffer.length - used, used);
        if (!bytesRead) break; used += bytesRead;
      }
      check(used <= MAX_FILE, 'State file size'); return buffer.subarray(0, used).toString('utf8');
    } finally { buffer.fill(0); }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  finally { if (handle) await handle.close(); }
}

export class LocalState {
  #file;
  #key;
  #header;
  #baseline;
  #busy = false;
  #closed = false;
  #uncertain = false;
  // Secret exports never leave the encrypted write path except in authorized RAM.
  constructor(file, key, header, baseline, client, authority, deviceData = null) {
    this.#file = file; this.#key = key; this.#header = header; this.#baseline = baseline;
    this.client = client; this.authority = authority; this.deviceData = deviceData;
  }
  static async create(file, password, { client, authority = null, deviceData = null }) {
    await privateDirectory(file);
    check(await readCurrent(file) === null, 'State file already exists');
    const header = ['shellherd-lab-local-v1', 'argon2id', 65536, 3, 1, b64(sodium.randombytes_buf(16)), b64(sodium.randombytes_buf(32)), 'xchacha20poly1305'];
    const key = await derive(password, header);
    const state = new LocalState(file, key, header, null, client, authority, deviceData);
    try { await state.save(); return state; }
    catch (error) { sodium.memzero(key); state.#closed = true; throw error; }
  }
  static async unlock(file, password, { context, rootKey = null } = {}) {
    check(typeof context === 'string' && context.length > 0, 'Expected context required');
    await privateDirectory(file);
    const wire = await readCurrent(file); check(wire !== null, 'State file missing');
    const tuple = JSON.parse(wire);
    check(Array.isArray(tuple) && tuple.length === 4 && encode(tuple) === wire, 'State envelope');
    const [header, nonce, ciphertext, marker] = tuple;
    headerValid(header); check(marker === 'local-only', 'State purpose');
    const nonceBytes = decode(nonce, 24); const cipherBytes = decode(ciphertext);
    check(cipherBytes.length >= 16 && cipherBytes.length <= MAX_PLAIN + 16, 'State payload size');
    const key = await derive(password, header); let plain; let client; let authority;
    try {
      try { plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, cipherBytes, encode([header, marker]), nonceBytes, key); }
      catch { throw Error('Wrong password or damaged local state'); }
      const payload = JSON.parse(sodium.to_string(plain));
      check(Array.isArray(payload) && ((payload.length === 3 && payload[0] === 'shellherd-lab-checkpoint-v1') || (payload.length === 4 && payload[0] === 'shellherd-lab-checkpoint-bindings-v1')), 'Checkpoint schema');
      client = Client.restore(payload[1]);
      check(client.context === context && (rootKey === null || client.rootKey === rootKey), 'Checkpoint context/authority mismatch');
      if (payload[2] !== null) {
        authority = Authority.restore(payload[2]);
        check(authority.context === context && authority.publicKey === client.rootKey, 'Checkpoint authority mismatch');
        check(encode(payload[2][3]) === encode(payload[1][4].at(-1)), 'Checkpoint membership mismatch');
      }
      return new LocalState(file, key, header, hash(wire), client, authority ?? null, payload[3] ?? null);
    } catch (error) { sodium.memzero(key); client?.destroy(); authority?.destroy(); throw error; }
    finally { if (plain) sodium.memzero(plain); }
  }
  async save({ fault = () => {} } = {}) {
    check(!this.#closed && !this.#uncertain && !this.#busy, 'State locked, uncertain or busy');
    this.#busy = true; let lock; let temporary; let renamed = false;
    try {
      // Synchronous capture prevents a mix of states across async filesystem work.
      const client = this.client.exportState(); const authority = this.authority?.exportState() ?? null;
      if (authority) check(authority[1] === client[1] && this.authority.publicKey === client[2] && encode(authority[3]) === encode(client[4].at(-1)), 'Checkpoint authority/membership mismatch');
      const payload = this.deviceData === null ? ['shellherd-lab-checkpoint-v1', client, authority]
        : ['shellherd-lab-checkpoint-bindings-v1', client, authority, this.deviceData];
      const plain = Buffer.from(encode(payload));
      let wire;
      try {
        check(plain.length <= MAX_PLAIN, 'Checkpoint size');
        const nonce = sodium.randombytes_buf(24);
        const cipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, encode([this.#header, 'local-only']), null, nonce, this.#key);
        wire = encode([this.#header, b64(nonce), b64(cipher), 'local-only']);
      } finally { plain.fill(0); }
      await privateDirectory(this.#file);
      lock = await open(`${this.#file}.lock`, 'wx', 0o600);
      const current = await readCurrent(this.#file);
      check((current === null ? null : hash(current)) === this.#baseline, 'State changed externally; unlock again');
      temporary = join(dirname(this.#file), `${randomUUID()}.local-tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(wire, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await fault('beforeRename');
      await rename(temporary, this.#file); renamed = true;
      await fault('afterRename');
      const directory = await open(dirname(this.#file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      this.#baseline = hash(wire);
      return { heads: [...client[6]], pendingUploads: client[7].length };
    } catch (error) { if (renamed) this.#uncertain = true; throw error; }
    finally {
      try {
        if (temporary) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      } finally {
        try { if (lock) { await lock.close(); await unlink(`${this.#file}.lock`); } }
        finally { this.#busy = false; }
      }
    }
  }
  lock() {
    check(!this.#busy, 'Save in progress');
    if (this.#closed) return;
    this.#closed = true; sodium.memzero(this.#key); this.client.destroy(); this.authority?.destroy();
  }
}
