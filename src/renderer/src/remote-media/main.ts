// Remote media window page: no React, text only via t() and textContent, no motion.
import '../tokens.css';
import './remote-media.css';
import type { RemoteMediaPageHook } from '../../../shared/remote-media';
import { formatDateTime } from '../../../shared/format';
import { t } from '../i18n';
import { fakeCapture } from './capture-fake';
import { MediaPeer, browserPeers, realCapture, type MediaView } from './media-peer';

const api = window.remoteMedia;
if (api) {
  const video = document.getElementById('video') as HTMLVideoElement;
  const status = document.getElementById('status') as HTMLElement;
  const stop = document.getElementById('stop') as HTMLButtonElement;
  const peer = new MediaPeer(api, browserPeers, api.captureFake ? fakeCapture() : realCapture);

  const render = (view: MediaView): void => {
    video.srcObject = view.stream ?? null;
    // The agent window shows no text and no button.
    const viewer = view.role === 'viewer';
    stop.hidden = !viewer;
    stop.textContent = viewer ? t('remoteLab:stop') : '';
    if (!viewer) status.textContent = '';
    else if (!view.stream) status.textContent = t('remoteLab:connecting');
    else status.textContent = t('remoteLab:viewing', { name: view.peerName ?? '', time: formatDateTime(view.expiresAt ?? 0, 'time') });
  };
  stop.addEventListener('click', () => peer.stop());
  peer.subscribe(render);

  const hook: RemoteMediaPageHook = { capture: sourceId => peer.capture(sourceId) };
  (globalThis as unknown as { shellherdRemoteMedia: RemoteMediaPageHook }).shellherdRemoteMedia = hook;
}
