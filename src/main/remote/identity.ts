import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  timingSafeEqual,
  type KeyObject
} from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import { z } from 'zod'

export interface IdentityCipher {
  available(): boolean
  encrypt(plain: Buffer): Buffer
  decrypt(cipher: Buffer): Buffer
}
/** X25519 key for the rendezvous plus Ed25519 key for device signatures. */
export interface RemoteIdentity {
  privateKey: KeyObject
  publicKey: string
  id: string
  signingKey: KeyObject
  signingPublicKey: string
}
export interface Enrollment {
  serverId: string
  namespace: string
  serverUrl: string
  username: string
  name: string
  enrolledAt: number
}

const MAX_FILE_BYTES = 64 * 1024
const MAX_KNOWN = 64
const MAX_NAME = 80
const MAX_ENROLLMENTS = 16
const X25519_PREFIX = '302e020100300506032b656e04220420'
const ED25519_PREFIX = '302e020100300506032b657004220420'
const BLOB_TAG = 'shellherd-device-identity-v3'

const knownV1Schema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().max(MAX_NAME),
  firstSeen: z.number().finite(),
  lastSeen: z.number().finite()
})
const knownSchema = knownV1Schema.extend({
  verified: z.boolean(),
  verifiedAt: z.number().finite().optional()
})
const MAC_KEY_BYTES = 32
const MAC_DOMAIN = 'shellherd-remote-identity-v2'
const MAC_DOMAIN_V3 = 'shellherd-remote-identity-v3'

function deviceTuples(devices: KnownDevice[]): unknown[] {
  return devices.map(d => [d.fingerprint, d.name, d.firstSeen, d.lastSeen, d.verified, d.verifiedAt ?? null])
}
function computeMac(macKey: Buffer, identity: string, devices: KnownDevice[], enrollments?: Enrollment[]): Buffer {
  const message =
    enrollments === undefined
      ? JSON.stringify([MAC_DOMAIN, identity, deviceTuples(devices)])
      : JSON.stringify([
          MAC_DOMAIN_V3,
          identity,
          deviceTuples(devices),
          enrollments.map(e => [e.serverId, e.namespace, e.serverUrl, e.username, e.name, e.enrolledAt])
        ])
  return createHmac('sha256', macKey).update(message).digest()
}
const fileSchemaV1 = z.object({
  version: z.literal(1),
  identity: z.string().min(1),
  knownDevices: z.array(knownV1Schema).max(MAX_KNOWN)
})
const fileSchemaV2 = z.object({
  version: z.literal(2),
  identity: z.string().min(1),
  knownDevices: z.array(knownSchema).max(MAX_KNOWN),
  mac: z.string().regex(/^[a-f0-9]{64}$/)
})
const enrollmentSchema = z.object({
  serverId: z.string().regex(/^[a-f0-9]{64}$/),
  namespace: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  serverUrl: z.string().max(2048),
  username: z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/),
  name: z.string().max(MAX_NAME),
  enrolledAt: z.number().finite()
})
const fileSchemaV3 = z.object({
  version: z.literal(3),
  identity: z.string().min(1),
  knownDevices: z.array(knownSchema).max(MAX_KNOWN),
  enrollments: z.array(enrollmentSchema).max(MAX_ENROLLMENTS),
  mac: z.string().regex(/^[a-f0-9]{64}$/)
})
type KnownDevice = z.infer<typeof knownSchema>

const fail = (): never => {
  throw new Error('identity')
}

/** Atomic write: tmp file in the same folder (0600), fsync, rename, then fsync the folder (POSIX). */
function writeAtomic(file: string, data: string): void {
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`
  const fd = openSync(tmp, 'wx', 0o600)
  try {
    try {
      writeSync(fd, data)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, file)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // tmp already gone
    }
    throw error
  }
  if (process.platform !== 'win32') {
    try {
      const dirFd = openSync(dirname(file), 'r')
      try {
        fsyncSync(dirFd)
      } finally {
        closeSync(dirFd)
      }
    } catch {
      // directory fsync is best effort
    }
  }
}

/** Hex SHA-256 of the SPKI DER; same checks as rendezvous.mjs deviceId() (X25519 SPKI only). */
export function deviceFingerprint(spkiBase64: string): string {
  const bad = (): never => {
    throw new Error('identity')
  }
  if (typeof spkiBase64 !== 'string' || spkiBase64.length !== 60) return bad()
  const der = Buffer.from(spkiBase64, 'base64')
  if (der.toString('base64') !== spkiBase64 || der.length !== 44 || der.subarray(0, 12).toString('hex') !== '302a300506032b656e032100') {
    return bad()
  }
  let type: string | undefined
  try {
    type = createPublicKey({ key: der, type: 'spki', format: 'der' }).asymmetricKeyType
  } catch {
    return bad()
  }
  if (type !== 'x25519') return bad()
  return createHash('sha256').update(der).digest('hex')
}

function pkcs8Of(key: KeyObject): Buffer {
  return key.export({ format: 'der', type: 'pkcs8' }) as Buffer
}

function build(x25519: KeyObject, ed25519: KeyObject): RemoteIdentity {
  const publicKey = createPublicKey(x25519).export({ format: 'der', type: 'spki' }).toString('base64')
  const spki = createPublicKey(ed25519).export({ format: 'der', type: 'spki' }) as Buffer
  return {
    privateKey: x25519,
    publicKey,
    id: deviceFingerprint(publicKey),
    signingKey: ed25519,
    signingPublicKey: spki.subarray(-32).toString('base64')
  }
}

export function generateRemoteIdentity(): RemoteIdentity {
  return build(generateKeyPairSync('x25519').privateKey, generateKeyPairSync('ed25519').privateKey)
}

/** Parses a PKCS8 DER with a fixed prefix and returns the key; throws on any mismatch. */
function parsePkcs8(der: Buffer, prefix: string, type: string): KeyObject {
  if (der.length !== 48 || der.subarray(0, 16).toString('hex') !== prefix) return fail()
  const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  if (key.asymmetricKeyType !== type) return fail()
  return key
}

type Loaded = { identity: RemoteIdentity; persistent: boolean }

export class RemoteIdentityStore {
  private loaded?: Loaded
  private known_: KnownDevice[] = []
  private enrollments_: Enrollment[] = []
  private encrypted = ''
  private macKey: Buffer = Buffer.alloc(0)

  constructor(
    private readonly file: string,
    private readonly cipher: IdentityCipher
  ) {}

  load(): Loaded {
    if (this.loaded) return this.loaded
    let size: number | undefined
    try {
      size = statSync(this.file).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail()
    }
    this.loaded = size === undefined ? this.create() : this.read(size)
    return this.loaded
  }

  known(fingerprint: string): { firstSeen: number; verified: boolean; verifiedAt?: number } | undefined {
    const entry = this.known_.find(item => item.fingerprint === fingerprint)
    if (!entry) return undefined
    return entry.verifiedAt === undefined
      ? { firstSeen: entry.firstSeen, verified: entry.verified }
      : { firstSeen: entry.firstSeen, verified: entry.verified, verifiedAt: entry.verifiedAt }
  }

  /** True when fingerprint itself is not verified and a verified entry with the same name has another fingerprint. */
  renamed(fingerprint: string, name: string): boolean {
    if (this.known_.some(item => item.fingerprint === fingerprint && item.verified)) return false
    const shortName = name.slice(0, MAX_NAME)
    return this.known_.some(item => item.verified && item.name === shortName && item.fingerprint !== fingerprint)
  }

  /** verified=true marks the pin verified (verifiedAt=now on first verification); false never downgrades. */
  remember(fingerprint: string, name: string, now: number, verified = false): void {
    if (!this.loaded) return
    const entry = this.known_.find(item => item.fingerprint === fingerprint)
    const shortName = name.slice(0, MAX_NAME)
    if (entry) {
      entry.lastSeen = now
      entry.name = shortName
      if (verified && !entry.verified) {
        entry.verified = true
        entry.verifiedAt = now
      }
    } else {
      this.known_.push({
        fingerprint,
        name: shortName,
        firstSeen: now,
        lastSeen: now,
        verified,
        ...(verified ? { verifiedAt: now } : {})
      })
    }
    if (this.known_.length > MAX_KNOWN) {
      const oldest = this.known_.reduce((a, b) => (b.lastSeen < a.lastSeen ? b : a))
      this.known_ = this.known_.filter(item => item !== oldest)
    }
    if (this.loaded.persistent) this.save()
  }

  enrollment(serverId: string): Enrollment | undefined {
    const entry = this.enrollments_.find(item => item.serverId === serverId)
    return entry ? { ...entry } : undefined
  }

  /** Replaces the same serverId; keeps at most 16 (oldest enrolledAt drops). Persists only for a persistent identity, otherwise RAM. */
  rememberEnrollment(e: Enrollment): void {
    if (!this.loaded) return
    this.enrollments_ = this.enrollments_.filter(item => item.serverId !== e.serverId)
    this.enrollments_.push({ ...e })
    if (this.enrollments_.length > MAX_ENROLLMENTS) {
      const oldest = this.enrollments_.reduce((a, b) => (b.enrolledAt < a.enrolledAt ? b : a))
      this.enrollments_ = this.enrollments_.filter(item => item !== oldest)
    }
    if (this.loaded.persistent) this.save()
  }

  forgetEnrollment(serverId: string): void {
    if (!this.loaded) return
    const before = this.enrollments_.length
    this.enrollments_ = this.enrollments_.filter(item => item.serverId !== serverId)
    if (this.enrollments_.length !== before && this.loaded.persistent) this.save()
  }

  private create(): Loaded {
    const identity = generateRemoteIdentity()
    if (!this.cipher.available()) return { identity, persistent: false }
    try {
      this.macKey = randomBytes(MAC_KEY_BYTES)
      this.encrypted = this.seal(identity)
      this.write()
      return { identity, persistent: true }
    } catch {
      // Could not persist (e.g. read-only folder): fall back to a temporary identity.
      return { identity, persistent: false }
    }
  }

  private seal(identity: RemoteIdentity): string {
    const blob = JSON.stringify([
      BLOB_TAG,
      pkcs8Of(identity.privateKey).toString('base64'),
      pkcs8Of(identity.signingKey).toString('base64'),
      this.macKey.toString('base64')
    ])
    return this.cipher.encrypt(Buffer.from(blob)).toString('base64')
  }

  private read(size: number): Loaded {
    if (size > MAX_FILE_BYTES || !this.cipher.available()) fail()
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      const version = (raw as { version?: unknown } | null)?.version
      if (version === 3) return this.readV3(fileSchemaV3.parse(raw))
      if (version === 2) return this.migrateV2(fileSchemaV2.parse(raw))
      return this.migrateV1(fileSchemaV1.parse(raw))
    } catch {
      return fail()
    }
  }

  private readV3(parsed: z.infer<typeof fileSchemaV3>): Loaded {
    const plain = this.cipher.decrypt(Buffer.from(parsed.identity, 'base64'))
    const blob: unknown = JSON.parse(plain.toString('utf8'))
    if (!Array.isArray(blob) || blob.length !== 4 || blob[0] !== BLOB_TAG || !blob.slice(1).every(v => typeof v === 'string')) return fail()
    const [x, ed, mk] = blob.slice(1).map(v => Buffer.from(v as string, 'base64'))
    if (mk.length !== MAC_KEY_BYTES) return fail()
    const identity = build(parsePkcs8(x, X25519_PREFIX, 'x25519'), parsePkcs8(ed, ED25519_PREFIX, 'ed25519'))
    const expected = computeMac(mk, parsed.identity, parsed.knownDevices, parsed.enrollments)
    const actual = Buffer.from(parsed.mac, 'hex')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return fail()
    this.macKey = mk
    this.encrypted = parsed.identity
    this.known_ = parsed.knownDevices
    this.enrollments_ = parsed.enrollments
    return { identity, persistent: true }
  }

  /** v2 -> v3: verify the v2 MAC, keep X25519 and macKey, add Ed25519, one atomic write. A failing write throws. */
  private migrateV2(parsed: z.infer<typeof fileSchemaV2>): Loaded {
    const plain = this.cipher.decrypt(Buffer.from(parsed.identity, 'base64'))
    if (plain.length !== 48 + MAC_KEY_BYTES) return fail()
    const macKey = Buffer.from(plain.subarray(48))
    const x25519 = parsePkcs8(Buffer.from(plain.subarray(0, 48)), X25519_PREFIX, 'x25519')
    const expected = computeMac(macKey, parsed.identity, parsed.knownDevices)
    const actual = Buffer.from(parsed.mac, 'hex')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return fail()
    return this.upgrade(x25519, macKey, parsed.knownDevices)
  }

  /** v1 -> v3: entries become unverified, a fresh macKey and Ed25519 key are created, one atomic write. */
  private migrateV1(parsed: z.infer<typeof fileSchemaV1>): Loaded {
    const plain = this.cipher.decrypt(Buffer.from(parsed.identity, 'base64'))
    const x25519 = parsePkcs8(plain, X25519_PREFIX, 'x25519')
    return this.upgrade(
      x25519,
      randomBytes(MAC_KEY_BYTES),
      parsed.knownDevices.map(item => ({ ...item, verified: false }))
    )
  }

  private upgrade(x25519: KeyObject, macKey: Buffer, devices: KnownDevice[]): Loaded {
    const identity = build(x25519, generateKeyPairSync('ed25519').privateKey)
    this.macKey = macKey
    this.encrypted = this.seal(identity)
    this.known_ = devices
    this.enrollments_ = []
    // Fail closed: a RAM-only Ed25519 key would be replaced on the next start.
    this.write()
    return { identity, persistent: true }
  }

  private save(): void {
    try {
      this.write()
    } catch {
      // Keep the in-memory lists; the next change retries.
    }
  }

  private write(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const mac = computeMac(this.macKey, this.encrypted, this.known_, this.enrollments_).toString('hex')
    writeAtomic(
      this.file,
      JSON.stringify({ version: 3, identity: this.encrypted, knownDevices: this.known_, enrollments: this.enrollments_, mac })
    )
  }
}

/** OS key store cipher; never falls back to plain text. */
export function safeStorageCipher(): IdentityCipher {
  return {
    available: () => {
      return (
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
      )
    },
    encrypt: b => safeStorage.encryptString(b.toString('base64')),
    decrypt: c => Buffer.from(safeStorage.decryptString(c), 'base64')
  }
}

