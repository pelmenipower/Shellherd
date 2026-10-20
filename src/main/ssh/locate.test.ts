import { describe, expect, it } from 'vitest';
import { locateCommand, pickRunnable } from './locate';

describe('locating installed command line tools', () => {
  it('prefers what cmd.exe runs over extensionless npm shims', () => {
    expect(pickRunnable('C:\\npm\\claude\r\nC:\\npm\\claude.cmd\r\n')).toBe('C:\\npm\\claude.cmd');
    expect(pickRunnable('C:\\tools\\codex.exe\n')).toBe('C:\\tools\\codex.exe');
    expect(pickRunnable('')).toBeNull();
  });

  it.runIf(process.platform === 'win32')('finds Windows programs and rejects unsafe names', async () => {
    expect(await locateCommand('cmd')).toMatch(/cmd\.exe$/i);
    expect(await locateCommand('surely-not-installed-terminus')).toBeNull();
    expect(await locateCommand('a & calc')).toBeNull();
  }, 15_000); // two real where.exe calls, each allowed up to 5 s by locateCommand
});
