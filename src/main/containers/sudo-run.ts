import type { SshConnectionNode } from '../../shared/vault/types';
import { remoteCommand, sudoSetting } from './commands';
import type { SudoMode } from './commands';
import type { RunResult } from './parsers';
import type { RemoteHost } from './runner';
import { createSudoMarker } from './sudo';
import { connectionFingerprint } from './sudo-rejections';
import type { SudoRejections } from './sudo-rejections';

/**
 * With a stored password: authenticate with `sudo -S -v` first, fresh markers per command. After a
 * rejection the password is not sent again (account lockout), until the connection settings change.
 * One authentication per connection at a time; the gate opens at readiness or when the run ends.
 */
export async function runWithSudo(host: RemoteHost, connection: SshConnectionNode, command: string[] | ((sudo: SudoMode) => string), timeoutMs: number, rejections: SudoRejections, outputLimit?: number): Promise<RunResult> {
  const render = (mode: SudoMode): string => typeof command === 'function' ? command(mode) : remoteCommand(command, mode);
  const setting = sudoSetting(connection);
  if (setting.kind !== 'prompt') return host.run(render(setting), timeoutMs, undefined, outputLimit);
  const print = connectionFingerprint(connection);
  const started = Date.now();
  // Waiting for another tab or command counts against this command's timeout.
  const release = await rejections.acquire(connection.id, timeoutMs);
  if (!release) return { code: null, stdout: '', stderr: '', sudoBusy: true };
  try {
    if (rejections.isRejected(connection.id, print)) return { code: null, stdout: '', stderr: '', sudoRejected: true };
    const marker = createSudoMarker('sudo');
    const ready = createSudoMarker('ready');
    const remaining = Math.max(1, timeoutMs - (Date.now() - started));
    const result = await host.run(render({ kind: 'prompt', marker, ready, stdin: true }), remaining,
      { marker, ready, password: setting.password, onReady: release }, outputLimit);
    if (result.sudoRejected) rejections.markRejected(connection.id, print);
    return result;
  } finally { release(); }
}
