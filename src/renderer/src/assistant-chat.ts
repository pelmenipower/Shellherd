import type { AiChatMessage } from '../../shared/ai';

export type AnswerSegment = { type: 'text'; text: string } | { type: 'command'; command: string; complete: boolean };

/** Splits an (possibly still streaming) answer into text and `<command>` blocks. */
export function parseAnswer(text: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let rest = text;
  for (;;) {
    const start = rest.indexOf('<command>');
    if (start < 0) {
      // A tag that has only partly arrived is not shown as text.
      const partial = /<(?:c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?)?$/.exec(rest);
      const visible = partial ? rest.slice(0, partial.index) : rest;
      if (visible) segments.push({ type: 'text', text: visible });
      return segments;
    }
    if (start > 0) segments.push({ type: 'text', text: rest.slice(0, start) });
    const body = rest.slice(start + 9);
    const end = body.indexOf('</command>');
    if (end < 0) { segments.push({ type: 'command', command: body.trim(), complete: false }); return segments; }
    segments.push({ type: 'command', command: body.slice(0, end).trim(), complete: true });
    rest = body.slice(end + 10);
  }
}

/**
 * The exact text typed into the terminal: one line, no control characters, so it can never be
 * submitted by itself. Null when it is empty or spans several lines.
 */
export function insertableCommand(command: string): string | null {
  const unwrapped = command.trim().replace(/^`+|`+$/g, '').trim();
  if (!unwrapped || /[\r\n]/.test(unwrapped)) return null;
  // eslint-disable-next-line no-control-regex
  const clean = unwrapped.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  return clean.length > 0 && clean.length <= 4000 ? clean : null;
}

/** Keeps the end of long terminal text, where the current state is. */
export function tail(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `…\n${text.slice(text.length - maxChars)}`;
}

const fence = (text: string): string => `\`\`\`\n${text.replace(/```/g, "'''")}\n\`\`\``;

export function questionMessage(question: string, screen: string): string {
  return `Aktueller Terminalinhalt (letzte Zeilen):\n${fence(tail(screen, 12_000) || '(leer)')}\n\nFrage: ${question}`;
}

export function outputMessage(command: string, output: string): string {
  return `Ich habe den Befehl ausgeführt: ${command}\nAusgabe:\n${fence(tail(output, 16_000) || '(keine Ausgabe)')}\n\nWas bedeutet das, und was wäre ein sinnvoller nächster Schritt?`;
}

/** Recent history for a request: at most `max` messages, starting with a user message. */
export function historyForRequest(messages: AiChatMessage[], max = 20): AiChatMessage[] {
  const recent = messages.filter(message => message.content.trim()).slice(-max);
  const first = recent.findIndex(message => message.role === 'user');
  return first < 0 ? [] : recent.slice(first);
}
