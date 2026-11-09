import { createHmac, timingSafeEqual, type KeyObject } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import { z } from 'zod'

export interface IdentityCipher {
  available(): boolean
  encrypt(plain: Buffer): Buffer
  decrypt(cipher: Buffer): Buffer
}
/** Same shape as rendezvous-client createRendezvousIdentity(). */
export interface RemoteIdentity {
  privateKey: KeyObject
  publicKey: string
  id: string
}

const MAX_FILE_BYTES = 64 * 1024
const MAX_KNOWN = 64
const MAX_NAME = 80

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

function computeMac(macKey: Buffer, identity: string, devices: KnownDevice[]): Buffer {
  const message = JSON.stringify([
    MAC_DOMAIN,
    identity,
    devices.map(d => [d.fingerprint, d.name, d.firstSeen, d.lastSeen, d.verified, d.verifiedAt ?? null])
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

export class RemoteIdentityStore {
  private loaded?: { identity: RemoteIdentity; persistent: boolean }
  private known_: KnownDevice[] = []
  private encrypted = ''
  private macKey: Buffer = Buffer.alloc(0)

  constructor(
    private readonly file: string,
    private readonly cipher: IdentityCipher,
    private readonly generate: () => RemoteIdentity,
    private readonly derive: (pkcs8: Buffer) => RemoteIdentity
  ) {}

  load(): { identity: RemoteIdentity; persistent: boolean } {
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

  private create(): { identity: RemoteIdentity; persistent: boolean } {
    const identity = this.generate()
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
    const pkcs8 = identity.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer
    return this.cipher.encrypt(Buffer.concat([pkcs8, this.macKey])).toString('base64')
  }

  private read(size: number): { identity: RemoteIdentity; persistent: boolean } {
    if (size > MAX_FILE_BYTES || !this.cipher.available()) fail()
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      const version = (raw as { version?: unknown } | null)?.version
      return version === 2 ? this.readV2(fileSchemaV2.parse(raw)) : this.migrateV1(fileSchemaV1.parse(raw))
    } catch {
      return fail()
    }
  }

  private readV2(parsed: z.infer<typeof fileSchemaV2>): { identity: RemoteIdentity; persistent: boolean } {
    const plain = this.cipher.decrypt(Buffer.from(parsed.identity, 'base64'))
    if (plain.length <= MAC_KEY_BYTES) return fail()
    const macKey = Buffer.from(plain.subarray(-MAC_KEY_BYTES))
    const identity = this.derive(plain.subarray(0, -MAC_KEY_BYTES))
    const expected = computeMac(macKey, parsed.identity, parsed.knownDevices)
    const actual = Buffer.from(parsed.mac, 'hex')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return fail()
    this.macKey = macKey
    this.encrypted = parsed.identity
    this.known_ = parsed.knownDevices
    return { identity, persistent: true }
  }

  /** v1 -> v2: entries become unverified, then exactly one atomic v2 write (kept in RAM if it fails). */
  private migrateV1(parsed: z.infer<typeof fileSchemaV1>): { identity: RemoteIdentity; persistent: boolean } {
    const plain = this.cipher.decrypt(Buffer.from(parsed.identity, 'base64'))
    const identity = this.derive(plain)
    // A v2 blob (pkcs8 || macKey) must not pass as v1.
    if (!(identity.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).equals(plain)) return fail()
    this.macKey = randomBytes(MAC_KEY_BYTES)
    this.encrypted = this.seal(identity)
    this.known_ = parsed.knownDevices.map(item => ({ ...item, verified: false }))
    this.save()
    return { identity, persistent: true }
  }

  private save(): void {
    try {
      this.write()
    } catch {
      // Keep the in-memory list; the next remember retries.
    }
  }

  private write(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const mac = computeMac(this.macKey, this.encrypted, this.known_).toString('hex')
    writeAtomic(this.file, JSON.stringify({ version: 2, identity: this.encrypted, knownDevices: this.known_, mac }))
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

