// Preload of the isolated remote media window. Runtime imports are limited to
// `electron` and the contract module so the build emits no shared chunks (B2).
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import {
  REMOTE_MEDIA_CHANNELS,
  REMOTE_MEDIA_FAKE_ARG,
  REMOTE_MEDIA_LOCALE_ARG,
} from '../shared/remote-media';
import type { RemoteMediaApi, RemoteMediaEvent } from '../shared/remote-media';

const localeArg = process.argv.find(arg => arg.startsWith(REMOTE_MEDIA_LOCALE_ARG))?.slice(REMOTE_MEDIA_LOCALE_ARG.length);

const api: RemoteMediaApi = {
  locale: localeArg === 'en-US' ? 'en-US' : 'de-DE',
  captureFake: process.argv.includes(REMOTE_MEDIA_FAKE_ARG + '1'),
  action: request => ipcRenderer.invoke(REMOTE_MEDIA_CHANNELS.action, request),
  onEvent: listener => {
    const handler = (_event: IpcRendererEvent, value: RemoteMediaEvent): void => listener(value);
    ipcRenderer.on(REMOTE_MEDIA_CHANNELS.event, handler);
    return () => ipcRenderer.removeListener(REMOTE_MEDIA_CHANNELS.event, handler);
  },
};

contextBridge.exposeInMainWorld('remoteMedia', api);
