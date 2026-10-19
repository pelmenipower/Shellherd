import type { Terminal } from '@xterm/xterm';

/** Read access to a terminal for the assistant: text and cursor only, never input. */
export interface TerminalAccess {
  /** The last lines up to the cursor, without trailing empty lines. */
  screen: (maxLines: number) => string;
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

export function terminalAccess(term: Terminal): TerminalAccess & { dispose: () => void } {
  let last = Date.now();
  const listener = term.onWriteParsed(() => { last = Date.now(); });
  const buffer = () => term.buffer.active;
  const cursorLine = (): number => buffer().baseY + buffer().cursorY;
  const read = (from: number, to: number): string => {
    const lines: string[] = [];
    for (let index = Math.max(0, from); index <= to; index += 1) lines.push(buffer().getLine(index)?.translateToString(true) ?? '');
    while (lines.length && !lines.at(-1)!.trim()) lines.pop();
    return lines.join('\n');
  };
  return {
    screen: maxLines => read(cursorLine() - maxLines + 1, cursorLine()),
    cursorLine,
    linesFrom: (line, maxLines) => read(Math.max(line, cursorLine() - maxLines + 1), cursorLine()),
    fullscreen: () => buffer().type === 'alternate',
    lastOutput: () => last,
    allText: maxLines => bufferText(buffer(), maxLines),
    dispose: () => listener.dispose(),
  };
}
