import { createHash, createHmac, createPublicKey, generateKeyPairSync, verify, sign } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RemoteIdentityStore, deviceFingerprint, generateRemoteIdentity, type Enrollment, type IdentityCipher, type RosterPin } from './identity'

const cipher = (available = true): IdentityCipher => ({
  available: () => available,
  encrypt: b => Buffer.from(b.toString('hex'), 'utf8').reverse(),
  decrypt: c => Buffer.from(Buffer.from(c).reverse().toString('utf8'), 'hex')
})
const fp = (n: number): string => n.toString(16).padStart(64, '0')
const enr = (n: number, at = n): Enrollment => ({
  serverId: fp(n),
  namespace: 'ns',
  serverUrl: `https://s${n}.example`,
  username: 'alice',
  name: `Dev ${n}`,
  enrolledAt: at
})
const KEY = Buffer.alloc(32, 5).toString('base64')
const pin = (n: number, over: Partial<RosterPin> = {}): RosterPin => ({
  id: fp(n),
  signingKey: KEY,
  revokedAt: null,
  enrolledBy: null,
  acknowledged: false,
  ...over
})
const b64 = (b: Buffer): string => b.toString('base64')
const proofModule = (): Promise<{ ed25519Spki(raw: Buffer): Buffer }> =>
  import(/* @vite-ignore */ pathToFileURL(resolve(__dirname, '../../../scripts/sync-prototype/device-proof.mjs')).href)
const rendezvousModule = (): Promise<{ deviceId(k: string): string }> =>
  import(/* @vite-ignore */ pathToFileURL(resolve(__dirname, '../../../scripts/sync-prototype/rendezvous.mjs')).href)

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remote-identity-'))
  file = join(dir, 'remote-identity.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const store = (c: IdentityCipher = cipher()): RemoteIdentityStore => new RemoteIdentityStore(file, c)

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
    for (const key of [identity.privateKey, identity.signingKey]) {
      expect(readFileSync(file, 'utf8')).not.toContain(key.export({ format: 'der', type: 'pkcs8' }).toString('base64'))
    }
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
    ['version 3 without enrollments', () => JSON.stringify({ version: 3, identity: 'AA', knownDevices: [], mac: 'a'.repeat(64) })],
    ['version 5', () => JSON.stringify({ version: 5, identity: 'AA', knownDevices: [], enrollments: [], mac: 'a'.repeat(64) })],
    ['invalid knownDevices', () => JSON.stringify({ version: 1, identity: 'AA', knownDevices: [{ fingerprint: 'x' }] })],
    ['oversized', () => ' '.repeat(512 * 1024 + 1)]
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

  describe('file format v4', () => {
    it('round-trips with version 4 and a mac', () => {
      const s = store()
      s.load()
      s.remember(fp(1), 'A', 1, true)
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      expect(saved.version).toBe(4)
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

  describe('identity', () => {
    it('has Ed25519 keys of 32/64 bytes and a stable fingerprint', () => {
      const { identity } = store().load()
      expect(Buffer.from(identity.signingPublicKey, 'base64')).toHaveLength(32)
      expect(identity.signingKey.asymmetricKeyType).toBe('ed25519')
      expect(identity.privateKey.asymmetricKeyType).toBe('x25519')
      const sig = sign(null, Buffer.from('m'), identity.signingKey) as Buffer
      expect(sig).toHaveLength(64)
      const again = store().load().identity
      expect(again.signingPublicKey).toBe(identity.signingPublicKey)
      expect(again.id).toBe(identity.id)
    })

    it('verifies signatures against ed25519Spki from device-proof.mjs', async () => {
      const { ed25519Spki } = await proofModule()
      const { identity } = store().load()
      const sig = sign(null, Buffer.from('proof'), identity.signingKey) as Buffer
      const key = createPublicKey({ key: ed25519Spki(Buffer.from(identity.signingPublicKey, 'base64')), format: 'der', type: 'spki' })
      expect(verify(null, Buffer.from('proof'), key, sig)).toBe(true)
    })

    it('deviceFingerprint equals rendezvous.mjs deviceId() and throws like it', async () => {
      const { deviceId } = await rendezvousModule()
      const identity = generateRemoteIdentity()
      expect(deviceFingerprint(identity.publicKey)).toBe(deviceId(identity.publicKey))
      expect(identity.id).toBe(deviceId(identity.publicKey))
      const ed = createPublicKey(identity.signingKey).export({ format: 'der', type: 'spki' }).toString('base64')
      for (const bad of ['', 'abc', ed, identity.publicKey.slice(1) + '=']) {
        expect(() => deviceId(bad)).toThrow()
        expect(() => deviceFingerprint(bad)).toThrow()
      }
    })
  })

  describe('enrollments', () => {
    it('stores, replaces the same serverId, forgets and reloads with MAC', () => {
      const s = store()
      s.load()
      s.rememberEnrollment(enr(1))
      s.rememberEnrollment({ ...enr(1), name: 'Renamed', enrolledAt: 50 })
      s.rememberEnrollment(enr(2))
      expect(s.enrollment(fp(1), 'https://s1.example')?.name).toBe('Renamed')
      const reloaded = store()
      reloaded.load()
      expect(reloaded.enrollment(fp(1), 'https://s1.example')).toEqual({ ...enr(1), name: 'Renamed', enrolledAt: 50 })
      expect(JSON.parse(readFileSync(file, 'utf8')).enrollments).toHaveLength(2)
      reloaded.forgetEnrollment(fp(1), 'https://s1.example')
      expect(reloaded.enrollment(fp(1), 'https://s1.example')).toBeUndefined()
      const third = store()
      third.load()
      expect(third.enrollment(fp(1), 'https://s1.example')).toBeUndefined()
      expect(third.enrollment(fp(2), 'https://s2.example')).toBeDefined()
    })

    it('keeps two origins for one serverId; forget and replace touch only one (E8)', () => {
      const s = store()
      s.load()
      const a = { ...enr(1), serverUrl: 'https://a.example/' }
      const b = { ...enr(1), serverUrl: 'https://b.example', name: 'B' }
      s.rememberEnrollment(a)
      s.rememberEnrollment(b)
      expect(s.enrollment(fp(1), 'https://a.example')).toEqual(a)
      expect(s.enrollment(fp(1), 'https://b.example/path')?.name).toBe('B')
      expect(s.enrolledElsewhere(fp(1), 'https://a.example')).toBe('https://b.example')
      expect(s.enrolledElsewhere(fp(1), 'https://c.example')).toBeDefined()
      expect(s.enrolledElsewhere(fp(2), 'https://c.example')).toBeUndefined()
      s.rememberEnrollment({ ...a, name: 'A2', enrolledAt: 9 })
      expect(JSON.parse(readFileSync(file, 'utf8')).enrollments).toHaveLength(2)
      s.forgetEnrollment(fp(1), 'https://a.example')
      expect(s.enrollment(fp(1), 'https://a.example')).toBeUndefined()
      expect(s.enrollment(fp(1), 'https://b.example')).toBeDefined()
      expect(s.enrolledElsewhere(fp(1), 'https://b.example')).toBeUndefined()
      const reloaded = store()
      reloaded.load()
      expect(reloaded.enrollment(fp(1), 'https://b.example')?.name).toBe('B')
    })

    it('an unparsable URL never matches an origin', () => {
      const s = store()
      s.load()
      s.rememberEnrollment({ ...enr(1), serverUrl: 'not a url' })
      expect(s.enrollment(fp(1), 'not a url')).toBeUndefined()
      expect(s.enrolledElsewhere(fp(1), 'https://x.example')).toBe('not a url')
    })

    it('the 17th entry evicts the oldest enrolledAt', () => {
      const s = store()
      s.load()
      for (let i = 1; i <= 16; i++) s.rememberEnrollment(enr(i, 100 + i))
      s.rememberEnrollment(enr(17, 500))
      expect(s.enrollment(fp(1), 'https://s1.example')).toBeUndefined()
      expect(s.enrollment(fp(2), 'https://s2.example')).toBeDefined()
      expect(s.enrollment(fp(17), 'https://s17.example')).toBeDefined()
      expect(JSON.parse(readFileSync(file, 'utf8')).enrollments).toHaveLength(16)
    })

    it('rejects tampered enrollments with identity and keeps the file', () => {
      const s = store()
      s.load()
      s.rememberEnrollment(enr(1))
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      saved.enrollments[0].serverUrl = 'https://evil.example'
      writeFileSync(file, JSON.stringify(saved))
      const before = readFileSync(file)
      expect(() => store().load()).toThrow('identity')
      expect(readFileSync(file).equals(before)).toBe(true)
    })

    it('rejects invalid enrollment fields and more than 16 entries', () => {
      store().load()
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      writeFileSync(file, JSON.stringify({ ...saved, enrollments: [{ ...enr(1), roster: [], rosterAt: null, username: 'a b' }] }))
      expect(() => store().load()).toThrow('identity')
      writeFileSync(file, JSON.stringify({ ...saved, enrollments: Array.from({ length: 17 }, (_, i) => ({ ...enr(i + 1), roster: [], rosterAt: null })) }))
      expect(() => store().load()).toThrow('identity')
    })

    it('keeps enrollments in RAM only for a temporary identity', () => {
      const s = store(cipher(false))
      s.load()
      s.rememberEnrollment(enr(1))
      expect(s.enrollment(fp(1), 'https://s1.example')).toEqual(enr(1))
      s.forgetEnrollment(fp(1), 'https://s1.example')
      expect(s.enrollment(fp(1), 'https://s1.example')).toBeUndefined()
      s.rememberEnrollment(enr(2))
      expect(readdirSync(dir)).toEqual([])
    })

    it('keeps the RAM entry when the write fails', () => {
      if (process.platform === 'win32' || process.getuid?.() === 0) return
      const s = store()
      s.load()
      chmodSync(dir, 0o500)
      try {
        s.rememberEnrollment(enr(1))
      } finally {
        chmodSync(dir, 0o700)
      }
      expect(s.enrollment(fp(1), 'https://s1.example')).toBeDefined()
    })
  })

  describe('roster snapshot (v4)', () => {
    const URL1 = 'https://s1.example'
    const ready = (): RemoteIdentityStore => {
      const s = store()
      s.load()
      s.rememberEnrollment(enr(1))
      return s
    }

    it('has no roster without an enrollment and ignores rememberRoster', () => {
      const s = store()
      s.load()
      expect(s.rosterOf(fp(1), URL1)).toBeUndefined()
      s.rememberRoster(fp(1), URL1, [pin(1)], 5)
      expect(s.rosterOf(fp(1), URL1)).toBeUndefined()
    })

    it('starts empty and round-trips a roster through the MAC', () => {
      const s = ready()
      expect(s.rosterOf(fp(1), 'https://s1.example/other')).toEqual({ pins: [], at: null })
      s.rememberRoster(fp(1), URL1, [pin(2, { acknowledged: true, enrolledBy: fp(3) }), pin(4, { revokedAt: 9 })], 77)
      const again = store()
      again.load()
      expect(again.rosterOf(fp(1), URL1)).toEqual({ pins: [pin(2, { acknowledged: true, enrolledBy: fp(3) }), pin(4, { revokedAt: 9 })], at: 77 })
      expect(again.enrollment(fp(1), URL1)).toEqual(enr(1))
    })

    it('rejects a tampered roster with identity and keeps the file', () => {
      const s = ready()
      s.rememberRoster(fp(1), URL1, [pin(2)], 1)
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      saved.enrollments[0].roster[0].acknowledged = true
      writeFileSync(file, JSON.stringify(saved))
      const before = readFileSync(file)
      expect(() => store().load()).toThrow('identity')
      expect(readFileSync(file).equals(before)).toBe(true)
      saved.enrollments[0].roster[0].acknowledged = false
      saved.enrollments[0].rosterAt = 2
      writeFileSync(file, JSON.stringify(saved))
      expect(() => store().load()).toThrow('identity')
    })

    it('rejects invalid pins and duplicate ids', () => {
      const s = ready()
      for (const bad of [
        pin(2, { id: 'x' }),
        pin(2, { signingKey: 'abc' }),
        pin(2, { revokedAt: -1 }),
        pin(2, { revokedAt: 1.5 }),
        pin(2, { enrolledBy: 'zz' })
      ]) {
        expect(() => s.rememberRoster(fp(1), URL1, [bad], 1)).toThrow('identity')
      }
      expect(() => s.rememberRoster(fp(1), URL1, [pin(2), pin(2)], 1)).toThrow('identity')
      expect(s.rosterOf(fp(1), URL1)).toEqual({ pins: [], at: null })
    })

    it('drops revoked pins with the smallest revokedAt first above 64', () => {
      const s = ready()
      const pins = [pin(1000, { revokedAt: 50 }), pin(1001, { revokedAt: 10 }), pin(1002, { revokedAt: 30 })]
      for (let i = 0; i < 63; i++) pins.push(pin(i + 1))
      s.rememberRoster(fp(1), URL1, pins, 1)
      const ids = s.rosterOf(fp(1), URL1)?.pins.map(p => p.id)
      expect(ids).toHaveLength(64)
      expect(ids).not.toContain(fp(1001))
      expect(ids).toContain(fp(1000))
      expect(ids).not.toContain(fp(1002))
    })

    it('throws identity when more than 64 active pins remain', () => {
      const s = ready()
      expect(() => s.rememberRoster(fp(1), URL1, Array.from({ length: 65 }, (_, i) => pin(i + 1)), 1)).toThrow('identity')
    })

    it('keeps pins on rememberEnrollment with the same namespace and drops them for another (K11)', () => {
      const s = ready()
      s.rememberRoster(fp(1), URL1, [pin(2)], 5)
      s.rememberEnrollment({ ...enr(1), name: 'Renamed', enrolledAt: 99 })
      expect(s.rosterOf(fp(1), URL1)).toEqual({ pins: [pin(2)], at: 5 })
      s.rememberEnrollment({ ...enr(1), namespace: 'other' })
      expect(s.rosterOf(fp(1), URL1)).toEqual({ pins: [], at: null })
    })

    it('forgetting the enrollment forgets the roster', () => {
      const s = ready()
      s.rememberRoster(fp(1), URL1, [pin(2)], 5)
      s.forgetEnrollment(fp(1), URL1)
      expect(s.rosterOf(fp(1), URL1)).toBeUndefined()
    })

    it('keeps the roster in RAM only for a temporary identity', () => {
      const s = store(cipher(false))
      s.load()
      s.rememberEnrollment(enr(1))
      s.rememberRoster(fp(1), URL1, [pin(2)], 5)
      expect(s.rosterOf(fp(1), URL1)?.pins).toHaveLength(1)
      expect(readdirSync(dir)).toEqual([])
    })

    it('writes and reads 16 enrollments with 64 pins each within the file limit (B3)', () => {
      const s = store()
      s.load()
      for (let n = 1; n <= 16; n++) {
        s.rememberEnrollment(enr(n))
        s.rememberRoster(fp(n), `https://s${n}.example`, Array.from({ length: 64 }, (_, i) => pin(n * 100 + i, { enrolledBy: fp(7), revokedAt: i })), n)
      }
      expect(statSync(file).size).toBeLessThanOrEqual(512 * 1024)
      const again = store()
      again.load()
      expect(again.rosterOf(fp(16), 'https://s16.example')?.pins).toHaveLength(64)
      expect(again.rosterOf(fp(1), URL1)?.at).toBe(1)
    })
  })

  describe('v3 identity blob', () => {
    const tamper = (mutate: (blob: string[]) => void): void => {
      store().load()
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      const c = cipher()
      const blob = JSON.parse(c.decrypt(Buffer.from(saved.identity, 'base64')).toString('utf8'))
      mutate(blob)
      saved.identity = c.encrypt(Buffer.from(JSON.stringify(blob))).toString('base64')
      // Re-sign so that only the blob check can reject it.
      const macKey = Buffer.from(blob[3] ?? '', 'base64')
      saved.mac = createHmac('sha256', macKey)
        .update(JSON.stringify(['shellherd-remote-identity-v3', saved.identity, [], []]))
        .digest('hex')
      writeFileSync(file, JSON.stringify(saved))
    }

    it('rejects a wrong PKCS8 prefix', () => {
      tamper(blob => {
        const der = Buffer.from(blob[2], 'base64')
        der[2] ^= 1
        blob[2] = b64(der)
      })
      expect(() => store().load()).toThrow('identity')
    })

    it('rejects swapped key types', () => {
      tamper(blob => {
        ;[blob[1], blob[2]] = [blob[2], blob[1]]
      })
      expect(() => store().load()).toThrow('identity')
    })

    it('rejects a wrong tag', () => {
      tamper(blob => {
        blob[0] = 'other'
      })
      expect(() => store().load()).toThrow('identity')
    })

    it('rejects a short macKey', () => {
      tamper(blob => {
        blob[3] = b64(Buffer.alloc(31, 1))
      })
      expect(() => store().load()).toThrow('identity')
    })
  })

  describe('migration', () => {
    const PIN = { fingerprint: fp(1), name: 'Old', firstSeen: 5, lastSeen: 6 }
    const writeV1 = (): { id: string; x: Buffer } => {
      const { privateKey } = generateKeyPairSync('x25519')
      const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer
      const pub = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
      writeFileSync(file, JSON.stringify({ version: 1, identity: cipher().encrypt(pkcs8).toString('base64'), knownDevices: [PIN] }))
      return { id: createHash('sha256').update(pub).digest('hex'), x: pkcs8 }
    }
    const writeV2 = (verified: boolean): { id: string; x: Buffer; macKey: Buffer } => {
      const { privateKey } = generateKeyPairSync('x25519')
      const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer
      const pub = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
      const macKey = Buffer.alloc(32, 7)
      const identity = cipher().encrypt(Buffer.concat([pkcs8, macKey])).toString('base64')
      const devices = [{ ...PIN, verified, ...(verified ? { verifiedAt: 9 } : {}) }]
      const mac = createHmac('sha256', macKey)
        .update(JSON.stringify(['shellherd-remote-identity-v2', identity, devices.map(d => [d.fingerprint, d.name, d.firstSeen, d.lastSeen, d.verified, d.verifiedAt ?? null])]))
        .digest('hex')
      writeFileSync(file, JSON.stringify({ version: 2, identity, knownDevices: devices, mac }))
      return { id: createHash('sha256').update(pub).digest('hex'), x: pkcs8, macKey }
    }
    const decodeBlob = (): string[] => {
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      return JSON.parse(cipher().decrypt(Buffer.from(saved.identity, 'base64')).toString('utf8'))
    }

    it('v2 -> v4 keeps X25519, macKey, fingerprint and verified pins with one write', () => {
      const { id, x, macKey } = writeV2(true)
      const s = store()
      expect(s.load().identity.id).toBe(id)
      expect(s.known(fp(1))).toEqual({ firstSeen: 5, verified: true, verifiedAt: 9 })
      expect(readdirSync(dir)).toEqual(['remote-identity.json'])
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      expect(saved.version).toBe(4)
      expect(saved.enrollments).toEqual([])
      const blob = decodeBlob()
      expect(blob[1]).toBe(b64(x))
      expect(blob[3]).toBe(b64(macKey))
      expect(Buffer.from(s.load().identity.signingPublicKey, 'base64')).toHaveLength(32)
      const again = store()
      expect(again.load().identity.id).toBe(id)
      expect(again.load().identity.signingPublicKey).toBe(s.load().identity.signingPublicKey)
      expect(again.known(fp(1))?.verified).toBe(true)
    })

    const writeV3 = (): { id: string } => {
      const s = store()
      const { identity } = s.load()
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      const macKey = Buffer.from(JSON.parse(cipher().decrypt(Buffer.from(saved.identity, 'base64')).toString('utf8'))[3], 'base64')
      const devices = [{ ...PIN, verified: true, verifiedAt: 9 }]
      const enrollments = [enr(1)]
      const mac = createHmac('sha256', macKey)
        .update(
          JSON.stringify([
            'shellherd-remote-identity-v3',
            saved.identity,
            devices.map(d => [d.fingerprint, d.name, d.firstSeen, d.lastSeen, d.verified, d.verifiedAt]),
            enrollments.map(e => [e.serverId, e.namespace, e.serverUrl, e.username, e.name, e.enrolledAt])
          ])
        )
        .digest('hex')
      writeFileSync(file, JSON.stringify({ version: 3, identity: saved.identity, knownDevices: devices, enrollments, mac }))
      return { id: identity.id }
    }

    it('v3 -> v4 verifies the v3 MAC, adds empty rosters with one write and keeps everything else', () => {
      const { id } = writeV3()
      const s = store()
      expect(s.load().identity.id).toBe(id)
      expect(readdirSync(dir)).toEqual(['remote-identity.json'])
      expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(4)
      expect(s.enrollment(fp(1), 'https://s1.example')).toEqual(enr(1))
      expect(s.rosterOf(fp(1), 'https://s1.example')).toEqual({ pins: [], at: null })
      expect(s.known(fp(1))?.verified).toBe(true)
      expect(store().load().identity.id).toBe(id)
    })

    it('rejects a v3 file with a bad MAC and keeps it', () => {
      writeV3()
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      saved.enrollments[0].serverUrl = 'https://evil.example'
      writeFileSync(file, JSON.stringify(saved))
      const before = readFileSync(file)
      expect(() => store().load()).toThrow('identity')
      expect(readFileSync(file).equals(before)).toBe(true)
    })

    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('v3 -> v4 still loads when the rewrite fails (best effort)', () => {
      const { id } = writeV3()
      chmodSync(dir, 0o500)
      try {
        expect(store().load().identity.id).toBe(id)
      } finally {
        chmodSync(dir, 0o700)
      }
    })

    it('rejects a v2 file with a bad MAC', () => {
      writeV2(false)
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      saved.knownDevices[0].verified = true
      writeFileSync(file, JSON.stringify(saved))
      const before = readFileSync(file)
      expect(() => store().load()).toThrow('identity')
      expect(readFileSync(file).equals(before)).toBe(true)
    })

    it('v1 -> v4 makes pins unverified with the same fingerprint', () => {
      const { id } = writeV1()
      const s = store()
      expect(s.load().identity.id).toBe(id)
      expect(s.known(fp(1))).toEqual({ firstSeen: 5, verified: false })
      expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(4)
      const again = store()
      expect(again.load().identity.id).toBe(id)
    })

    it('rejects a v1 file holding a v2 blob', () => {
      const v2 = writeV2(false)
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      writeFileSync(file, JSON.stringify({ version: 1, identity: saved.identity, knownDevices: [] }))
      const before = readFileSync(file)
      expect(v2.id).toBeTruthy()
      expect(() => store().load()).toThrow('identity')
      expect(readFileSync(file).equals(before)).toBe(true)
    })

    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
      'throws identity when the v2 migration write fails, keeps the file and migrates on the next start',
      () => {
        const { id } = writeV2(true)
        const before = readFileSync(file)
        chmodSync(dir, 0o500)
        try {
          expect(() => store().load()).toThrow('identity')
          expect(readFileSync(file).equals(before)).toBe(true)
        } finally {
          chmodSync(dir, 0o700)
        }
        const s = store()
        expect(s.load().identity.id).toBe(id)
        expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(4)
      }
    )

    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('throws identity when the v1 migration write fails', () => {
      writeV1()
      const before = readFileSync(file)
      chmodSync(dir, 0o500)
      try {
        expect(() => store().load()).toThrow('identity')
        expect(readFileSync(file).equals(before)).toBe(true)
      } finally {
        chmodSync(dir, 0o700)
      }
    })
  })
})
