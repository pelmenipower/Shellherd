import { execFile } from 'node:child_process';
import { Client } from 'ssh2';
import type { SshConnectionNode } from '../../shared/vault/types';
import { sshConnectConfig } from '../ssh/client-config';
import type { RunResult } from './parsers';
import { SudoPromptWatcher } from './sudo';

const OUTPUT_LIMIT = 1024 * 1024;

/** Errors whose message is meant for the user. */
export class HostAccessError extends Error {}

export type VerifyHost = (host: string, port: number, key: Buffer, isActive: () => boolean) => Promise<boolean>;

/** Answers a `sudo -S -p marker` prompt on stderr with the password, at most once. */
export interface SudoPrompt { marker: string; password: string }

export interface RemoteHost {
  run(command: string, timeoutMs: number, sudo?: SudoPrompt): Promise<RunResult>;
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
    run(command, timeoutMs, sudo) {
      return new Promise((resolve, reject) => {
        client.exec(command, (error, stream) => {
          if (error) { reject(error); return; }
          let stdout = '', stderr = '', code: number | null = null, done = false;
          let password = sudo?.password;
          const watcher = sudo ? new SudoPromptWatcher(sudo.marker) : undefined;
          const addStderr = (chunk: Buffer): void => { if (stderr.length < OUTPUT_LIMIT) stderr += chunk.toString('utf8'); };
          const finish = (result: RunResult): void => {
            if (done) return;
            done = true; password = undefined; clearTimeout(timer); resolve(result);
          };
          const timer = setTimeout(() => { stream.close(); finish({ code: null, stdout, stderr, timedOut: true }); }, timeoutMs);
          stream.on('data', (chunk: Buffer) => { if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString('utf8'); });
          stream.stderr.on('data', (chunk: Buffer) => {
            if (!watcher) { addStderr(chunk); return; }
            const { output, prompts } = watcher.feed(chunk);
            addStderr(output);
            if (!prompts) return;
            // A second prompt means sudo refused the password; never send it twice.
            if (watcher.count > 1 || !password) { stream.close(); finish({ code: null, stdout, stderr, sudoRejected: true }); return; }
            stream.write(`${password}\n`);
            password = undefined;
          });
          stream.on('exit', (exitCode: number | null) => { code = exitCode; });
          stream.on('close', () => { if (watcher) addStderr(watcher.flush()); finish({ code, stdout, stderr }); });
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
