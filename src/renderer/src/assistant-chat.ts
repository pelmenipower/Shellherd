import type { AiChatMessage } from '../../shared/ai';
import { t } from './i18n';

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

/** The answer says the goal is reached. */
export const isFinished = (answer: string): boolean => /^\s*(?:Fertig|Done)\b/i.test(answer);

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

/** Context budget per request; the terminal text is the largest part. */
export const SCREEN_LINES = 80;
const SCREEN_CHARS = 6_000;
const OUTPUT_CHARS = 8_000;
/** Older turns are resent in this size only. */
const COMPACT_CHARS = 600;

const fence = (text: string): string => `\`\`\`\n${text.replace(/```/g, "'''")}\n\`\`\``;

/** A question with the current screen, so the model always knows the state of the terminal. */
export function questionMessage(question: string, screen: string): string {
  return `${t('assistant:chat.terminal')}\n${fence(tail(screen, SCREEN_CHARS) || t('assistant:chat.empty'))}\n${question}`;
}

/** Sent by Shellherd itself after Enter: classify the output; continue only towards an open goal. */
export const afterOutput = (): string => t('assistant:chat.afterOutput');

/** Output of the command the user just ran. */
export function outputMessage(command: string, output: string, question = afterOutput()): string {
  return `${t('assistant:chat.outputOf', { command })}\n${fence(tail(output, OUTPUT_CHARS) || t('assistant:chat.noOutput'))}\n${question}`;
}

/** What an earlier turn costs in later requests: the question, or the start of a long output. */
export function compactMessage(content: string): string {
  return content.length <= COMPACT_CHARS ? content : `${content.slice(0, COMPACT_CHARS)}\n…${t('common:truncated')}`;
}

/** Recent history for a request: at most `max` messages, starting with a user message. */
export function historyForRequest(messages: AiChatMessage[], max = 12): AiChatMessage[] {
  const recent = messages.filter(message => message.content.trim()).slice(-max);
  const first = recent.findIndex(message => message.role === 'user');
  return first < 0 ? [] : recent.slice(first);
}
