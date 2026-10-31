// Gated UI experiment only. This transient identity never imports a real Vault.
import { randomBytes } from 'node:crypto';
import { device } from './protocol.mjs';
import { DeviceAccess } from './client-access.mjs';
export function createDeviceEnrollment(info) {
  const identity = device(randomBytes(16).toString('hex')); const controller = new AbortController();
  const remote = new DeviceAccess(info, identity, { signal: controller.signal });
  let closed = false; let current;
  return {
    async begin() {
      if (closed || current) throw Error('Enrollment unavailable');
      const item = await remote.enroll(); if (closed) throw Error('Enrollment closed');
      current = { status: 'pending', requestId: item.requestId, fingerprint: item.fingerprint, deviceId: identity.id, expiresAt: item.expiresAt };
      return structuredClone(current);
    },
    async refresh() {
      if (closed || !current) throw Error('Enrollment unavailable');
      try {
        const reply = await remote.enrollmentStatus(current.requestId); if (closed) throw Error('Enrollment closed');
        if (reply.requestId !== current.requestId || !['pending', 'authorized'].includes(reply.status)) throw Error('Invalid enrollment status');
        current.status = reply.status; return structuredClone(current);
      } catch (error) {
        if (!closed && [401, 404].includes(error.status)) { current.status = 'expired'; return structuredClone(current); }
        throw error;
      }
    },
    close() { closed = true; controller.abort(); identity.destroy(); },
  };
}
