import { execFile } from 'node:child_process';
import { Client } from 'ssh2';
import type { Duplex } from 'node:stream';
import type { SshConnectionNode } from '../../shared/vault/types';
import { sshConnectConfig } from '../ssh/client-config';
import type { RunResult } from './parsers';
import { SudoWatcher } from './sudo';

const OUTPUT_LIMIT = 1024 * 1024;

/** Errors whose message is meant for the user. */
export class HostAccessError extends Error {}

export type VerifyHost = (host: string, port: number, key: Buffer, isActive: () => boolean) => Promise<boolean>;

/** Answers a `sudo -S -p marker` prompt on stderr with the password at most once, until `ready` appears on stdout. */
export interface SudoPrompt { marker: string; ready: string; password: string; onReady?: () => void }

export interface RemoteHost {
  run(command: string, timeoutMs: number, sudo?: SudoPrompt): Promise<RunResult>;
  /** A TCP channel to host:port as seen from the SSH server. */
  forward(host: string, port: number): Promise<Duplex>;
  close(): void;
  readonly closed: boolean;
}

export async function openRemoteHost(connection: SshConnectionNode, verifyHost: VerifyHost, createClient = () => new Client()): Promise<RemoteHost> {
  const client = createClient();
  let closed = false;
  let rejectedKey = false;
  const { config, key } = await sshConnectConfig(connection, (hostKey, callback) => {
    void verifyHost(connection.host, connection.port, hostKey, () => !closed)
      .then(valid => { rejectedKey = !valid; callback(valid); })
      .catch(() => { rejectedKey = true; callback(false); });
  });
  // No shorter readyTimeout: it also spans the async host-key prompt the user may still be reading.
  try {
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve);
      client.once('error', error => reject(rejectedKey ? new HostAccessError('Der Server-Schlüssel wurde nicht bestätigt.') : error));
      client.connect(config);
    });
  } catch (error) { closed = true; client.destroy(); throw error; }
  finally { key?.fill(0); }
  client.on('error', () => { closed = true; });
  client.on('close', () => { closed = true; });
  return {
    get closed() { return closed; },
    close() { closed = true; client.end(); },
    forward(host, port) {
      return new Promise((resolve, reject) => {
        client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => {
          if (error) reject(new HostAccessError(`Der API-Server ist vom Zugangs-Host aus nicht erreichbar (${host}:${port}).`));
          else resolve(channel);
        });
      });
    },
    run(command, timeoutMs, sudo) {
      return new Promise((resolve, reject) => {
        client.exec(command, (error, stream) => {
          if (error) { reject(error); return; }
          let stdout = '', stderr = '', code: number | null = null, done = false;
          // Until the ready marker: prompts arrive on stderr, the ready marker on stdout.
          let password = sudo?.password;
          let authenticated = false;
          let prompts = sudo ? new SudoWatcher({ prompt: sudo.marker }) : undefined;
          let ready = sudo ? new SudoWatcher({ ready: sudo.ready }) : undefined;
          const addStdout = (chunk: Buffer): void => { if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString('utf8'); };
          const addStderr = (chunk: Buffer): void => { if (stderr.length < OUTPUT_LIMIT) stderr += chunk.toString('utf8'); };
          const disarm = (): void => {
            if (prompts) addStderr(prompts.flush());
            if (ready) addStdout(ready.flush());
            prompts = undefined; ready = undefined; password = undefined;
          };
          const finish = (result: RunResult): void => {
            if (done) return;
            done = true; password = undefined; clearTimeout(timer); resolve(authenticated ? { ...result, sudoReady: true } : result);
          };
          const timer = setTimeout(() => {
            const noPrompt = prompts !== undefined && prompts.count === 0;
            stream.close();
            finish({ code: null, stdout, stderr, timedOut: true, ...(noPrompt ? { sudoNoPrompt: true } : {}) });
          }, timeoutMs);
          stream.on('data', (chunk: Buffer) => {
            if (!ready) { addStdout(chunk); return; }
            const result = ready.feed(chunk);
            addStdout(result.output);
            if (result.ready) { authenticated = true; disarm(); sudo?.onReady?.(); }
          });
          stream.stderr.on('data', (chunk: Buffer) => {
            if (!prompts) { addStderr(chunk); return; }
            const result = prompts.feed(chunk);
            addStderr(result.output);
            if (!result.prompts) return;
            // A second prompt means sudo refused the password; never send it twice.
            if (prompts.count > 1 || !password) { stream.close(); finish({ code: null, stdout, stderr, sudoRejected: true }); return; }
            stream.write(`${password}\n`);
            password = undefined;
          });
          stream.on('exit', (exitCode: number | null) => { code = exitCode; });
          stream.on('close', () => { disarm(); finish({ code, stdout, stderr }); });
        });
      });
    },
  };
}

export function runLocal(file: string, args: string[], timeoutMs: number, exec: typeof execFile = execFile): Promise<RunResult> {
  return new Promise(resolve => {
    exec(file, args, { timeout: timeoutMs, maxBuffer: 4 * OUTPUT_LIMIT, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      const failure = error as (NodeJS.ErrnoException & { killed?: boolean; code?: string | number }) | null;
      if (failure?.code === 'ENOENT') { resolve({ code: null, stdout: '', stderr: '', notFound: true }); return; }
      if (failure?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') { resolve({ code: null, stdout: String(stdout), stderr: 'Die Ausgabe ist zu groß.' }); return; }
      if (failure?.killed) { resolve({ code: null, stdout: String(stdout), stderr: String(stderr), timedOut: true }); return; }
      resolve({ code: failure ? (typeof failure.code === 'number' ? failure.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
