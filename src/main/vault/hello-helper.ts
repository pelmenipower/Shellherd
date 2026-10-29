import { capabilities } from '../platform';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';

import { AppError } from '../../shared/errors';
import type { ErrorCode } from '../../shared/errors';

/** Talks to Windows Hello; the only place that knows the helper program or the run-app fake. */
export interface HelloSigner {
  /** Never prompts; false on any failure. */
  available(): Promise<boolean>;
  /** Prompts. create = make the Shellherd Hello key if it is missing (enrollment only). Throws core.hello* codes. */
  sign(challenge: Buffer, create: boolean): Promise<Buffer>;
}

/** The user may take a while at the prompt; after this the helper is killed and the request fails. */
export const HELLO_TIMEOUT_MS = 120_000;
const STATUS_TIMEOUT_MS = 30_000;
const MAX_REPLY = 16_384;
/** Windows Hello keys are RSA-2048: a real signature has 256 bytes. Anything shorter would make a weak wrapping key. */
const MIN_SIGNATURE_BYTES = 256;

/** Error code for a failed helper status; unknown text is core.helloFailed. */
export function helloFailure(status: unknown): ErrorCode {
  if (status === 'canceled') return 'core.helloCanceled';
  if (status === 'notFound') return 'core.helloStale';
  if (status === 'unavailable') return 'core.helloUnavailable';
  return 'core.helloFailed';
}

/** Parses the helper's single output line; ok:false and anything unreadable throw a coded error. */
export function readHelloReply(text: string): { available?: unknown; signature?: unknown } {
  let reply: unknown;
  try { reply = JSON.parse(text.trim()); } catch { throw new AppError('core.helloFailed'); }
  if (typeof reply !== 'object' || reply === null) throw new AppError('core.helloFailed');
  const { ok, status } = reply as { ok?: unknown; status?: unknown };
  if (ok !== true) throw new AppError(helloFailure(status));
  return reply as { available?: unknown; signature?: unknown };
}

/** Signature bytes from the helper reply; missing, oversized or too short → core.helloFailed. */
export function helloSignature(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new AppError('core.helloFailed');
  const signature = Buffer.from(value, 'base64');
  if (signature.length < MIN_SIGNATURE_BYTES) {
    signature.fill(0);
    throw new AppError('core.helloFailed');
  }
  return signature;
}

/** run-app hook: only an unpacked Shellherd reads SHELLHERD_HELLO_FAKE; a packaged build never does. */
export function fakeHelloMode(packaged: boolean, env: NodeJS.ProcessEnv): string | undefined {
  return packaged ? undefined : env.SHELLHERD_HELLO_FAKE;
}

/** Deterministic stand-in for the helper: 'ok' signs, 'reset' stands for a re-created Hello key, 'cancel' and 'unavailable' fail. */
function fakeSign(mode: string, challenge: Buffer): Buffer {
  if (mode === 'cancel') throw new AppError('core.helloCanceled');
  if (mode === 'unavailable') throw new AppError('core.helloUnavailable');
  return createHmac('sha256', mode === 'reset' ? 'shellherd-hello-fake-reset' : 'shellherd-hello-fake').update(challenge).digest();
}

/** Runs the helper once: one request line in, one line out; killed after the timeout (empty output → core.helloFailed). */
function runHelper(executable: string, request: object, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: false });
    let output = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { if (output.length < MAX_REPLY) output += chunk; });
    // A missing or blocked helper (ENOENT, EACCES) means Windows Hello cannot be used here.
    child.on('error', () => { clearTimeout(timer); reject(new AppError('core.helloUnavailable')); });
    child.on('close', () => { clearTimeout(timer); resolve(output); });
    child.stdin.on('error', () => { /* close reports the failure */ });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

/** One prompt at a time; the fake is read on every call so a run-app scene can switch it. */
export function createHelloSigner(executable: string, packaged: boolean, env: NodeJS.ProcessEnv = process.env): HelloSigner {
  let busy = false;
  return {
    async available() {
      const mode = fakeHelloMode(packaged, env);
      if (mode !== undefined) return mode !== 'unavailable';
      if (!capabilities.windowsHello) return false;
      try { return readHelloReply(await runHelper(executable, { op: 'status' }, STATUS_TIMEOUT_MS)).available === true; } catch { return false; }
    },
    async sign(challenge, create) {
      if (busy) throw new AppError('core.helloBusy');
      busy = true;
      try {
        const mode = fakeHelloMode(packaged, env);
        if (mode !== undefined) {
          // A real prompt takes a while: yield once so a second request meets the busy flag, as in production.
          await Promise.resolve();
          return fakeSign(mode, challenge);
        }
        if (!capabilities.windowsHello) throw new AppError('core.helloUnavailable');
        return helloSignature(readHelloReply(await runHelper(executable, { op: 'sign', challenge: challenge.toString('base64'), create }, HELLO_TIMEOUT_MS)).signature);
      } finally {
        busy = false;
      }
    },
  };
}
