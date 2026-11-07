import { Authority, Client, OpaqueStore, consolidate, device } from './protocol.mjs';
import { Pairing, PairingInvitations } from './pairing.mjs';

const authority = new Authority('demo-vault');
const alice = device('alice'); const bob = device('bob');
const invitations = new PairingInvitations('demo-vault', authority.publicKey);
const invitation = invitations.create();
const admin = new Pairing({ identity: alice, initiator: true, context: 'demo-vault', invitation, authorityKey: authority.publicKey });
const joiner = new Pairing({ identity: bob, initiator: false, context: 'demo-vault', invitation });
try {
  joiner.receiveHandshake(admin.sendHandshake());
  admin.receiveHandshake(joiner.sendHandshake());
  joiner.receiveHandshake(admin.sendHandshake());
  const adminClaim = admin.sendIdentity(); const joinerClaim = joiner.sendIdentity();
  admin.receiveIdentity(joinerClaim); joiner.receiveIdentity(adminClaim);
  // This demo simulates an independent human comparison. A real UI must perform it.
  const adminPrint = admin.fingerprint(); const joinerPrint = joiner.fingerprint();
  const adminConfirm = admin.confirm(joinerPrint); const joinerConfirm = joiner.confirm(adminPrint);
  admin.receiveConfirmation(joinerConfirm); joiner.receiveConfirmation(adminConfirm);
  const enrolled = invitations.consume(admin);
  const membership = authority.setMembers([alice, { public: enrolled }]);
  const joinedMembership = joiner.receive(admin.send(membership));
  const a = new Client(alice, authority.publicKey, 'demo-vault');
  const b = new Client(bob, joiner.peer().authorityKey, 'demo-vault');
  a.useMembership(membership); b.useMembership(joinedMembership);
  const store = new OpaqueStore();
  const publish = (client, wire) => store.put(client.finishPublication(wire, authority.authorize(wire, client.beginPublication(wire))));
  const base = { api: { password: 'FAKE_API_INITIAL' }, db: { password: 'FAKE_DB_INITIAL' } };
  const root = publish(a, a.snapshot(base)); b.receive(store.get(root));
  const left = structuredClone(base); left.api.password = 'FAKE_API_CHANGED';
  const right = structuredClone(base); right.db.password = 'FAKE_DB_CHANGED';
  const l = publish(a, a.snapshot(left)); const r = publish(b, b.snapshot(right));
  a.receive(store.get(r)); b.receive(store.get(l));
  const merged = consolidate(a.value(root), a.value(l), a.value(r));
  if (merged.conflicts.length) throw Error('Unexpected conflict');
  const final = publish(a, a.snapshot(merged.records)); b.receive(store.get(final));
  if (store.dump().includes('FAKE_')) throw Error('Plaintext exposed');
  if (b.value(final).api.password !== left.api.password || b.value(final).db.password !== right.db.password) throw Error('Merge failed');
  console.log('PASS: Noise-XX-Pairing, vollständiger Fingerprintvergleich simuliert, beidseitige Bestätigung.');
  console.log('PASS: Zwei Geräte, unabhängige Offline-Änderungen, gemeinsamer Merge.');
  console.log('PASS: Im simulierten Serverspeicher liegen ausschließlich verschlüsselte Nutzdaten.');
  console.log('Experiment mit Testdaten; kein Netzwerk, kein produktiver Vault, keine menschliche Pairing-Oberfläche.');
} finally { admin.close(); joiner.close(); alice.destroy(); bob.destroy(); authority.destroy(); }
