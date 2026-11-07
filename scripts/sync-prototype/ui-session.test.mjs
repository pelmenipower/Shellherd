import { describe, expect, it, vi } from 'vitest';
import { exampleVault } from '../../src/shared/vault/example.ts';
import { mergePortableVaults, resolveVaultConfigurationConflicts, splitVaultForSync } from '../../src/main/sync-prototype/vault-merge.ts';
import { createPairingLab } from './ui-session.mjs';

const options = { baseVault: exampleVault, mergePortableVaults, resolveVaultConfigurationConflicts, splitVaultForSync };
const status = lab => lab.action({ kind: 'status' }).state;
function verify(lab) {
  const current = status(lab);
  for (const peer of current.peers) {
    const reply = lab.action({ kind: 'confirm', sessionId: current.sessionId, role: peer.role, fingerprint: peer.fingerprint, compared: true });
    expect(reply.ok).toBe(true);
    expect(JSON.stringify(reply)).not.toMatch(/LAB_.*SECRET|authentication|password/);
  }
  return status(lab);
}
describe('fixture UI backend uses real pairing and masked Vault conflicts', () => {
  it('requires both confirmations, masks all replies and resolves either choice without losing other changes', () => {
    for (const side of ['left', 'right']) {
      const lab = createPairingLab(options);
      try {
        const state = status(lab);
        expect(state.phase).toBe('compare'); expect(state.peers[0].fingerprint).toBe(state.peers[1].fingerprint);
        expect(lab.action({ kind: 'resolve', sessionId: state.sessionId, revision: 'x', reviewed: true, choices: [] }).ok).toBe(false);
        const conflict = verify(lab); expect(conflict.phase).toBe('conflict');
        expect(lab.action({ kind: 'resolve', sessionId: conflict.sessionId, revision: 'obsolete', reviewed: true, choices: [] }).code).toBe('stale');
        expect(lab.action({ kind: 'resolve', sessionId: conflict.sessionId, revision: conflict.revision, reviewed: true, choices: [] }).code).toBe('invalid');
        expect(status(lab).phase).toBe('conflict');
        const request = { kind: 'resolve', sessionId: conflict.sessionId, revision: conflict.revision, reviewed: true, choices: [{ id: conflict.conflicts[0].id, side }] };
        const resolved = lab.action(request);
        expect(resolved.state).toMatchObject({ phase: 'resolved', preservedIndependentChanges: 2 });
        expect(JSON.stringify(resolved)).not.toMatch(/SECRET|password|authentication/);
        expect(lab.action(request).code).toBe('stale');
      } finally { lab.close(); }
    }
  });
  it('terminates on mismatched fingerprints, expires idle attempts and invalidates closed sessions', () => {
    const lab = createPairingLab(options); const state = status(lab);
    expect(lab.action({ kind: 'confirm', sessionId: state.sessionId, role: 'left', fingerprint: '0'.repeat(64), compared: true }).code).toBe('mismatch');
    expect(status(lab).phase).toBe('failed'); lab.close();
    expect(lab.action({ kind: 'status' }).code).toBe('stale');
    let now = 0; const expired = createPairingLab({ ...options, clock: () => now });
    now = 300_000; expect(status(expired).phase).toBe('expired'); expired.close();
  });
  it('discards an idle attempt on the main-process timer without any renderer polling', () => {
    vi.useFakeTimers(); let lab;
    try {
      lab = createPairingLab({ ...options, clock: () => 0 });
      vi.advanceTimersByTime(300_000);
      expect(status(lab).phase).toBe('expired');
    } finally { lab?.close(); vi.useRealTimers(); }
  });
});
