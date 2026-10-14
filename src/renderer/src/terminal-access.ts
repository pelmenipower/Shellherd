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
    dispose: () => listener.dispose(),
  };
}
