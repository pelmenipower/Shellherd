export type RemoteScope = 'view';
/** id is the device fingerprint: SHA-256 of the SPKI DER, 64 lowercase hex. */
export interface RemoteDevice { id: string; name: string; known?: { firstSeen: number } }
export type RemoteEndReason = 'stopped' | 'remote' | 'expired' | 'locked' | 'declined' | 'failed' | 'scope';
export type RemoteErrorCode = 'unavailable' | 'invalid' | 'stale' | 'identity' | 'locked' | 'connection' | 'authentication' | 'expired'
  | 'declined' | 'mismatch' | 'signal' | 'media' | 'peer' | 'scope' | 'limit';
/** Wire part inside the E2EE channel. 'bye' is host-internal and never crosses IPC. */
export interface RemoteSignalPart { kind: 'offer' | 'answer' | 'bye'; part: number; of: number; data: string }
export type RemoteLabCommand =
  | { kind: 'status' } | { kind: 'close' }
  | { kind: 'connect'; serverUrl: string }
  | { kind: 'signIn'; username: string; password: string }
  | { kind: 'goOnline'; deviceName: string } | { kind: 'goOffline' }
  | { kind: 'request'; target: string; compared: true }
  | { kind: 'armCapture'; sessionId: string }
  | { kind: 'accept'; sessionId: string } | { kind: 'decline'; sessionId: string }
  | { kind: 'signal'; sessionId: string; part: RemoteSignalPart }
  | { kind: 'stop'; sessionId: string };
export type RemoteLabRequest = RemoteLabCommand & { clientId: string };
export interface RemoteLabSession {
  id: string; role: 'viewer' | 'agent'; peer: RemoteDevice; scope: RemoteScope;
  state: 'requesting' | 'consent' | 'connecting' | 'active';
  /** Local epoch ms (see K3), never the server clock. */
  expiresAt: number; startedAt?: number;
}
export interface RemoteLabState {
  phase: 'idle' | 'serverReady' | 'signedIn' | 'online';
  server?: { serverUrl: string; serverId: string };
  account?: { username: string; validUntil: number };
  identity?: { fingerprint: string; persistent: boolean };
  devices?: RemoteDevice[];
  session?: RemoteLabSession;
}
export type RemoteLabEvent =
  | { kind: 'state'; state: RemoteLabState }
  | { kind: 'signal'; sessionId: string; part: RemoteSignalPart }
  | { kind: 'ended'; sessionId: string; reason: RemoteEndReason }
  | { kind: 'error'; code: RemoteErrorCode };
export type RemoteLabReply = { ok: true; state: RemoteLabState } | { ok: false; code: RemoteErrorCode };
export const REMOTE_LAB_LIMITS = {
  deviceName: 80, signalPart: 6144, signalParts: 4, sdp: 24576,
  captureGrantMs: 15000, requestMs: 60000, consentMs: 55000, sessionMs: 300000,
  setupPollMs: 1000, activePollMs: 5000, gatherMs: 2000, acceptDelayMs: 1000, byeMs: 2000,
} as const;
