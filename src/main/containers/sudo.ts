import { randomBytes } from 'node:crypto';

/** A fresh sudo prompt per command; hex only, so sudo's `%` escapes never apply. */
export function createSudoMarker(): string {
  return `[terminus-sudo-${randomBytes(8).toString('hex')}]`;
}

/**
 * Removes sudo prompt markers from a byte stream and counts them. Works on latin1 strings so
 * bytes stay exact; holds back at most marker.length - 1 bytes that could still start a marker.
 */
export class SudoPromptWatcher {
  private held = '';
  private seen = 0;
  constructor(private readonly marker: string) {
    if (!marker) throw new Error('Empty sudo marker');
  }

  /** Prompts seen so far. */
  get count(): number { return this.seen; }
  get holding(): boolean { return this.held.length > 0; }

  feed(chunk: Buffer): { output: Buffer; prompts: number } {
    const parts = (this.held + chunk.toString('latin1')).split(this.marker);
    const prompts = parts.length - 1;
    this.seen += prompts;
    const text = parts.join('');
    let keep = Math.min(this.marker.length - 1, text.length);
    while (keep > 0 && !this.marker.startsWith(text.slice(text.length - keep))) keep--;
    this.held = text.slice(text.length - keep);
    return { output: Buffer.from(text.slice(0, text.length - keep), 'latin1'), prompts };
  }

  /** Releases held bytes that never became a marker. */
  flush(): Buffer {
    const held = this.held;
    this.held = '';
    return Buffer.from(held, 'latin1');
  }
}
