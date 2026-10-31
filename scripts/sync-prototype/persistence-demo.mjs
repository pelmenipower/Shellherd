import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Authority, Client, device } from './protocol.mjs';
import { LocalState } from './local-state.mjs';

// Public fixture passphrase in source, never a real secret in process arguments.
const password = 'public fixture passphrase for the persistence demonstration';
const directory = await mkdtemp(join(tmpdir(), 'shellherd-state-demo-'));
const file = join(directory, 'local.enc');
const authority = new Authority('persist-demo'); const alice = device('alice'); const bob = device('bob');
let local; let restored;
try {
  const membership = authority.setMembers([alice, bob]);
  const a = new Client(alice, authority.publicKey, 'persist-demo'); a.useMembership(membership);
  const b = new Client(bob, authority.publicKey, 'persist-demo'); b.useMembership(membership);
  const base = a.snapshot({ api: { password: 'DEMO_PRIVATE_INITIAL' } }); const root = b.receive(base);
  local = await LocalState.create(file, password, { client: a, authority });
  const left = a.snapshot({ api: { password: 'DEMO_PRIVATE_LEFT' } });
  const right = b.snapshot({ api: { password: 'DEMO_PRIVATE_RIGHT' } });
  const l = b.receive(left); const r = a.receive(right);
  const conflict = a.stageMerge(root, l, r);
  await local.save(); const heads = a.heads; const publicKey = authority.publicKey;
  local.lock();
  restored = await LocalState.unlock(file, password, { context: 'persist-demo', rootKey: publicKey });
  if (JSON.stringify(restored.client.heads) !== JSON.stringify(heads)) throw Error('Lost heads');
  if (restored.client.stagedMerges()[0]?.mergeId !== conflict.mergeId) throw Error('Lost conflict');
  const disk = await readFile(file, 'utf8');
  if (disk.includes('DEMO_PRIVATE') || disk.includes(password)) throw Error('Plaintext leak');
  console.log('PASS: Geräte- und Verwaltungsschlüssel aus verschlüsseltem Checkpoint wiederhergestellt.');
  console.log('PASS: Offline-Versionen, Upload-Warteschlange und beide Konfliktvarianten bleiben erhalten.');
  console.log('Nur Testdaten; temporäres Verzeichnis wird entfernt.');
} finally {
  local?.lock(); restored?.lock(); alice.destroy(); bob.destroy(); authority.destroy();
  await rm(directory, { recursive: true, force: true });
}
