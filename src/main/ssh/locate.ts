import { execFile } from 'node:child_process';
import { executableOnPath } from '../platform';
import { win32 } from 'node:path';

/** cmd.exe runs these; `where` also lists shell scripts without an extension (npm shims). */
const RUNNABLE = /\.(exe|cmd|bat|com)$/i;

/** The match of `where <command>` that cmd.exe would run, or null when the program is not installed. */
export function pickRunnable(output: string): string | null {
  const matches = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return matches.find(match => RUNNABLE.test(match)) ?? matches[0] ?? null;
}

export function locateCommand(command: string): Promise<string | null> {
  if (!/^[\w.-]+$/.test(command)) return Promise.resolve(null);
  if (process.platform !== 'win32') return Promise.resolve(executableOnPath(command));
  const where = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe');
  return new Promise(resolve => execFile(where, [command], { windowsHide: true, timeout: 5_000 },
    (error, stdout) => resolve(error ? null : pickRunnable(stdout))));
}
