import type { KeyObject } from 'node:crypto'
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

const knownSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().max(MAX_NAME),
  firstSeen: z.number().finite(),
  lastSeen: z.number().finite()
})
const fileSchema = z.object({
  version: z.literal(1),
  identity: z.string().min(1),
  knownDevices: z.array(knownSchema).max(MAX_KNOWN)
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

  known(fingerprint: string): { firstSeen: number } | undefined {
    const entry = this.known_.find(item => item.fingerprint === fingerprint)
    return entry ? { firstSeen: entry.firstSeen } : undefined
  }

  remember(fingerprint: string, name: string, now: number): void {
    if (!this.loaded) return
    const entry = this.known_.find(item => item.fingerprint === fingerprint)
    const shortName = name.slice(0, MAX_NAME)
    if (entry) {
      entry.lastSeen = now
      entry.name = shortName
    } else {
      this.known_.push({ fingerprint, name: shortName, firstSeen: now, lastSeen: now })
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
      this.encrypted = this.cipher
        .encrypt(identity.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer)
        .toString('base64')
      this.write()
      return { identity, persistent: true }
    } catch {
      // Could not persist (e.g. read-only folder): fall back to a temporary identity.
      return { identity, persistent: false }
    }
  }

  private read(size: number): { identity: RemoteIdentity; persistent: boolean } {
    if (size > MAX_FILE_BYTES || !this.cipher.available()) fail()
    try {
      const parsed = fileSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')))
      const identity = this.derive(this.cipher.decrypt(Buffer.from(parsed.identity, 'base64')))
      this.encrypted = parsed.identity
      this.known_ = parsed.knownDevices
      return { identity, persistent: true }
    } catch {
      return fail()
    }
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
    writeAtomic(this.file, JSON.stringify({ version: 1, identity: this.encrypted, knownDevices: this.known_ }))
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

