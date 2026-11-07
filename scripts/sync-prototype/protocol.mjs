// Experimental test-data-only protocol. No production imports or network listener.
import sodium from 'libsodium-wrappers';
import { performance } from 'node:perf_hooks';
await sodium.ready;

const MAX_BYTES = 1024 * 1024;
const encode = value => JSON.stringify(value);
const bytes = value => Buffer.byteLength(encode(value));
const b64 = value => sodium.to_base64(value, sodium.base64_variants.ORIGINAL);
const un64 = (value, length) => {
  if (typeof value !== 'string' || value.length > MAX_BYTES) throw Error('Invalid encoding');
  const result = sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
  if (b64(result) !== value || (length !== undefined && result.length !== length)) throw Error('Invalid length');
  return result;
};
const assert = (condition, message) => { if (!condition) throw Error(message); };
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const digest = value => b64(sodium.crypto_generichash(32, value));
const sign = (data, key) => b64(sodium.crypto_sign_detached(encode(data), key));
const verify = (data, signature, key) => sodium.crypto_sign_verify_detached(un64(signature, 64), encode(data), un64(key, 32));
const clone = value => JSON.parse(encode(value));

export function device(name, restoredKeys) {
  assert(id(name), 'Invalid device ID');
  const signing = restoredKeys?.signing ?? sodium.crypto_sign_keypair();
  const box = restoredKeys?.box ?? sodium.crypto_box_keypair();
  let destroyed = false;
  return {
    id: name, signing, box,
    public: [name, b64(signing.publicKey), b64(box.publicKey)],
    exportState() {
      assert(!destroyed, 'Device destroyed');
      return ['shellherd-lab-device-v1', name, b64(signing.privateKey), b64(box.privateKey)];
    },
    destroy() { destroyed = true; sodium.memzero(signing.privateKey); sodium.memzero(box.privateKey); },
  };
}

function restoreSigning(value) {
  const secret = un64(value, 64);
  let pair;
  try {
    pair = sodium.crypto_sign_seed_keypair(secret.subarray(0, 32));
    assert(sodium.memcmp(pair.privateKey, secret), 'Invalid signing key');
    return pair;
  } catch (error) { if (pair) sodium.memzero(pair.privateKey); throw error; }
  finally { sodium.memzero(secret); }
}

export function restoreDevice(state) {
  assert(Array.isArray(state) && state.length === 4 && state[0] === 'shellherd-lab-device-v1' && id(state[1]), 'Device state');
  const signing = restoreSigning(state[2]);
  try {
    const privateKey = un64(state[3], 32);
    return device(state[1], { signing, box: { privateKey, publicKey: sodium.crypto_scalarmult_base(privateKey) } });
  } catch (error) { sodium.memzero(signing.privateKey); throw error; }
}

function readMembership(document, rootKey, context) {
  assert(Array.isArray(document) && document.length === 2, 'Invalid membership');
  const [body, signature] = document;
  assert(Array.isArray(body) && body.length === 4 && body[0] === 'shellherd-lab-members-v1' && body[1] === context, 'Membership context');
  assert(Number.isSafeInteger(body[2]) && body[2] >= 1 && Array.isArray(body[3]) && body[3].length > 0 && body[3].length <= 16, 'Membership bounds');
  const seen = new Set();
  for (const member of body[3]) {
    assert(Array.isArray(member) && member.length === 3 && id(member[0]) && !seen.has(member[0]), 'Invalid member');
    seen.add(member[0]); un64(member[1], 32); un64(member[2], 32);
  }
  assert(verify(body, signature, rootKey), 'Membership signature');
  return clone(body);
}

export class Authority {
  #key = sodium.crypto_sign_keypair();
  #members;
  #epoch = 0;
  #document = null;
  #destroyed = false;
  constructor(context) { assert(id(context), 'Invalid context'); this.context = context; }
  get publicKey() { assert(!this.#destroyed, 'Authority destroyed'); return b64(this.#key.publicKey); }
  setMembers(devices) {
    assert(!this.#destroyed, 'Authority destroyed');
    const body = ['shellherd-lab-members-v1', this.context, ++this.#epoch,
      devices.map(d => clone(d.public)).sort((a, b) => a[0].localeCompare(b[0], 'en'))];
    const document = [body, sign(body, this.#key.privateKey)];
    this.#members = readMembership(document, this.publicKey, this.context);
    this.#document = clone(document);
    return document;
  }
  authorize(wire, challenge) {
    // The authority authenticates/approves this exact batch, never a wildcard.
    assert(!this.#destroyed && this.#members, 'No membership or authority destroyed');
    readEnvelope(wire, this.#members);
    un64(challenge, 32);
    const body = ['shellherd-lab-publish-v1', this.context, this.#epoch, digest(wire), challenge];
    return [body, sign(body, this.#key.privateKey)];
  }
  exportState() {
    assert(!this.#destroyed, 'Authority destroyed');
    return ['shellherd-lab-authority-v1', this.context, b64(this.#key.privateKey), clone(this.#document)];
  }
  static restore(state) {
    assert(Array.isArray(state) && state.length === 4 && state[0] === 'shellherd-lab-authority-v1' && id(state[1]), 'Authority state');
    const key = restoreSigning(state[2]); const authority = new Authority(state[1]);
    sodium.memzero(authority.#key.privateKey); authority.#key = key;
    try {
      if (state[3] !== null) {
        authority.#members = readMembership(state[3], authority.publicKey, authority.context);
        authority.#epoch = authority.#members[2]; authority.#document = clone(state[3]);
      }
      return authority;
    } catch (error) { authority.destroy(); throw error; }
  }
  destroy() { this.#destroyed = true; sodium.memzero(this.#key.privateKey); }
}

function readEnvelope(wire, members) {
  assert(typeof wire === 'string' && Buffer.byteLength(wire) <= MAX_BYTES, 'Object size');
  const tuple = JSON.parse(wire);
  assert(encode(tuple) === wire && Array.isArray(tuple) && tuple.length === 5, 'Noncanonical envelope');
  const [header, recipients, nonce, ciphertext, signature] = tuple;
  assert(Array.isArray(header) && header.length === 6 && header[0] === 'shellherd-lab-snapshot-v1', 'Envelope version');
  assert(header[1] === members[1] && id(header[2]) && id(header[3]) && header[4] === members[2], 'Envelope context or epoch');
  assert(Array.isArray(header[5]) && header[5].length <= 16 && new Set(header[5]).size === header[5].length, 'Parents');
  header[5].forEach(parent => un64(parent, 32));
  const author = members[3].find(member => member[0] === header[3]);
  assert(author, 'Unauthorized author');
  assert(Array.isArray(recipients) && recipients.length === members[3].length, 'Recipients');
  recipients.forEach((entry, index) => {
    assert(Array.isArray(entry) && entry.length === 3 && entry[0] === members[3][index][0] && entry[1] === members[3][index][2], 'Recipient binding');
    un64(entry[2], 32 + sodium.crypto_box_SEALBYTES);
  });
  un64(nonce, sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  un64(ciphertext);
  assert(verify(tuple.slice(0, 4), signature, author[1]), 'Object signature');
  return tuple;
}

export class Client {
  #members;
  #objects = new Map();
  #pending = new Map();
  #heads = new Set();
  #memberships = new Map();
  #outbox = new Set();
  #merges = new Map();
  #destroyed = false;
  constructor(identity, rootKey, context, clock = () => performance.now()) {
    assert(id(context), 'Invalid context'); un64(rootKey, 32);
    this.identity = identity; this.rootKey = rootKey; this.context = context; this.clock = clock;
  }
  useMembership(document) {
    assert(!this.#destroyed, 'Client destroyed');
    const members = readMembership(document, this.rootKey, this.context);
    assert(!this.#members || members[2] >= this.#members[2], 'Membership rollback');
    assert(!this.#members || members[2] !== this.#members[2] || encode(members) === encode(this.#members), 'Membership fork');
    assert(members[3].some(m => encode(m) === encode(this.identity.public)), 'Device removed or substituted');
    assert(this.#memberships.has(members[2]) || this.#memberships.size < 16, 'Membership history limit');
    this.#memberships.set(members[2], clone(document));
    this.#members = members;
    this.#pending.clear();
  }
  get heads() { assert(!this.#destroyed, 'Client destroyed'); return [...this.#heads].sort(); }
  snapshot(value, parents = this.heads) {
    assert(this.#members, 'No membership');
    assert(parents.length <= 16 && new Set(parents).size === parents.length && parents.every(p => this.#objects.has(p)), 'Unknown parents');
    const plaintext = Buffer.from(encode(value));
    assert(plaintext.length <= MAX_BYTES / 2, 'Payload size');
    const key = sodium.randombytes_buf(32);
    try {
      const header = ['shellherd-lab-snapshot-v1', this.context, sodium.to_hex(sodium.randombytes_buf(16)), this.identity.id, this.#members[2], [...parents].sort()];
      const recipients = this.#members[3].map(m => [m[0], m[2], b64(sodium.crypto_box_seal(key, un64(m[2], 32)))]);
      const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
      const cipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, encode(header), null, nonce, key);
      const unsigned = [header, recipients, b64(nonce), b64(cipher)];
      const wire = encode([...unsigned, sign(unsigned, this.identity.signing.privateKey)]);
      assert(Buffer.byteLength(wire) <= MAX_BYTES, 'Object size');
      this.#outbox.add(this.receive(wire));
      return wire;
    } finally { sodium.memzero(key); plaintext.fill(0); }
  }
  receive(wire) {
    assert(this.#members, 'No membership');
    return this.#ingest(wire, this.#members);
  }
  #ingest(wire, membership) {
    const [header, recipients, nonce, ciphertext] = readEnvelope(wire, membership);
    const hash = digest(wire);
    if (this.#objects.has(hash)) return hash;
    assert(this.#objects.size < 100, 'Client object quota');
    assert(header[5].every(p => this.#objects.has(p)), 'Missing ancestry');
    assert(this.heads.filter(h => !header[5].includes(h)).length < 16, 'Concurrent head limit');
    const packet = recipients.find(r => r[0] === this.identity.id);
    assert(packet, 'Not a recipient');
    const key = sodium.crypto_box_seal_open(un64(packet[2]), this.identity.box.publicKey, this.identity.box.privateKey);
    let plain;
    try {
      plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, un64(ciphertext), encode(header), un64(nonce), key);
      const value = JSON.parse(sodium.to_string(plain));
      this.#objects.set(hash, { wire, value, parents: [...header[5]] });
      header[5].forEach(p => this.#heads.delete(p)); this.#heads.add(hash);
      return hash;
    } finally { sodium.memzero(key); if (plain) sodium.memzero(plain); }
  }
  value(hash) { assert(this.#objects.has(hash), 'Unknown object'); return clone(this.#objects.get(hash).value); }
  pendingSnapshots() {
    assert(!this.#destroyed, 'Client destroyed');
    return [...this.#outbox].map(hash => ({ hash, wire: this.#objects.get(hash).wire }));
  }
  acknowledgePublication(hash) {
    assert(!this.#destroyed && this.#outbox.has(hash), 'Unknown pending publication');
    this.#outbox.delete(hash);
  }
  #checkMerge(base, left, right) {
    const descends = (tip, ancestor) => {
      const pending = [tip]; const seen = new Set();
      while (pending.length) {
        const next = pending.pop(); if (next === ancestor) return true;
        if (seen.has(next)) continue; seen.add(next);
        pending.push(...this.#objects.get(next).parents);
      }
      return false;
    };
    assert([base, left, right].every(h => this.#objects.has(h)) && left !== right && descends(left, base) && descends(right, base), 'Invalid merge ancestry');
    return consolidate(this.value(base), this.value(left), this.value(right));
  }
  stageMerge(base, left, right) {
    assert(!this.#destroyed && this.#merges.size < 16, 'Merge limit or client destroyed');
    assert(this.#heads.has(left) && this.#heads.has(right), 'Merge heads changed');
    const result = this.#checkMerge(base, left, right);
    if (!result.conflicts.length) return { wire: this.snapshot(result.records, [left, right]), conflicts: [] };
    const mergeId = sodium.to_hex(sodium.randombytes_buf(16));
    this.#merges.set(mergeId, [base, left, right]); return { mergeId, ...result };
  }
  stagedMerges() {
    assert(!this.#destroyed, 'Client destroyed');
    return [...this.#merges].map(([mergeId, [base, left, right]]) => ({ mergeId, base, left, right, ...this.#checkMerge(base, left, right) }));
  }
  resolveMerge(mergeId, records) {
    const refs = this.#merges.get(mergeId); assert(refs, 'Unknown merge');
    const [, left, right] = refs;
    assert(this.#heads.has(left) && this.#heads.has(right), 'Merge heads changed');
    consolidate(records, records, records); // Enforce the deliberately limited fixture schema.
    const wire = this.snapshot(records, [left, right]); this.#merges.delete(mergeId); return wire;
  }
  exportState() {
    assert(!this.#destroyed && this.#members, 'Client not initialized');
    return ['shellherd-lab-client-v1', this.context, this.rootKey, this.identity.exportState(),
      [...this.#memberships.values()].map(clone), [...this.#objects.values()].map(o => o.wire), this.heads,
      [...this.#outbox], [...this.#merges].map(clone)];
  }
  static restore(state) {
    assert(Array.isArray(state) && state.length === 9 && state[0] === 'shellherd-lab-client-v1', 'Client state');
    assert(Array.isArray(state[4]) && state[4].length > 0 && state[4].length <= 16 && Array.isArray(state[5]) && state[5].length <= 100, 'Client state bounds');
    const identity = restoreDevice(state[3]); let client;
    try {
      client = new Client(identity, state[2], state[1]);
      for (const membership of state[4]) {
        assert(!client.#memberships.has(membership?.[0]?.[2]), 'Duplicate membership');
        client.useMembership(membership);
      }
      for (const wire of state[5]) {
        assert(typeof wire === 'string' && Buffer.byteLength(wire) <= MAX_BYTES, 'Object size');
        const epoch = JSON.parse(wire)?.[0]?.[4];
        const doc = client.#memberships.get(epoch); assert(doc, 'Missing historical membership');
        const size = client.#objects.size;
        const hash = client.#ingest(wire, readMembership(doc, client.rootKey, client.context));
        assert(client.#objects.size === size + 1, 'Duplicate state object');
        assert(client.#objects.has(hash), 'Missing restored object');
      }
      assert(encode(client.heads) === encode(state[6]), 'Checkpoint heads mismatch');
      assert(Array.isArray(state[7]) && state[7].length <= 100 && new Set(state[7]).size === state[7].length, 'Outbox state');
      for (const hash of state[7]) {
        assert(client.#objects.has(hash) && JSON.parse(client.#objects.get(hash).wire)[0][3] === identity.id, 'Invalid outbox entry');
        client.#outbox.add(hash);
      }
      assert(Array.isArray(state[8]) && state[8].length <= 16, 'Merge state bounds');
      for (const entry of state[8]) {
        assert(Array.isArray(entry) && entry.length === 2 && id(entry[0]) && !client.#merges.has(entry[0]) && Array.isArray(entry[1]) && entry[1].length === 3, 'Merge state');
        assert(client.#checkMerge(...entry[1]).conflicts.length > 0, 'Missing merge conflict');
        client.#merges.set(entry[0], [...entry[1]]);
      }
      return client;
    } catch (error) { if (client) client.destroy(); else identity.destroy(); throw error; }
  }
  destroy() {
    this.#destroyed = true; this.identity.destroy(); this.#members = undefined;
    this.#objects.clear(); this.#heads.clear(); this.#outbox.clear(); this.#pending.clear(); this.#memberships.clear(); this.#merges.clear();
  }
  beginPublication(wire) {
    readEnvelope(wire, this.#members);
    assert(this.#pending.size < 16, 'Pending publication limit');
    const challenge = b64(sodium.randombytes_buf(32));
    this.#pending.set(challenge, { hash: digest(wire), start: this.clock(), epoch: this.#members[2] });
    return challenge;
  }
  finishPublication(wire, permit) {
    assert(Array.isArray(permit) && permit.length === 2, 'Invalid permit');
    const [body, signature] = permit;
    assert(Array.isArray(body) && body.length === 5, 'Invalid permit body');
    const pending = this.#pending.get(body[4]);
    assert(pending, 'Unknown or consumed challenge');
    this.#pending.delete(body[4]);
    const elapsed = this.clock() - pending.start;
    assert(elapsed >= 0 && elapsed < 300_000, 'Expired permit');
    assert(body[0] === 'shellherd-lab-publish-v1' && body[1] === this.context && body[2] === this.#members[2] && body[2] === pending.epoch && body[3] === pending.hash && body[3] === digest(wire), 'Permit binding');
    assert(verify(body, signature, this.rootKey), 'Permit signature');
    return wire;
  }
  assertServerHeads(serverHeads) {
    // A server must still supply every locally known branch, possibly via descendants.
    const ancestors = new Set();
    const visit = hash => {
      assert(this.#objects.has(hash), 'Unknown server head');
      if (ancestors.has(hash)) return;
      ancestors.add(hash); this.#objects.get(hash).parents.forEach(visit);
    };
    assert(Array.isArray(serverHeads) && serverHeads.length <= 16, 'Head limit');
    serverHeads.forEach(visit);
    assert(this.heads.every(h => ancestors.has(h)), 'Server omitted known branch');
  }
}

export class OpaqueStore {
  #objects = new Map();
  put(wire) {
    assertSnapshotWire(wire);
    assert(this.#objects.size < 100 || this.#objects.has(digest(wire)), 'Store quota');
    const hash = digest(wire); this.#objects.set(hash, wire); return hash;
  }
  get(hash) { assert(this.#objects.has(hash), 'Missing object'); return this.#objects.get(hash); }
  dump() { return [...this.#objects.values()].join('\n'); }
}

// Routing/type guard only. Client signature/authorization checks remain mandatory.
// In particular, never send a local checkpoint (which holds private keys) here.
export function assertSnapshotWire(wire) {
  assert(typeof wire === 'string' && Buffer.byteLength(wire) <= MAX_BYTES, 'Object size');
  const tuple = JSON.parse(wire);
  assert(Array.isArray(tuple) && tuple.length === 5 && Array.isArray(tuple[0]) && tuple[0][0] === 'shellherd-lab-snapshot-v1' && encode(tuple) === wire, 'Server accepts snapshot envelopes only');
}

// Conservative three-way merge for flat test records. Every record is atomic,
// including credentials. Production Vault trees/automatic actions are not accepted.
export function consolidate(base, left, right) {
  const valid = v => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 100 && Object.values(v).every(x => x && typeof x === 'object' && !Array.isArray(x));
  assert([base, left, right].every(valid) && [base, left, right].every(v => bytes(v) <= MAX_BYTES / 2), 'Fixture records required');
  const result = Object.create(null); const conflicts = [];
  const equal = (a, b) => encode(a) === encode(b);
  for (const key of [...new Set([...Object.keys(base), ...Object.keys(left), ...Object.keys(right)])].sort()) {
    assert(id(key), 'Invalid record ID');
    const get = o => Object.hasOwn(o, key) ? o[key] : undefined;
    const [b, l, r] = [base, left, right].map(get);
    let chosen;
    if (equal(l, r)) chosen = l;
    else if (equal(b, l)) chosen = r;
    else if (equal(b, r)) chosen = l;
    else { conflicts.push({ id: key, base: b, left: l, right: r }); continue; }
    if (chosen !== undefined) result[key] = clone(chosen);
  }
  return { records: result, conflicts };
}
