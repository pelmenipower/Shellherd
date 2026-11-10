import type { RemoteSignalPart } from './remote-lab';
import type { Locale } from './locale';

export const REMOTE_MEDIA_CHANNELS = { action: 'remote-media:action', event: 'remote-media:event' } as const;
/** Same value as LOCALE_ARG in ./locale; duplicated so the media preload shares no runtime module with the main preload (B2). */
export const REMOTE_MEDIA_LOCALE_ARG = '--shellherd-locale=';
export const REMOTE_MEDIA_FAKE_ARG = '--shellherd-remote-capture-fake=';
/** Evaluated by main with userGesture = true; constant, never interpolated (path A). */
export const REMOTE_MEDIA_CAPTURE_SCRIPT = 'globalThis.shellherdRemoteMedia.capture()';
export type RemoteMediaRole = 'viewer' | 'agent';
export type RemoteMediaFailure = 'peer' | 'signal' | 'media';
export type RemoteMediaAction =
  | { kind: 'signal'; part: RemoteSignalPart } // own offer (agent) or answer (viewer) parts
  | { kind: 'stop' } // stop button, or the capture track ended
  | { kind: 'failed'; code: RemoteMediaFailure }; // connection failed, description failed, capture lost
export type RemoteMediaEvent =
  | { kind: 'hello'; role: RemoteMediaRole; peerName: string; expiresAt: number }
  | { kind: 'accepted' } // agent: create the offer now
  | { kind: 'signal'; part: RemoteSignalPart }; // checked parts of the other side, only after a complete checked message
export type RemoteMediaReply = { ok: true } | { ok: false; code: 'stale' | 'invalid' };
export interface RemoteMediaApi {
  readonly locale: Locale;
  readonly captureFake: boolean;
  action(request: RemoteMediaAction): Promise<RemoteMediaReply>;
  onEvent(listener: (event: RemoteMediaEvent) => void): () => void;
}
/** Registered by the media page on globalThis; sourceId only in fallback path B (E1). */
export interface RemoteMediaPageHook {
  capture(sourceId?: string): Promise<boolean>;
}
