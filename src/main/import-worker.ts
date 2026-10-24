import { parentPort } from 'node:worker_threads';

import { AppError } from '../shared/errors';
import type { CodedError } from '../shared/errors';
import type { ImportPreview, ImportSource } from '../shared/import';
import { parseImport } from './import-parse';

export interface ImportRequest { source: ImportSource; text: string; home: string }
export type ImportReply = { ok: true; preview: Omit<ImportPreview, 'source' | 'file'> } | { ok: false; error: CodedError };

/** Parses one request; anything that is not an AppError is reported as unreadable. */
export function answer({ source, text, home }: ImportRequest): ImportReply {
  try {
    return { ok: true, preview: parseImport(source, text, home) };
  } catch (error) {
    return { ok: false, error: error instanceof AppError ? error.toCoded() : { code: 'core.importUnreadable' } };
  }
}

// Not a worker (null parentPort) when the module is imported by tests or the main process.
parentPort?.once('message', (request: ImportRequest) => parentPort?.postMessage(answer(request)));
