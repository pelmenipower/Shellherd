import type { RemoteMediaApi } from '../../../shared/remote-media';

declare global {
  interface Window {
    /** Only present in the remote media window (minimal preload). */
    remoteMedia?: RemoteMediaApi;
  }
}

export {};
