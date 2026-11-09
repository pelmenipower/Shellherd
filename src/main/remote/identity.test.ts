import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RemoteIdentityStore, type IdentityCipher, type RemoteIdentity } from './identity'

const derive = (pkcs8: Buffer): RemoteIdentity => {
  const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
  const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64')
  return { privateKey, publicKey, id: createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex') }
}
const generate = (): RemoteIdentity => {
  const { privateKey } = generateKeyPairSync('ed25519')
  return derive(privateKey.export({ format: 'der', type: 'pkcs8' }))
}
const cipher = (available = true): IdentityCipher => ({
  available: () => available,
  encrypt: b => Buffer.from(b.toString('hex'), 'utf8').reverse(),
  decrypt: c => Buffer.from(Buffer.from(c).reverse().toString('utf8'), 'hex')
})
const fp = (n: number): string => n.toString(16).padStart(64, '0')

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remote-identity-'))
  file = join(dir, 'remote-identity.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const store = (c: IdentityCipher = cipher(), d = derive): RemoteIdentityStore => new RemoteIdentityStore(file, c, generate, d)

describe('RemoteIdentityStore', () => {
  it('persists and reloads the same fingerprint', () => {
    const first = store().load()
    expect(first.persistent).toBe(true)
    const second = store().load()
    expect(second.persistent).toBe(true)
    expect(second.identity.id).toBe(first.identity.id)
    expect(second.identity.publicKey).toBe(first.identity.publicKey)
  })

  it('writes mode 0600 and leaves no tmp files', () => {
    store().load()
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readdirSync(dir)).toEqual(['remote-identity.json'])
  })

  it('does not store the private key in clear text', () => {
    const s = store()
    const { identity } = s.load()
    const pkcs8 = identity.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
    expect(readFileSync(file, 'utf8')).not.toContain(pkcs8)
  })

  it('caches load()', () => {
    const s = store()
    expect(s.load()).toBe(s.load())
  })

  it('stays in RAM when no cipher is available, with a stable id', () => {
    const s = store(cipher(false))
    const a = s.load()
    expect(a.persistent).toBe(false)
    expect(s.load().identity.id).toBe(a.identity.id)
    expect(readdirSync(dir)).toEqual([])
  })

  it.each([
    ['corrupt json', () => '{nope'],
    ['version 2 without mac', () => JSON.stringify({ version: 2, identity: 'AA', knownDevices: [] })],
    ['version 3', () => JSON.stringify({ version: 3, identity: 'AA', knownDevices: [], mac: 'a'.repeat(64) })],
    ['invalid knownDevices', () => JSON.stringify({ version: 1, identity: 'AA', knownDevices: [{ fingerprint: 'x' }] })],
    ['oversized', () => ' '.repeat(64 * 1024 + 1)]
  ])('throws identity and keeps the file for %s', (_name, content) => {
    writeFileSync(file, content())
    const before = readFileSync(file)
    expect(() => store().load()).toThrow('identity')
    expect(readFileSync(file).equals(before)).toBe(true)
  })

  it('throws identity when decrypt fails', () => {
    store().load()
    const before = readFileSync(file)
    const broken = { ...cipher(), decrypt: () => { throw new Error('nope') } }
    expect(() => store(broken).load()).toThrow('identity')
    expect(readFileSync(file).equals(before)).toBe(true)
  })

  it('throws identity when derive fails', () => {
    store().load()
    const before = readFileSync(file)
    expect(() => store(cipher(), () => { throw new Error('bad') }).load()).toThrow('identity')
    expect(readFileSync(file).equals(before)).toBe(true)
  })

  it('throws identity when the file exists but the cipher is unavailable', () => {
    store().load()
    const before = readFileSync(file)
    expect(() => store(cipher(false)).load()).toThrow('identity')
    expect(readFileSync(file).equals(before)).toBe(true)
    expect(readdirSync(dir)).toEqual(['remote-identity.json'])
  })

  describe('known devices', () => {
    it('remembers and recalls, keeping firstSeen', () => {
      const s = store()
      s.load()
      expect(s.known(fp(1))).toBeUndefined()
      s.remember(fp(1), 'Laptop', 100)
      s.remember(fp(1), 'Laptop 2', 200)
      expect(s.known(fp(1))).toEqual({ firstSeen: 100, verified: false })
      const reloaded = store()
      reloaded.load()
      expect(reloaded.known(fp(1))).toEqual({ firstSeen: 100, verified: false })
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      expect(saved.knownDevices).toEqual([{ fingerprint: fp(1), name: 'Laptop 2', firstSeen: 100, lastSeen: 200, verified: false }])
    })

    it('does nothing before load', () => {
      const s = store()
      s.remember(fp(1), 'x', 1)
      expect(s.known(fp(1))).toBeUndefined()
      expect(readdirSync(dir)).toEqual([])
    })

    it('truncates names to 80 characters', () => {
      const s = store()
      s.load()
      s.remember(fp(1), 'a'.repeat(120), 1)
      expect(JSON.parse(readFileSync(file, 'utf8')).knownDevices[0].name).toHaveLength(80)
    })

    it('keeps at most 64 entries and drops the smallest lastSeen', () => {
      const s = store()
      s.load()
      for (let i = 1; i <= 64; i++) s.remember(fp(i), 'd', 1000 + i)
      s.remember(fp(1), 'd', 5000) // refresh oldest
      s.remember(fp(99), 'new', 6000)
      expect(s.known(fp(2))).toBeUndefined()
      expect(s.known(fp(1))).toBeDefined()
      expect(s.known(fp(99))).toBeDefined()
      expect(JSON.parse(readFileSync(file, 'utf8')).knownDevices).toHaveLength(64)
    })

    it('sets verifiedAt once and never downgrades', () => {
      const s = store()
      s.load()
      s.remember(fp(1), 'A', 100)
      s.remember(fp(1), 'A', 200, true)
      s.remember(fp(1), 'A', 300, true)
      s.remember(fp(1), 'A', 400, false)
      expect(s.known(fp(1))).toEqual({ firstSeen: 100, verified: true, verifiedAt: 200 })
      s.remember(fp(2), 'B', 500, true)
      expect(s.known(fp(2))).toEqual({ firstSeen: 500, verified: true, verifiedAt: 500 })
      const reloaded = store()
      reloaded.load()
      expect(reloaded.known(fp(1))).toEqual({ firstSeen: 100, verified: true, verifiedAt: 200 })
    })

    it('detects a renamed device', () => {
      const s = store()
      s.load()
      s.remember(fp(1), 'Laptop', 1, true)
      s.remember(fp(3), 'Phone', 1)
      expect(s.renamed(fp(2), 'Laptop')).toBe(true)
      expect(s.renamed(fp(1), 'Laptop')).toBe(false)
      expect(s.renamed(fp(2), 'Other')).toBe(false)
      expect(s.renamed(fp(4), 'Phone')).toBe(false)
    })

    it('keeps a RAM list without writing in non-persistent mode', () => {
      const s = store(cipher(false))
      s.load()
      s.remember(fp(1), 'x', 7)
      expect(s.known(fp(1))).toEqual({ firstSeen: 7, verified: false })
      expect(readdirSync(dir)).toEqual([])
    })
  })

  describe('file format v2', () => {
    it('round-trips with version 2 and a mac', () => {
      const s = store()
      s.load()
      s.remember(fp(1), 'A', 1, true)
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      expect(saved.version).toBe(2)
      expect(saved.mac).toMatch(/^[a-f0-9]{64}$/)
      const again = store()
      again.load()
      expect(again.known(fp(1))?.verified).toBe(true)
    })

    it('rejects tampered knownDevices without touching the file', () => {
      const s = store()
      s.load()
      s.remember(fp(1), 'A', 1)
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      saved.knownDevices[0].verified = true
      writeFileSync(file, JSON.stringify(saved))
      const before = readFileSync(file)
      expect(() => store().load()).toThrow('identity')
      expect(readFileSync(file).equals(before)).toBe(true)
    })

    it('rejects a tampered mac', () => {
      store().load()
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      saved.mac = (saved.mac[0] === 'a' ? 'b' : 'a') + saved.mac.slice(1)
      writeFileSync(file, JSON.stringify(saved))
      expect(() => store().load()).toThrow('identity')
    })
  })

  describe('migration from v1', () => {
    const writeV1 = (): string => {
      const { identity } = store(cipher(false)).load()
      const pkcs8 = identity.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer
      writeFileSync(
        file,
        JSON.stringify({
          version: 1,
          identity: cipher().encrypt(pkcs8).toString('base64'),
          knownDevices: [{ fingerprint: fp(1), name: 'Old', firstSeen: 5, lastSeen: 6 }]
        })
      )
      return identity.id
    }

    it('migrates to v2 with verified false and the same fingerprint', () => {
      const id = writeV1()
      const s = store()
      expect(s.load().identity.id).toBe(id)
      expect(s.known(fp(1))).toEqual({ firstSeen: 5, verified: false })
      expect(readdirSync(dir)).toEqual(['remote-identity.json'])
      expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(2)
      const again = store()
      expect(again.load().identity.id).toBe(id)
      expect(again.known(fp(1))?.verified).toBe(false)
    })

    it('rejects a v1 file holding a v2 blob', () => {
      store().load()
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      writeFileSync(file, JSON.stringify({ version: 1, identity: saved.identity, knownDevices: [] }))
      const before = readFileSync(file)
      expect(() => store().load()).toThrow('identity')
      expect(readFileSync(file).equals(before)).toBe(true)
    })

    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
      'keeps v2 in RAM when the migration write fails and writes it on the next remember',
      () => {
        const id = writeV1()
        const before = readFileSync(file)
        chmodSync(dir, 0o500)
        const s = store()
        try {
          expect(s.load().identity.id).toBe(id)
          expect(readFileSync(file).equals(before)).toBe(true)
        } finally {
          chmodSync(dir, 0o700)
        }
        s.remember(fp(2), 'New', 9)
        expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(2)
        const again = store()
        expect(again.load().identity.id).toBe(id)
        expect(again.known(fp(2))).toBeDefined()
      }
    )
  })
})
