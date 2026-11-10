import { REMOTE_LAB_LIMITS, type RemoteSignalPart } from './remote-lab';

const encoder = new TextEncoder();
const KINDS: readonly string[] = ['offer', 'answer', 'bye'];
const FINGERPRINT_LINE = /^a=fingerprint:sha-256 (?:[0-9a-f]{2}:){31}[0-9a-f]{2}$/i;

/** UTF-8 byte length of JSON.stringify(data) without the two quotes: the size the part adds inside the channel frame. */
export function signalBytes(data: string): number {
  return encoder.encode(JSON.stringify(data)).length - 2;
}

export function splitSignal(kind: RemoteSignalPart['kind'], data: string): RemoteSignalPart[] {
  if (kind === 'bye') {
    if (data !== '') throw new Error('signal');
    return [{ kind, part: 1, of: 1, data: '' }];
  }
  if (data === '') throw new Error('signal');
  const chunks: string[] = [];
  let current = '';
  let size = 0;
  // Escapes are per character, so sizes add up per codepoint.
  for (const point of data) {
    const bytes = signalBytes(point);
    if (size + bytes > REMOTE_LAB_LIMITS.signalPart) { chunks.push(current); current = ''; size = 0; }
    current += point;
    size += bytes;
  }
  chunks.push(current);
  if (chunks.length > REMOTE_LAB_LIMITS.signalParts) throw new Error('signal');
  return chunks.map((chunk, index) => ({ kind, part: index + 1, of: chunks.length, data: chunk }));
}

export function isSignalPart(value: unknown): value is RemoteSignalPart {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 4 || !['kind', 'part', 'of', 'data'].every(key => keys.includes(key))) return false;
  const { kind, part, of, data } = value as Record<string, unknown>;
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return false;
  if (!Number.isInteger(part) || !Number.isInteger(of)) return false;
  const p = part as number;
  const o = of as number;
  if (p < 1 || o > REMOTE_LAB_LIMITS.signalParts || p > o) return false;
  if (typeof data !== 'string' || signalBytes(data) > REMOTE_LAB_LIMITS.signalPart) return false;
  return kind !== 'bye' || (o === 1 && data === '');
}

export class SignalCollector {
  private kind: RemoteSignalPart['kind'] | null = null;
  private of = 0;
  private last = 0;
  private chunks: string[] = [];

  push(part: RemoteSignalPart): { kind: RemoteSignalPart['kind']; data: string } | null {
    const valid = this.kind === null
      ? part.part === 1
      : part.part === this.last + 1 && part.kind === this.kind && part.of === this.of;
    if (!valid) { this.reset(); throw new Error('signal'); }
    if (this.kind === null) { this.kind = part.kind; this.of = part.of; }
    this.last = part.part;
    this.chunks.push(part.data);
    if (this.last < this.of) return null;
    const result = { kind: part.kind, data: this.chunks.join('') };
    this.reset();
    return result;
  }

  reset(): void {
    this.kind = null; this.of = 0; this.last = 0; this.chunks = [];
  }
}

export function checkSdp(sdp: string, kind: 'offer' | 'answer'): void {
  const fail = (reason: string): never => { throw new Error(`${kind}: ${reason}`); };
  if (sdp.length > REMOTE_LAB_LIMITS.sdp) fail('too large');
  const lines = sdp.split(/\r?\n/);
  const media = lines.filter(line => line.startsWith('m='));
  if (media.length !== 1 || !media[0]!.startsWith('m=video ')) fail('media');
  const fingerprints = lines.filter(line => line.startsWith('a=fingerprint:'));
  if (fingerprints.length !== 1 || !FINGERPRINT_LINE.test(fingerprints[0]!)) fail('fingerprint');
  if (lines.filter(line => line.startsWith('a=setup:')).length !== 1) fail('fingerprint');
  const directions = lines.filter(line => /^a=(sendrecv|sendonly|recvonly|inactive)$/.test(line));
  if (directions.length !== 1 || directions[0] !== (kind === 'offer' ? 'a=sendonly' : 'a=recvonly')) fail('direction');
  if (lines.some(line => line.startsWith('a=candidate') && line.includes(' typ relay'))) fail('relay');
}

export function formatFingerprint(hex64: string): string {
  if (!/^[a-f0-9]{64}$/.test(hex64)) throw new Error('fingerprint');
  return hex64.match(/.{8}/g)!.join(' ');
}

/** Strips all whitespace, lower-cases; returns exactly REMOTE_LAB_LIMITS.verificationHex hex chars or null. */
export function normalizeVerification(input: string): string | null {
  const text = input.replace(/\s+/g, '').toLowerCase();
  return new RegExp(`^[a-f0-9]{${REMOTE_LAB_LIMITS.verificationHex}}$`).test(text) ? text : null;
}

/** Constant-time (pure JS, XOR accumulator; no node:crypto so the renderer can import it) check of the input against fingerprint.slice(0, REMOTE_LAB_LIMITS.verificationHex). */
export function verifyFingerprintPrefix(input: string, fingerprint: string): boolean {
  const normalized = normalizeVerification(input);
  if (normalized === null || !/^[a-f0-9]{64}$/.test(fingerprint)) return false;
  let diff = 0;
  for (let i = 0; i < REMOTE_LAB_LIMITS.verificationHex; i++) diff |= normalized.charCodeAt(i) ^ fingerprint.charCodeAt(i);
  return diff === 0;
}
