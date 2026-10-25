import workerPath from './import-worker?modulePath';

/** Bundled path of the import worker file (electron-vite emits it as its own entry). */
export const IMPORT_WORKER_PATH: string = workerPath;
