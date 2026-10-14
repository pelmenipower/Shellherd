import { describe, expect, it } from 'vitest';
import { compactMessage, historyForRequest, insertableCommand, isFinished, outputMessage, parseAnswer, questionMessage, tail } from './assistant-chat';

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

  it('frames terminal text as data, keeps the newest part and skips an unchanged screen', () => {
    expect(tail('abcdef', 3)).toBe('…\ndef');
    const message = questionMessage('Warum?', 'line ``` x');
    expect(message).toContain("line ''' x");
    expect(message.endsWith('\nWarum?')).toBe(true);
    expect(questionMessage('Und jetzt?', null)).toBe('Und jetzt?');
    expect(outputMessage('ls', '')).toContain('(keine Ausgabe)');
    expect(outputMessage('kubectl get ns', 'default Active').endsWith('Nächster Schritt.')).toBe(true);
    expect(outputMessage('kubectl get ns', 'default Active', 'Welche sind älter als 100 Tage?')).toMatch(/default Active\n```\nWelche/);
  });

  it('resends long earlier turns only in short form and recognizes a finished goal', () => {
    expect(compactMessage('kurz')).toBe('kurz');
    const long = compactMessage('x'.repeat(5000));
    expect(long.length).toBeLessThan(700);
    expect(long.endsWith('(gekürzt)')).toBe(true);
    expect(isFinished('Fertig. Alle 33 Namespaces sind aktiv.')).toBe(true);
    expect(isFinished('Noch nicht fertig: <command>ls</command>')).toBe(false);
  });

  it('sends recent history starting with a user message', () => {
    const history = [{ role: 'assistant' as const, content: 'alt' }, { role: 'user' as const, content: 'a' }, { role: 'assistant' as const, content: '' }, { role: 'user' as const, content: 'b' }];
    expect(historyForRequest(history)).toEqual([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]);
    expect(historyForRequest(history, 1)).toEqual([{ role: 'user', content: 'b' }]);
  });
});
