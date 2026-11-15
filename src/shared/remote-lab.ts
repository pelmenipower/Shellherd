export type RemoteScope = 'view';
/** Pin of a device in the local identity file; verified only after a typed prefix check. */
export interface RemoteKnown { firstSeen: number; verified: boolean; verifiedAt?: number }
/** id is the device fingerprint: SHA-256 of the SPKI DER, 64 lowercase hex. changed: a verified device with the same name has another fingerprint. */
export interface RemoteDevice { id: string; name: string; known?: RemoteKnown; changed?: true }
export type RemoteEndReason = 'stopped' | 'remote' | 'expired' | 'locked' | 'declined' | 'failed' | 'scope' | 'mismatch';
export type RemoteErrorCode = 'unavailable' | 'invalid' | 'stale' | 'identity' | 'locked' | 'connection' | 'authentication' | 'expired'
  | 'declined' | 'mismatch' | 'signal' | 'media' | 'peer' | 'scope' | 'limit' | 'samePassword' | 'enrolledElsewhere' | 'enrollmentLocked';
/** Wire part inside the E2EE channel. 'bye' is host-internal and never crosses IPC. */
export interface RemoteSignalPart { kind: 'offer' | 'answer' | 'bye'; part: number; of: number; data: string }
export type RemoteLabCommand =
  | { kind: 'status' } | { kind: 'close' }
  | { kind: 'connect'; serverUrl: string; privateNetwork?: boolean }
  | { kind: 'signIn'; username: string; password: string; deviceName: string; confirmElsewhere?: true } | { kind: 'openSession' }
  | { kind: 'goOnline'; deviceName: string } | { kind: 'goOffline' }
  | { kind: 'request'; target: string; verification: string | null }
  | { kind: 'armCapture'; sessionId: string; verification: string | null }
  | { kind: 'accept'; sessionId: string } | { kind: 'decline'; sessionId: string }
  | { kind: 'signal'; sessionId: string; part: RemoteSignalPart }
  | { kind: 'stop'; sessionId: string }
  /** Renderer ack: all tracks of this agent session are stopped and its RTCPeerConnection is closed. */
  | { kind: 'stopped'; sessionId: string };
export type RemoteLabRequest = RemoteLabCommand & { clientId: string };
export interface RemoteLabSession {
  id: string; role: 'viewer' | 'agent'; peer: RemoteDevice; scope: RemoteScope;
  state: 'requesting' | 'consent' | 'granted' | 'connecting' | 'active';
  /** Local epoch ms, never the server clock. */
  expiresAt: number; startedAt?: number;
  /** Agent only, while verification is required: remaining typed attempts. */
  attemptsLeft?: number;
}
export interface RemoteLabState {
  phase: 'idle' | 'serverReady' | 'signedIn' | 'online';
  server?: { serverUrl: string; serverId: string };
  account?: { username: string; validUntil: number; deviceName: string };
  enrolled?: { username: string; name: string };
  /** Old serverUrl when this device is enrolled for the same serverId at another address. */
  enrolledElsewhere?: string;
  identity?: { fingerprint: string; persistent: boolean };
  devices?: RemoteDevice[];
  session?: RemoteLabSession;
  /** Incoming requests suppressed since going online (only when > 0). */
  muted?: number;
}
export type RemoteLabEvent =
  | { kind: 'state'; state: RemoteLabState }
  | { kind: 'signal'; sessionId: string; part: RemoteSignalPart }
  | { kind: 'ended'; sessionId: string; reason: RemoteEndReason }
  | { kind: 'error'; code: RemoteErrorCode };
export type RemoteLabReply = { ok: true; state: RemoteLabState } | { ok: false; code: RemoteErrorCode };
export const REMOTE_LAB_LIMITS = {
  deviceName: 64, signalPart: 6144, signalParts: 4, sdp: 24576,
  requestMs: 60000, consentMs: 55000, sessionMs: 300000,
  setupPollMs: 1000, activePollMs: 5000, gatherMs: 2000, acceptDelayMs: 1000, byeMs: 2000,
  verificationHex: 16, verificationAttempts: 3, muteMs: 600000, handshakeMs: 20000,
} as const;
