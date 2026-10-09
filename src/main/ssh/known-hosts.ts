import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

const KnownHostsSchema = z.object({
  version: z.literal(1),
  hosts: z.record(z.string(), z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/)),
});

export interface HostKeyPrompt { host: string; port: number; fingerprint: string }

export function hostFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

export class HostKeyError extends Error {}

export class KnownHosts {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string,
    private readonly confirm: (prompt: HostKeyPrompt) => Promise<boolean>) {}

  private async read(): Promise<z.infer<typeof KnownHostsSchema>> {
    try {
      const text = await readFile(this.filePath, 'utf8');
      if (text.length > 1_048_576) throw new Error();
      return KnownHostsSchema.parse(JSON.parse(text));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, hosts: {} };
      throw new HostKeyError('Die gespeicherten Server-Schlüssel konnten nicht gelesen werden.');
    }
  }

  verify(host: string, port: number, key: Buffer, isActive: () => boolean): Promise<boolean> {
    const result = this.queue.then(() => this.verifyNext(host, port, key, isActive));
    // Keep the queue usable even when one server is rejected or a write fails.
    this.queue = result.then(() => {}, () => {});
    return result;
  }

  private async verifyNext(host: string, port: number, key: Buffer, isActive: () => boolean): Promise<boolean> {
    const fingerprint = hostFingerprint(key);
    const address = JSON.stringify([host.toLowerCase(), port]);
    let stored = await this.read();
    if (!isActive()) return false;
    const previous = stored.hosts[address];
    if (previous) {
      if (previous !== fingerprint) throw new HostKeyError(
        'Der Server-Schlüssel hat sich geändert. Verbindung abgebrochen. Bitte kläre die Änderung mit dem Server-Administrator.');
      return true;
    }
    if (!await this.confirm({ host, port, fingerprint }) || !isActive()) return false;
    // Re-read after the dialog so a concurrent change cannot be overwritten.
    stored = await this.read();
    if (stored.hosts[address] && stored.hosts[address] !== fingerprint) {
      throw new HostKeyError('Der gespeicherte Server-Schlüssel wurde zwischenzeitlich geändert.');
    }
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(temporary, JSON.stringify({ version: 1, hosts: { ...stored.hosts, [address]: fingerprint } }),
        { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.filePath);
    } catch {
      throw new HostKeyError('Der Server-Schlüssel konnte nicht gespeichert werden. Verbindung abgebrochen.');
    } finally { await rm(temporary, { force: true }); }
    return isActive();
  }
}
