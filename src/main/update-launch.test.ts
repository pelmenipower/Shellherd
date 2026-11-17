import { describe, expect, it } from 'vitest';

import { AppError } from '../shared/errors';
import {
  LINUX_TERMINALS, UPDATE_VERSION, WINDOWS_LAUNCHER, detectInstallKind, planUpdateLaunch, shellQuote, updateChildEnv,
} from './update-launch';

const base = { platform: 'linux' as NodeJS.Platform, env: {} as NodeJS.ProcessEnv, execPath: '/x', isPackaged: true, uninstallerExists: false };

describe('detectInstallKind', () => {
  it('is null when not packaged', () => {
    expect(detectInstallKind({ ...base, isPackaged: false, execPath: '/opt/Shellherd/shellherd' })).toBeNull();
  });

  it('detects appimage, deb and unknown on Linux', () => {
    const env = { APPIMAGE: '/home/u/Shellherd.AppImage', APPDIR: '/tmp/.mount_x' };
    expect(detectInstallKind({ ...base, env, execPath: '/tmp/.mount_x/shellherd' })).toBe('appimage');
    expect(detectInstallKind({ ...base, env: { APPIMAGE: 'rel', APPDIR: '/tmp/.mount_x' }, execPath: '/tmp/.mount_x/shellherd' })).toBeNull();
    expect(detectInstallKind({ ...base, env, execPath: '/tmp/.mount_x/other' })).toBeNull();
    expect(detectInstallKind({ ...base, execPath: '/opt/Shellherd/shellherd' })).toBe('deb');
    expect(detectInstallKind({ ...base, execPath: '/home/u/dev/shellherd' })).toBeNull();
  });

  it('detects portable, setup and unknown on Windows', () => {
    const win = { ...base, platform: 'win32' as const, execPath: 'C:\\x\\Shellherd.exe' };
    expect(detectInstallKind({ ...win, env: { PORTABLE_EXECUTABLE_DIR: 'C:\\Users\\u' }, uninstallerExists: true })).toBe('portable');
    expect(detectInstallKind({ ...win, env: { PORTABLE_EXECUTABLE_DIR: 'rel' }, uninstallerExists: true })).toBe('setup');
    expect(detectInstallKind({ ...win, uninstallerExists: true })).toBe('setup');
    expect(detectInstallKind({ ...win, uninstallerExists: false })).toBeNull();
  });

  it('is null on other platforms', () => {
    expect(detectInstallKind({ ...base, platform: 'darwin' })).toBeNull();
  });
});

describe('updateChildEnv', () => {
  it('drops app and runtime variables case-insensitively and keeps the rest', () => {
    const env = {
      PATH: '/usr/bin', HOME: '/home/u', SHELLHERD_INSTALL_HANDOFF: '1', shellherd_update_url: 'x', APPDIR: '/a', APPIMAGE: '/b',
      ARGV0: 'c', OWD: '/d', ELECTRON_RUN_AS_NODE: '1', Node_Options: '--x', EMPTY: undefined,
    } as NodeJS.ProcessEnv;
    expect(updateChildEnv(env)).toEqual({ PATH: '/usr/bin', HOME: '/home/u' });
  });
});

describe('shellQuote', () => {
  it('single-quotes and escapes single quotes', () => {
    expect(shellQuote('a b')).toBe("'a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

const plan = (over: Partial<Parameters<typeof planUpdateLaunch>[0]> = {}) => planUpdateLaunch({
  kind: 'deb', version: '0.33.0', pid: 1234, script: '/tmp/shellherd-update-x/install.sh', execPath: '/opt/Shellherd/shellherd',
  env: { PATH: '/usr/bin', SHELLHERD_X: 'y' }, findOnPath: name => `/usr/bin/${name}`, ...over,
});

describe('planUpdateLaunch', () => {
  it('lists the terminals in order', () => {
    expect(LINUX_TERMINALS.map(t => t.name)).toEqual(['xdg-terminal-exec', 'x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm']);
    expect(UPDATE_VERSION.test('0.33.0')).toBe(true);
  });

  it('plans deb with argv only', () => {
    expect(plan()).toEqual({
      kind: 'deb', version: '0.33.0', script: '/tmp/shellherd-update-x/install.sh', command: '/usr/bin/xdg-terminal-exec',
      args: ['bash', '--', '/tmp/shellherd-update-x/install.sh', '--from-app', '--version', '0.33.0', '--wait-pid', '1234'],
      env: { PATH: '/usr/bin' }, quitAfter: true,
    });
  });

  it('picks the first available terminal with its prefix', () => {
    const result = plan({ findOnPath: name => (name === 'konsole' || name === 'xterm' ? `/bin/${name}` : null) });
    expect(result.command).toBe('/bin/konsole');
    expect(result.args.slice(0, 2)).toEqual(['-e', 'bash']);
    expect(plan({ findOnPath: name => (name === 'gnome-terminal' ? '/g' : null) }).args[0]).toBe('--');
  });

  it('adds the AppImage path', () => {
    const result = plan({ kind: 'appimage', env: { APPIMAGE: '/home/u/S.AppImage' } });
    expect(result.args.slice(-2)).toEqual(['--appimage', '/home/u/S.AppImage']);
    expect(result.env).toEqual({});
  });

  it('reports a quoted command without terminal', () => {
    const none = { findOnPath: () => null };
    const deb = (() => { try { plan(none); } catch (e) { return e; } })() as AppError;
    expect(deb).toBeInstanceOf(AppError);
    expect(deb.code).toBe('core.updateNoTerminal');
    expect(deb.params).toEqual({ command: "bash '/tmp/shellherd-update-x/install.sh' --version 0.33.0" });
    const img = (() => { try { plan({ ...none, kind: 'appimage', env: { APPIMAGE: "/h/it's.AppImage" } }); } catch (e) { return e; } })() as AppError;
    expect(img.params).toEqual({ command: "bash '/tmp/shellherd-update-x/install.sh' --appimage '/h/it'\\''s.AppImage' --version 0.33.0" });
  });

  it('plans Windows setup and portable', () => {
    const env = { SystemRoot: 'C:\\Windows', Path: 'p', PORTABLE_EXECUTABLE_DIR: 'C:\\P', ELECTRON_X: '1' } as NodeJS.ProcessEnv;
    const setup = plan({ kind: 'setup', script: 'C:\\r\\install.ps1', execPath: 'C:\\A\\Shellherd.exe', env });
    expect(setup.command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(setup.args.slice(0, 4)).toEqual(['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden']);
    expect(setup.args[4]).toBe('-EncodedCommand');
    expect(Buffer.from(setup.args[5], 'base64').toString('utf16le')).toBe(WINDOWS_LAUNCHER);
    expect(setup.env).toEqual({
      SystemRoot: 'C:\\Windows', Path: 'p', PORTABLE_EXECUTABLE_DIR: 'C:\\P', SHELLHERD_UPDATE_SCRIPT: 'C:\\r\\install.ps1',
      SHELLHERD_UPDATE_VERSION: '0.33.0', SHELLHERD_UPDATE_PID: '1234', SHELLHERD_UPDATE_TARGET: 'setup', SHELLHERD_RELAUNCH: 'C:\\A\\Shellherd.exe',
    });
    expect(setup.quitAfter).toBe(true);
    const portable = plan({ kind: 'portable', script: 'C:\\r\\install.ps1', env });
    expect(portable.env.SHELLHERD_UPDATE_TARGET).toBe('portable');
    expect(portable.env.SHELLHERD_PORTABLE_DIR).toBe('C:\\P');
    expect(portable.env.SHELLHERD_RELAUNCH).toBeUndefined();
    expect(portable.quitAfter).toBe(false);
  });

  it('rejects invalid version and pid', () => {
    for (const bad of [{ version: '1.2' }, { version: '1.2.3; rm' }, { pid: 0 }, { pid: 1.5 }, { pid: -3 }]) {
      expect(() => plan(bad)).toThrow(expect.objectContaining({ code: 'core.invalidRequest' }));
    }
  });
});
