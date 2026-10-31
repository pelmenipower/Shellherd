// Public test credentials only. For real setup use account-init.mjs.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAccount } from './account-auth.mjs';
import { createSyncServer } from './server.mjs';
const directory = await mkdtemp(join(tmpdir(), 'shellherd-account-demo-')); let service;
try {
  service = await createSyncServer({ directory, serverId: randomBytes(32).toString('hex'), namespace: 'demo', account: await createAccount('demo', 'ONLY_TEST_SERVER_PASSWORD') });
  console.log(`Temporärer Testserver: ${await service.listen(8787)}`);
  console.log('Öffentliche Testzugangsdaten: demo / ONLY_TEST_SERVER_PASSWORD. Keine echten Vaults verwenden.');
  await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
} finally { await service?.close(); await rm(directory, { recursive: true, force: true }); }
