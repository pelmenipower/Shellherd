import { describe, expect, it } from 'vitest';
import { historyForRequest, insertableCommand, outputMessage, parseAnswer, questionMessage, tail } from './assistant-chat';

describe('assistant chat', () => {
  it('splits answers into text and commands, also while streaming', () => {
    expect(parseAnswer('Zeigt Dateien. <command>ls -la</command> Fertig.')).toEqual([
      { type: 'text', text: 'Zeigt Dateien. ' }, { type: 'command', command: 'ls -la', complete: true }, { type: 'text', text: ' Fertig.' }]);
    expect(parseAnswer('Gleich: <command>df -')).toEqual([{ type: 'text', text: 'Gleich: ' }, { type: 'command', command: 'df -', complete: false }]);
    expect(parseAnswer('Gleich: <comm')).toEqual([{ type: 'text', text: 'Gleich: ' }]);
  });

  it('only types single-line commands without control characters', () => {
    expect(insertableCommand(' `Get-Service sshd` ')).toBe('Get-Service sshd');
    expect(insertableCommand('rm -rf /tmp/x\nreboot')).toBeNull();
    expect(insertableCommand('echo a\rreboot')).toBeNull();
    expect(insertableCommand('echo a\r')).toBe('echo a');
    expect(insertableCommand('echo \u001b[31mrot\u0003')).toBe('echo [31mrot');
    expect(insertableCommand('   ')).toBeNull();
  });

  it('frames terminal text as data and keeps the newest part', () => {
    expect(tail('abcdef', 3)).toBe('…\ndef');
    const message = questionMessage('Warum?', 'line ``` x');
    expect(message).toContain("line ''' x");
    expect(message.endsWith('Frage: Warum?')).toBe(true);
    expect(outputMessage('ls', '')).toContain('(keine Ausgabe)');
  });

  it('sends recent history starting with a user message', () => {
    const history = [{ role: 'assistant' as const, content: 'alt' }, { role: 'user' as const, content: 'a' }, { role: 'assistant' as const, content: '' }, { role: 'user' as const, content: 'b' }];
    expect(historyForRequest(history)).toEqual([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]);
    expect(historyForRequest(history, 1)).toEqual([{ role: 'user', content: 'b' }]);
  });
});
