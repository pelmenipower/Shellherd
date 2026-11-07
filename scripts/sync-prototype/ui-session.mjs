// Fixture-only backend for the gated development dialog. Never reads user Vaults/files.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Pairing, PairingInvitations } from './pairing.mjs';
import { Authority, Client, OpaqueStore, device } from './protocol.mjs';

export function createPairingLab({ baseVault, splitVaultForSync, mergePortableVaults, resolveVaultConfigurationConflicts,
  clock = () => performance.now() }) {
  const sessionId = randomUUID(); const start = clock();
  const authority = new Authority('ui-lab'); const left = device('lab-left'); const right = device('lab-right');
  const invitations = new PairingInvitations('ui-lab', authority.publicKey, clock);
  const invitation = invitations.create();
  const a = new Pairing({ identity: left, initiator: true, context: 'ui-lab', invitation, authorityKey: authority.publicKey, clock });
  const b = new Pairing({ identity: right, initiator: false, context: 'ui-lab', invitation, clock });
  const store = new OpaqueStore(); let ca; let cb; let versions; let result;
  const confirmations = {};
  let state = { phase: 'compare', sessionId, expiresAt: Date.now() + 300_000 };
  let destroyed = false;
  let disposed = false; let expiryTimer;
  function destroy() {
    if (destroyed) return; destroyed = true;
    clearTimeout(expiryTimer);
    a.close(); b.close(); ca?.destroy(); cb?.destroy(); left.destroy(); right.destroy(); authority.destroy();
  }
  try {
    b.receiveHandshake(a.sendHandshake()); a.receiveHandshake(b.sendHandshake()); b.receiveHandshake(a.sendHandshake());
    const ac = a.sendIdentity(); const bc = b.sendIdentity(); a.receiveIdentity(bc); b.receiveIdentity(ac);
    state.peers = [{ role: 'left', fingerprint: a.fingerprint(), confirmed: false }, { role: 'right', fingerprint: b.fingerprint(), confirmed: false }];
  } catch (error) { destroy(); throw error; }
  expiryTimer = setTimeout(() => { if (!destroyed) { destroy(); state = { phase: 'expired', sessionId }; } }, 300_000);
  expiryTimer.unref?.();
  const publish = (client, wire) => store.put(client.finishPublication(wire, authority.authorize(wire, client.beginPublication(wire))));
  function seedConflict() {
    const ac = confirmations.left; const bc = confirmations.right;
    a.receiveConfirmation(bc); b.receiveConfirmation(ac);
    const enrolled = invitations.consume(a);
    const membership = authority.setMembers([left, { public: enrolled }]);
    const received = b.receive(a.send(membership));
    ca = new Client(left, authority.publicKey, 'ui-lab'); ca.useMembership(membership);
    cb = new Client(right, b.peer().authorityKey, 'ui-lab'); cb.useMembership(received);
    const base = structuredClone(baseVault);
    const api = base.nodes[0].children[0]; api.authentication = { method: 'password', password: 'LAB_BASE_SECRET' };
    base.nodes[0].children.push({ ...structuredClone(api), id: 'lab-db', name: 'Database', host: 'db.fixture.invalid' });
    const root = publish(ca, ca.snapshot(splitVaultForSync(base).portable)); cb.receive(store.get(root));
    const l = structuredClone(base); const r = structuredClone(base);
    l.nodes[0].children[0].host = 'left.fixture.invalid'; l.nodes[0].children[0].authentication.password = 'LAB_LEFT_SECRET';
    r.nodes[0].children[0].host = 'right.fixture.invalid'; r.nodes[0].children[0].authentication.password = 'LAB_RIGHT_SECRET';
    l.nodes[0].children[1].port = 2222; r.nodes[0].children[1].comment = 'Independent remote note';
    const lh = publish(ca, ca.snapshot(splitVaultForSync(l).portable)); const rh = publish(cb, cb.snapshot(splitVaultForSync(r).portable));
    ca.receive(store.get(rh)); cb.receive(store.get(lh));
    versions = [root, lh, rh]; result = mergePortableVaults(...versions.map(h => ca.value(h)));
    if (result.conflicts.length !== 1 || result.conflicts[0].field !== 'configuration-or-move') throw Error('Unexpected lab conflict');
    state = { phase: 'conflict', sessionId, revision: randomUUID(), expiresAt: state.expiresAt,
      conflicts: [{ id: api.id, name: 'Development API', leftHost: 'left.fixture.invalid', rightHost: 'right.fixture.invalid' }] };
  }
  function view() { return structuredClone(state); }
  return {
    close() { destroy(); disposed = true; state = { phase: 'idle' }; },
    action(request) {
      if (disposed) return { ok: false, code: 'stale' };
      if (state.phase !== 'resolved' && state.phase !== 'failed' && (clock() - start < 0 || clock() - start >= 300_000)) {
        destroy(); state = { phase: 'expired', sessionId };
      }
      if (request.kind === 'status') return { ok: true, state: view() };
      if (request.sessionId !== sessionId) return { ok: false, code: 'stale' };
      if (state.phase === 'expired') return { ok: false, code: 'expired', state: view() };
      try {
        if (request.kind === 'confirm') {
          if (state.phase !== 'compare' || request.compared !== true || !['left', 'right'].includes(request.role)
            || state.peers.find(p => p.role === request.role)?.confirmed) return { ok: false, code: 'invalid' };
          const peer = request.role === 'left' ? a : b;
          const fingerprint = request.fingerprint.replace(/\s+/g, '').toLowerCase();
          if (fingerprint !== peer.fingerprint()) {
            destroy(); state = { phase: 'failed', sessionId }; return { ok: false, code: 'mismatch', state: view() };
          }
          confirmations[request.role] = peer.confirm(fingerprint);
          state.peers.find(p => p.role === request.role).confirmed = true;
          if (state.peers.every(p => p.confirmed)) seedConflict();
        } else if (request.kind === 'resolve') {
          if (state.phase !== 'conflict' || request.revision !== state.revision) return { ok: false, code: 'stale' };
          if (request.reviewed !== true) return { ok: false, code: 'invalid' };
          if (!Array.isArray(request.choices) || request.choices.length !== state.conflicts.length
            || new Set(request.choices.map(c => c.id)).size !== request.choices.length
            || !request.choices.every(c => state.conflicts.some(v => v.id === c.id) && ['left', 'right'].includes(c.side))) return { ok: false, code: 'invalid' };
          const merged = resolveVaultConfigurationConflicts(...versions.map(h => ca.value(h)), request.choices);
          const wire = ca.snapshot(merged, versions.slice(1)); const head = publish(ca, wire); cb.receive(store.get(head));
          const db = cb.value(head).document.nodes[0].children.find(n => n.id === 'lab-db');
          if (db.port !== 2222 || db.comment !== 'Independent remote note') throw Error('Lost independent changes');
          state = { phase: 'resolved', sessionId, preservedIndependentChanges: 2 }; destroy();
        } else return { ok: false, code: 'invalid' };
        return { ok: true, state: view() };
      } catch {
        destroy(); state = { phase: 'failed', sessionId }; return { ok: false, code: 'failed', state: view() };
      }
    },
  };
}
