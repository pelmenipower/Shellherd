import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import type { ErrorCode } from '../../shared/errors';
import { hostLabel } from '../../shared/known-hosts';
import type { KnownHostView, KnownHostsImportResult } from '../../shared/known-hosts';
import { hashedNameMatches, keyType } from './known-hosts-parse';
import type { ParsedKnownHosts } from './known-hosts-parse';

/** Imported and revoked entries are capped so the store stays well below the 1 MiB read limit. */
export const MAX_STORED_IMPORTED = 1000;
export const MAX_STORED_REVOKED = 200;
const FINGERPRINT = z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/);
const KEY_TYPE = z.string().regex(/^[a-z0-9][a-z0-9.@-]{0,63}$/);
const BASE64_20 = z.string().regex(/^[A-Za-z0-9+/]{27}=$/);
const PlainSchema = z.object({ name: z.string().min(1).max(253), port: z.number().int().min(1).max(65535), type: KEY_TYPE, fingerprint: FINGERPRINT }).strict();
const HashedSchema = z.object({ salt: BASE64_20, hash: BASE64_20, type: KEY_TYPE, fingerprint: FINGERPRINT }).strict();
const KnownHostsSchema = z.object({
  version: z.literal(1),
  hosts: z.record(z.string(), FINGERPRINT),
  // Both optional: files of 0.23.0 and earlier have neither; older versions drop them on their next write.
  imported: z.array(z.union([PlainSchema, HashedSchema])).max(MAX_STORED_IMPORTED).optional(),
  revoked: z.array(z.object({ type: KEY_TYPE, fingerprint: FINGERPRINT }).strict()).max(MAX_STORED_REVOKED).optional(),
});
type Stored = z.infer<typeof KnownHostsSchema>;
type Imported = NonNullable<Stored['imported']>[number];

export interface HostKeyPrompt { host: string; port: number; fingerprint: string }

export function hostFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

// Ids are stable hashes of the stored data, so the renderer can name an entry without seeing its key material.
const entryId = (parts: unknown[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
const confirmedId = (address: string): string => entryId(['confirmed', address]);
const revokedId = (fingerprint: string): string => entryId(['revoked', fingerprint]);
const importedId = (entry: Imported): string =>
  entryId('name' in entry ? ['imported', entry.name, entry.port, entry.fingerprint] : ['imported', entry.salt, entry.hash, entry.fingerprint]);

/** `["host",port]` key of `hosts`, or null if it is not one. */
function addressOf(address: string): { host: string; port: number } | null {
  try {
    const [host, port] = JSON.parse(address) as unknown[];
    return typeof host === 'string' && typeof port === 'number' ? { host, port } : null;
  } catch { return null; }
}

export class HostKeyError extends AppError {
  constructor(code: ErrorCode, readonly kind: 'changed' | 'store' = 'store',
    readonly fingerprints?: { expected: string; received: string }) { super(code); }
}

export class KnownHosts {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string,
    private readonly confirm: (prompt: HostKeyPrompt) => Promise<boolean>) {}

  private async read(): Promise<Stored> {
    try {
      const text = await readFile(this.filePath, 'utf8');
      if (text.length > 1_048_576) throw new Error();
      return KnownHostsSchema.parse(JSON.parse(text));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, hosts: {} };
      throw new HostKeyError('ssh.hostKeysUnreadable');
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    // Keep the queue usable even when one task fails.
    this.queue = result.then(() => {}, () => {});
    return result;
  }

  verify(host: string, port: number, key: Buffer, isActive: () => boolean): Promise<boolean> {
    return this.enqueue(() => this.verifyNext(host, port, key, isActive));
  }

  /** Atomic replace; always writes the whole store so imported and revoked entries survive. */
  private async write(next: Stored): Promise<void> {
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.filePath);
    } finally { await rm(temporary, { force: true }); }
  }

  private async verifyNext(host: string, port: number, key: Buffer, isActive: () => boolean): Promise<boolean> {
    const fingerprint = hostFingerprint(key);
    const name = host.toLowerCase();
    const address = JSON.stringify([name, port]);
    let stored = await this.read();
    if (!isActive()) return false;
    if (stored.revoked?.some(entry => entry.fingerprint === fingerprint)) throw new HostKeyError('ssh.hostKeyRevoked');
    const previous = stored.hosts[address];
    if (previous) {
      if (previous !== fingerprint) throw new HostKeyError('ssh.hostKeyChanged', 'changed', { expected: previous, received: fingerprint });
      return true;
    }
    // Imported keys count only for servers Shellherd has not confirmed itself.
    const matches = (stored.imported ?? []).filter(entry => 'name' in entry
      ? entry.name === name && entry.port === port
      : hashedNameMatches(entry.salt, entry.hash, name, port));
    if (matches.some(entry => entry.fingerprint === fingerprint)) return true;
    const sameType = matches.find(entry => entry.type === keyType(key));
    if (sameType) throw new HostKeyError('ssh.hostKeyChanged', 'changed', { expected: sameType.fingerprint, received: fingerprint });
    if (!await this.confirm({ host, port, fingerprint }) || !isActive()) return false;
    // Re-read after the dialog so a concurrent change cannot be overwritten.
    stored = await this.read();
    if (stored.hosts[address] && stored.hosts[address] !== fingerprint) {
      throw new HostKeyError('ssh.hostKeyChangedMeanwhile', 'changed', { expected: stored.hosts[address], received: fingerprint });
    }
    try {
      await this.write({ ...stored, hosts: { ...stored.hosts, [address]: fingerprint } });
    } catch {
      throw new HostKeyError('ssh.hostKeySaveFailed');
    }
    return isActive();
  }

  /** Confirmed, imported and revoked entries, in store order. Not queued: it reads the file atomically (V-R2). */
  async list(): Promise<KnownHostView[]> {
    const stored = await this.read();
    const views: KnownHostView[] = [];
    for (const [address, fingerprint] of Object.entries(stored.hosts)) {
      const parsed = addressOf(address);
      if (parsed) views.push({ id: confirmedId(address), host: parsed.host, port: parsed.port, type: null, fingerprint, origin: 'confirmed' });
    }
    for (const entry of stored.imported ?? []) {
      views.push({ id: importedId(entry), host: 'name' in entry ? entry.name : null, port: 'name' in entry ? entry.port : null,
        type: entry.type, fingerprint: entry.fingerprint, origin: 'imported' });
    }
    for (const entry of stored.revoked ?? []) {
      views.push({ id: revokedId(entry.fingerprint), host: null, port: null, type: entry.type, fingerprint: entry.fingerprint, origin: 'revoked' });
    }
    return views;
  }

  /** Removes one entry by id; unknown id → core.invalidRequest. The next connection asks again. */
  remove(id: string): Promise<KnownHostView[]> {
    return this.enqueue(async () => {
      const stored = await this.read();
      const hosts = Object.fromEntries(Object.entries(stored.hosts).filter(([address]) => confirmedId(address) !== id));
      const imported = (stored.imported ?? []).filter(entry => importedId(entry) !== id);
      const revoked = (stored.revoked ?? []).filter(entry => revokedId(entry.fingerprint) !== id);
      const removed = Object.keys(stored.hosts).length - Object.keys(hosts).length
        + (stored.imported ?? []).length - imported.length + (stored.revoked ?? []).length - revoked.length;
      if (removed === 0) throw new AppError('core.invalidRequest');
      await this.save({ ...stored, hosts, imported, revoked });
      return this.list();
    });
  }

  private async save(next: Stored): Promise<void> {
    try { await this.write(next); } catch { throw new AppError('ssh.hostKeysSaveFailed'); }
  }

  /** Adds parsed keys; never replaces or removes anything. Confirmed hosts keep their key (R3.5). */
  importKeys(parsed: ParsedKnownHosts): Promise<{ result: KnownHostsImportResult; hosts: KnownHostView[] }> {
    return this.enqueue(async () => {
      const stored = await this.read();
      const imported = [...(stored.imported ?? [])];
      const revoked = [...(stored.revoked ?? [])];
      const result: KnownHostsImportResult = { added: 0, known: 0, revoked: 0, skipped: parsed.skipped, conflicts: [] };
      const revokedPrints = new Set([...revoked.map(entry => entry.fingerprint),
        ...parsed.keys.flatMap(key => key.kind === 'revoked' ? [key.fingerprint] : [])]);
      const importedIds = new Set(imported.map(importedId));
      // Confirmed address -> fingerprints the file lists for it.
      const filePrints = new Map<string, Set<string>>();
      for (const key of parsed.keys) {
        if (key.kind === 'revoked') {
          if (revoked.some(entry => entry.fingerprint === key.fingerprint)) result.known += 1;
          else if (revoked.length >= MAX_STORED_REVOKED) result.skipped += 1;
          else { revoked.push({ type: key.type, fingerprint: key.fingerprint }); result.revoked += 1; }
          continue;
        }
        if (revokedPrints.has(key.fingerprint)) { result.skipped += 1; continue; }
        if (key.kind === 'plain') {
          const address = JSON.stringify([key.name, key.port]);
          if (stored.hosts[address]) {
            filePrints.set(address, (filePrints.get(address) ?? new Set<string>()).add(key.fingerprint));
            result.known += 1;
            continue;
          }
        }
        const entry: Imported = key.kind === 'plain'
          ? { name: key.name, port: key.port, type: key.type, fingerprint: key.fingerprint }
          : { salt: key.salt, hash: key.hash, type: key.type, fingerprint: key.fingerprint };
        const id = importedId(entry);
        if (importedIds.has(id)) { result.known += 1; continue; }
        if (imported.length >= MAX_STORED_IMPORTED) { result.skipped += 1; continue; }
        imported.push(entry);
        importedIds.add(id);
        result.added += 1;
      }
      for (const [address, prints] of filePrints) {
        const parsedAddress = addressOf(address);
        if (parsedAddress && !prints.has(stored.hosts[address]!) && result.conflicts.length < 20) {
          result.conflicts.push(hostLabel(parsedAddress.host, parsedAddress.port));
        }
      }
      if (result.added > 0 || result.revoked > 0) await this.save({ ...stored, imported, revoked });
      return { result, hosts: await this.list() };
    });
  }
}
