import type { Terminal } from '@xterm/xterm';

export interface TerminalMark { line: () => number; dispose: () => void }

/** Read access to a terminal for the assistant: text and cursor only, never input. */
export interface TerminalAccess {
  /** The last lines up to the cursor, without trailing empty lines. */
  screen: (maxLines: number) => string;
  /** Marks the cursor line; the mark follows the buffer when old lines are trimmed. */
  mark: () => TerminalMark;
  /** Absolute buffer line of the cursor. */
  cursorLine: () => number;
  /** Text from an absolute buffer line up to the cursor. */
  linesFrom: (line: number, maxLines: number) => string;
  /** A full-screen program (vim, top, less) is running in the alternate buffer. */
  fullscreen: () => boolean;
  /** Time of the last output written to the screen. */
  lastOutput: () => number;
  /** The whole buffer as plain text, wrapped lines joined, at most `maxLines` last lines, without trailing empty lines. */
  allText: (maxLines: number) => string;
}

/** Minimal view of an xterm buffer, so bufferText can be tested without a terminal. */
export interface BufferLike {
  length: number;
  getLine: (index: number) => { isWrapped: boolean; translateToString: (trimRight?: boolean) => string } | undefined;
}

/** Plain text of a whole buffer: wrapped rows are joined into one line, the last `maxLines` lines are kept. */
export function bufferText(buffer: BufferLike, maxLines: number): string {
  const lines: string[] = [];
  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);
    if (!line) continue;
    // A row that the next one continues is full width: its trailing spaces belong to the text.
    const continued = buffer.getLine(index + 1)?.isWrapped === true;
    const text = line.translateToString(!continued);
    if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  return lines.slice(-Math.max(1, maxLines)).join('\n');
}

/**
 * Rows from..to as text for the assistant: wrapped rows are joined into one line, and a range that starts
 * inside a wrapped line starts at its first row. A secret split across rows would escape the masking in main.
 */
export function rangeText(buffer: BufferLike, from: number, to: number): string {
  let start = Math.max(0, from);
  while (start > 0 && buffer.getLine(start)?.isWrapped === true) start -= 1;
  const lines: string[] = [];
  for (let index = start; index <= to; index += 1) {
    const line = buffer.getLine(index);
    const continued = index < to && buffer.getLine(index + 1)?.isWrapped === true;
    const text = line?.translateToString(!continued) ?? '';
    if (line?.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  return lines.join('\n');
}

export function terminalAccess(term: Terminal): TerminalAccess & { dispose: () => void } {
  let last = Date.now();
  const listener = term.onWriteParsed(() => { last = Date.now(); });
  const buffer = () => term.buffer.active;
  const cursorLine = (): number => buffer().baseY + buffer().cursorY;
  const read = (from: number, to: number): string => rangeText(buffer(), from, to);
  return {
    screen: maxLines => read(cursorLine() - maxLines + 1, cursorLine()),
    cursorLine,
    // marker.line is -1 once the line left the scrollback: read from the buffer start then.
    mark: () => { const marker = term.registerMarker(0); return { line: () => Math.max(0, marker.line), dispose: () => marker.dispose() }; },
    linesFrom: (line, maxLines) => read(Math.max(line, cursorLine() - maxLines + 1), cursorLine()),
    fullscreen: () => buffer().type === 'alternate',
    lastOutput: () => last,
    allText: maxLines => bufferText(buffer(), maxLines),
    dispose: () => listener.dispose(),
  };
}
