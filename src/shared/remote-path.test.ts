import { describe, expect, it } from 'vitest';
import { commonRemotePrefix, quoteRemotePath, remoteScriptToken, replaceRemoteScript } from './remote-path';
describe('remote script paths', () => {
  it('quotes selected filenames without shell interpretation and preserves arguments', () => {
    expect(quoteRemotePath("/home/a'b $x.sh")).toBe("'/home/a'\\''b $x.sh'");
    expect(replaceRemoteScript('bash ~/old.sh --json', '/tmp/new file.sh')).toBe("bash '/tmp/new file.sh' --json");
    expect(remoteScriptToken(quoteRemotePath("/home/a'b $x.sh"))?.path).toBe("/home/a'b $x.sh");
  });
  it.each(['~/cpu.sh', '$HOME/cpu.sh', '${HOME}/cpu.sh', './cpu.sh', '../cpu.sh', '/cpu.sh'])('recognizes %s', path => expect(remoteScriptToken(path)?.path).toBe(path));
  it.each(['clear && cd /', 'bash $(evil)', '/cpu.sh; evil', '"~/cpu.sh"', "'$HOME/cpu.sh'", '/tmp/$UNKNOWN.sh', '/tmp/`evil`', 'cpu.sh'])('does not guess %s', command => expect(remoteScriptToken(command)).toBeNull());
  it('allows completion of an unfinished quoted path', () => expect(remoteScriptToken("bash '/tmp/cpu")?.closed).toBe(false));
  it('finds shared Unicode prefixes', () => expect(commonRemotePrefix(['/ä/cpu.sh', '/ä/cpu2.sh'])).toBe('/ä/cpu'));
});
