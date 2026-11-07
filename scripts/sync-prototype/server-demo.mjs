// Two independent clients, one persistent central server. Test credentials only.
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Authority, Client, device } from './protocol.mjs';
import { createSyncServer } from './server.mjs';
import { probeSyncServer, RemoteStore } from './http-transport.mjs';
import { DeviceAccess, ServerAdmin } from './client-access.mjs';
const directory = await mkdtemp(join(tmpdir(), 'shellherd-central-demo-'));
const alice = device('demo-a'); const bob = device('demo-b'); const authority = new Authority('demo-vault');
const operatorIdentity = device('demo-operator'); const serverAdmin = new ServerAdmin();
let service;
try {
  const membership = authority.setMembers([alice, bob]);
  const a = new Client(alice, authority.publicKey, 'demo-vault'); a.useMembership(membership);
  const b = new Client(bob, authority.publicKey, 'demo-vault'); b.useMembership(membership);
  const bootstrap = [alice, bob, operatorIdentity];
  service = await createSyncServer({ directory, serverId: randomBytes(32).toString('hex'), namespace: 'demo-vault', devices: bootstrap.map(d => ({ id: d.id, signingKey: d.public[1] })), adminPublicKey: serverAdmin.publicKey, adminDevices: [operatorIdentity.id] });
  const serve = process.argv.includes('--serve'); const url = await service.listen(serve ? 8787 : 0);
  const info = await probeSyncServer(url, { allowLoopbackHttp: true });
  serverAdmin.bootstrap(info, bootstrap.map(d => [d.id, d.public[1], null]));
  const remoteA = new RemoteStore(info, alice); const remoteB = new RemoteStore(info, bob);
  const root = await remoteA.put(a.snapshot({ api: { password: 'ONLY_TEST_SECRET_A' } }));
  a.destroy(); authority.destroy();
  b.receive(await remoteB.get(root));
  await remoteB.put(b.snapshot({ api: { password: 'ONLY_TEST_SECRET_B' } }));
  if ((await remoteB.list()).length !== 2) throw Error('Missing central versions');
  for (const file of await readdir(directory)) if ((await readFile(join(directory, file), 'utf8')).includes('ONLY_TEST_SECRET')) throw Error('Plaintext leak');
  console.log('PASS: Gerät A lädt verschlüsselt hoch und geht offline. Gerät B lädt vom Server und synchronisiert eigene Änderungen.');
  console.log('PASS: Kein anderer PC und kein Verwaltungsgerät muss dafür online bleiben. Der Server speichert keine Klartext-Nutzdaten.');
  if (serve) {
    console.log(`Temporärer Entwicklungsserver für die Server-URL-Prüfung: ${url}`);
    console.log('Nur Testdaten. Beenden mit Strg+C; danach werden die temporären Dateien entfernt.');
    console.log('Anfragen: list | Freigabe: approve ANFRAGE_ID PRUEFFINGERPRINT | Entzug: revoke GERAETE_ID | Ende: quit');
    const operator = new DeviceAccess(info, operatorIdentity);
    const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    const close = () => terminal.close(); terminal.on('SIGINT', close); process.once('SIGTERM', close);
    try {
      for await (const line of terminal) {
        const [command, target, fingerprint, ...extra] = line.trim().split(/\s+/);
        if (command === 'quit') break;
        try {
          if (command === 'list' && !target) {
            for (const item of await operator.pending()) console.log(`${item.requestId} ${item.device[0]} ${item.fingerprint}`);
          } else if (command === 'approve' && target && fingerprint) {
            const compared = [fingerprint, ...extra].join('').toLowerCase(); if (!/^[a-f0-9]{64}$/.test(compared)) throw Error('Invalid fingerprint');
            const item = (await operator.pending()).find(p => p.requestId === target); if (!item) throw Error('Missing request');
            const accepted = await operator.apply(serverAdmin.approve(info, await operator.accessStatus(), item, compared)); serverAdmin.acceptStatus(info, accepted);
            console.log('Serverzugriff freigegeben. E2EE-Vault-Freigabe bleibt ein separater Schritt.');
          } else if (command === 'revoke' && target && !fingerprint) {
            const accepted = await operator.apply(serverAdmin.revoke(info, await operator.accessStatus(), target)); serverAdmin.acceptStatus(info, accepted);
            console.log('Serverzugriff entzogen. Bereits empfangene Daten bleiben beim Empfänger.');
          } else console.log('Befehle: list | approve ANFRAGE_ID PRUEFFINGERPRINT | revoke GERAETE_ID | quit');
        } catch { console.log('Befehl abgelehnt. Anfrage, vollständigen Fingerprint und aktuellen Freigabestand prüfen.'); }
      }
    } finally { terminal.close(); process.removeListener('SIGTERM', close); }
  }
} finally { await service?.close(); alice.destroy(); bob.destroy(); authority.destroy(); operatorIdentity.destroy(); serverAdmin.destroy(); await rm(directory, { recursive: true, force: true }); }
