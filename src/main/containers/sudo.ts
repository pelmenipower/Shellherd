import { randomBytes } from 'node:crypto';

/** A fresh token per command; hex only, so sudo's `%` escapes never apply. */
export function createSudoMarker(kind: 'sudo' | 'ready' | 'list'): string {
  return `[terminus-${kind}-${randomBytes(8).toString('hex')}]`;
}

/**
 * Strips sudo's prompt marker and the ready marker from a byte stream until the ready marker
 * appears; from then on everything passes through untouched. Works on latin1 strings so bytes stay
 * exact, and holds back at most marker.length - 1 bytes that could still start a marker.
 */
export class SudoWatcher {
  private held = '';
  private prompts = 0;
  private done = false;
  private readonly tokens: string[];
  constructor(private readonly markers: { prompt?: string; ready?: string }) {
    this.tokens = [markers.prompt, markers.ready].filter((token): token is string => Boolean(token));
    if (!this.tokens.length) throw new Error('No sudo markers');
  }

  /** Prompts seen before readiness. */
  get count(): number { return this.prompts; }
  /** False once the ready marker was seen. */
  get armed(): boolean { return !this.done; }
  get holding(): boolean { return this.held.length > 0; }

  feed(chunk: Buffer): { output: Buffer; prompts: number; ready: boolean } {
    if (this.done) return { output: chunk, prompts: 0, ready: false };
    // One pass over the raw text, so removing a marker never forms a new one.
    const text = this.held + chunk.toString('latin1');
    this.held = '';
    let output = '';
    let prompts = 0;
    let position = 0;
    for (;;) {
      const prompt = this.markers.prompt ? text.indexOf(this.markers.prompt, position) : -1;
      const ready = this.markers.ready ? text.indexOf(this.markers.ready, position) : -1;
      if (ready !== -1 && (prompt === -1 || ready < prompt)) {
        this.done = true;
        this.prompts += prompts;
        output += text.slice(position, ready) + text.slice(ready + this.markers.ready!.length);
        return { output: Buffer.from(output, 'latin1'), prompts, ready: true };
      }
      if (prompt === -1) break;
      output += text.slice(position, prompt);
      prompts++;
      position = prompt + this.markers.prompt!.length;
    }
    this.prompts += prompts;
    const rest = text.slice(position);
    const keep = this.prefixLength(rest);
    this.held = rest.slice(rest.length - keep);
    output += rest.slice(0, rest.length - keep);
    return { output: Buffer.from(output, 'latin1'), prompts, ready: false };
  }

  /** Releases held bytes that never became a marker. */
  flush(): Buffer {
    const held = this.held;
    this.held = '';
    return Buffer.from(held, 'latin1');
  }

  /** Length of the longest end of `text` that could still grow into a marker. */
  private prefixLength(text: string): number {
    for (let keep = Math.min(text.length, Math.max(...this.tokens.map(token => token.length)) - 1); keep > 0; keep--) {
      const tail = text.slice(text.length - keep);
      if (this.tokens.some(token => token.length > keep && token.startsWith(tail))) return keep;
    }
    return 0;
  }
}
