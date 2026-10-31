import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { assertSnapshotWire } from './protocol.mjs';

// Only opaque encrypted envelopes. Not a public server or an authorization layer.
export class FileStore {
  constructor(directory) { this.directory = directory; }
  async put(wire) {
    assertSnapshotWire(wire);
    const hash = createHash('blake2b512');
    // File IDs deliberately differ from protocol IDs: local integrity addresses only.
    const id = hash.update(wire).digest('hex');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    const target = join(this.directory, `${id}.json`);
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(wire, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, target);
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return id;
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async get(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{128}$/.test(id)) throw Error('Invalid file ID');
    const handle = await open(join(this.directory, `${id}.json`), 'r');
    let wire;
    try {
      if ((await handle.stat()).size > 1024 * 1024) throw Error('Object size');
      wire = await handle.readFile('utf8');
    } finally { await handle.close(); }
    if (createHash('blake2b512').update(wire).digest('hex') !== id) throw Error('File integrity');
    return wire;
  }
}
