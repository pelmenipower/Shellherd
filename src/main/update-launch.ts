import { posix, win32 } from 'node:path';

import { AppError } from '../shared/errors';
import type { UpdateInstallKind } from '../shared/ipc';

export const UPDATE_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** Tried in order; the prefix precedes the command the terminal runs. */
export const LINUX_TERMINALS: readonly { name: string; prefix: readonly string[] }[] = [
  { name: 'xdg-terminal-exec', prefix: [] },
  { name: 'x-terminal-emulator', prefix: ['-e'] },
  { name: 'gnome-terminal', prefix: ['--'] },
  { name: 'konsole', prefix: ['-e'] },
  { name: 'xterm', prefix: ['-e'] },
];

/** Opens a visible console that breaks out of the app's job object; all values arrive via environment variables. */
export const WINDOWS_LAUNCHER = `$ErrorActionPreference = 'Stop'
$ps = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
Start-Process -FilePath $ps -WorkingDirectory $env:TEMP -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $env:SHELLHERD_UPDATE_SCRIPT + '"'), '-FromApp')
`;

export interface UpdateLaunchPlan {
  kind: UpdateInstallKind; version: string; script: string;
  command: string; args: string[]; env: Record<string, string>; quitAfter: boolean;
}

export function detectInstallKind(input: {
  platform: NodeJS.Platform; env: NodeJS.ProcessEnv; execPath: string; isPackaged: boolean; uninstallerExists: boolean;
}): UpdateInstallKind | null {
  const { platform, env, execPath } = input;
  if (!input.isPackaged) return null;
  if (platform === 'linux') {
    if (env.APPIMAGE && env.APPDIR && posix.isAbsolute(env.APPIMAGE) && posix.isAbsolute(env.APPDIR)
      && execPath === posix.join(env.APPDIR, 'shellherd')) return 'appimage';
    return execPath === '/opt/Shellherd/shellherd' ? 'deb' : null;
  }
  if (platform === 'win32') {
    if (env.PORTABLE_EXECUTABLE_DIR && win32.isAbsolute(env.PORTABLE_EXECUTABLE_DIR)) return 'portable';
    return input.uninstallerExists ? 'setup' : null;
  }
  return null;
}

const STRIPPED_ENV = /^(SHELLHERD_.*|ELECTRON_.*|NODE_OPTIONS|APPDIR|APPIMAGE|ARGV0|OWD)$/;

/** Copy of the string entries without AppImage, Electron and Shellherd variables (Windows keys are case-insensitive). */
export function updateChildEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && !STRIPPED_ENV.test(key.toUpperCase())) copy[key] = value;
  }
  return copy;
}

/** POSIX single quoting. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function planUpdateLaunch(input: {
  kind: UpdateInstallKind; version: string; pid: number; script: string; execPath: string;
  env: NodeJS.ProcessEnv; findOnPath: (name: string) => string | null;
}): UpdateLaunchPlan {
  const { kind, version, pid, script, execPath, env } = input;
  if (!UPDATE_VERSION.test(version) || !Number.isInteger(pid) || pid <= 0) throw new AppError('core.invalidRequest');
  const common = { kind, version, script };

  if (kind === 'deb' || kind === 'appimage') {
    const appImage = kind === 'appimage' ? env.APPIMAGE ?? '' : '';
    for (const terminal of LINUX_TERMINALS) {
      const found = input.findOnPath(terminal.name);
      if (found === null) continue;
      const args = [...terminal.prefix, 'bash', '--', script, '--from-app', '--version', version, '--wait-pid', String(pid)];
      if (kind === 'appimage') args.push('--appimage', appImage);
      return { ...common, command: found, args, env: updateChildEnv(env), quitAfter: true };
    }
    const command = kind === 'appimage'
      ? `bash ${shellQuote(script)} --appimage ${shellQuote(appImage)} --version ${version}`
      : `bash ${shellQuote(script)} --version ${version}`;
    throw new AppError('core.updateNoTerminal', { command });
  }

  const childEnv: Record<string, string> = {
    ...updateChildEnv(env),
    SHELLHERD_UPDATE_SCRIPT: script,
    SHELLHERD_UPDATE_VERSION: version,
    SHELLHERD_UPDATE_PID: String(pid),
    SHELLHERD_UPDATE_TARGET: kind,
  };
  if (kind === 'setup') childEnv.SHELLHERD_RELAUNCH = execPath;
  else childEnv.SHELLHERD_PORTABLE_DIR = env.PORTABLE_EXECUTABLE_DIR ?? '';
  return {
    ...common,
    command: win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(WINDOWS_LAUNCHER, 'utf16le').toString('base64')],
    env: childEnv,
    quitAfter: kind === 'setup',
  };
}
