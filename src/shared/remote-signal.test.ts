import { describe, expect, it } from 'vitest';
import { REMOTE_LAB_LIMITS, type RemoteSignalPart } from './remote-lab';
import { SignalCollector, checkSdp, formatFingerprint, isSignalPart, normalizeVerification, signalBytes, splitSignal, verifyFingerprintPrefix } from './remote-signal';

const fp = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(':');
const sdp = (extra: string[] = [], media = 'm=video 9 UDP/TLS/RTP/SAVPF 96', direction = 'a=sendonly'): string =>
  ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', `a=fingerprint:sha-256 ${fp}`, 'a=setup:actpass', media, direction, ...extra, ''].join('\r\n');
const answerSdp = (extra: string[] = []): string => sdp(extra, undefined, 'a=recvonly');

describe('signalBytes', () => {
  it('counts the JSON-escaped UTF-8 size without quotes', () => {
    expect(signalBytes('abc')).toBe(3);
    expect(signalBytes('\r\n')).toBe(4);
    expect(signalBytes('\u0001')).toBe(6);
    expect(signalBytes('"')).toBe(2);
    expect(signalBytes('ä')).toBe(2);
    expect(signalBytes('😀')).toBe(4);
  });
});

describe('splitSignal', () => {
  it('returns one part for small data, 1-based', () => {
    expect(splitSignal('offer', 'x')).toEqual([{ kind: 'offer', part: 1, of: 1, data: 'x' }]);
  });
  it('builds a bye part', () => {
    expect(splitSignal('bye', '')).toEqual([{ kind: 'bye', part: 1, of: 1, data: '' }]);
    expect(() => splitSignal('bye', 'x')).toThrow();
  });
  it('rejects empty offer/answer', () => {
    expect(() => splitSignal('offer', '')).toThrow();
    expect(() => splitSignal('answer', '')).toThrow();
  });
  it('splits at the limit and reassembles', () => {
    const data = 'a'.repeat(6144 * 2 + 1);
    const parts = splitSignal('answer', data);
    expect(parts.map(p => p.part)).toEqual([1, 2, 3]);
    expect(parts.every(p => p.of === 3 && signalBytes(p.data) <= 6144)).toBe(true);
    expect(parts.map(p => p.data).join('')).toBe(data);
  });
  it('accepts exactly 4 full parts and rejects more', () => {
    expect(splitSignal('offer', 'a'.repeat(6144 * 4))).toHaveLength(4);
    expect(() => splitSignal('offer', 'a'.repeat(6144 * 4 + 1))).toThrow();
  });
  it('never splits a surrogate pair and counts escapes', () => {
    const data = '😀'.repeat(3000); // 4 bytes each
    const parts = splitSignal('offer', data);
    for (const p of parts) { expect(signalBytes(p.data)).toBeLessThanOrEqual(6144); expect(p.data).toBe([...p.data].join('')); expect(/[\ud800-\udbff]$/.test(p.data)).toBe(false); }
    expect(parts.map(p => p.data).join('')).toBe(data);
    const crlf = splitSignal('offer', '\r\n'.repeat(5000));
    expect(crlf.every(p => signalBytes(p.data) <= 6144)).toBe(true);
    expect(crlf.map(p => p.data).join('')).toBe('\r\n'.repeat(5000));
  });
  it('keeps the channel frame under 8192 bytes for a 23 KiB SDP with many CRLF (K1)', () => {
    const big = (`a=x ${'y'.repeat(40)}\r\n`).repeat(Math.floor((23 * 1024) / 46));
    for (const kind of ['offer', 'answer'] as const) {
      const parts = splitSignal(kind, big);
      for (const part of parts) expect(Buffer.byteLength(JSON.stringify({ kind: 'data', value: { part: { ...part, part: 4, of: 4 } } }))).toBeLessThanOrEqual(8192);
    }
  });
});

describe('isSignalPart', () => {
  const ok: RemoteSignalPart = { kind: 'offer', part: 1, of: 2, data: 'x' };
  it('accepts valid parts', () => {
    expect(isSignalPart(ok)).toBe(true);
    expect(isSignalPart({ kind: 'bye', part: 1, of: 1, data: '' })).toBe(true);
  });
  it('rejects malformed values', () => {
    for (const bad of [null, 'x', 7, [], { ...ok, kind: 'nope' }, { ...ok, part: 0 }, { ...ok, part: 3 }, { ...ok, of: 5 }, { ...ok, part: 1.5 }, { ...ok, data: 7 },
      { ...ok, extra: 1 }, { kind: 'offer', part: 1, of: 1 }, { ...ok, data: 'a'.repeat(6145) },
      { kind: 'bye', part: 1, of: 2, data: '' }, { kind: 'bye', part: 1, of: 1, data: 'x' }]) expect(isSignalPart(bad)).toBe(false);
  });
});

describe('SignalCollector', () => {
  const p = (part: number, of: number, data: string, kind: RemoteSignalPart['kind'] = 'offer'): RemoteSignalPart => ({ kind, part, of, data });
  it('collects in order and resets', () => {
    const c = new SignalCollector();
    expect(c.push(p(1, 2, 'a'))).toBeNull();
    expect(c.push(p(2, 2, 'b'))).toEqual({ kind: 'offer', data: 'ab' });
    expect(c.push(p(1, 1, 'z', 'answer'))).toEqual({ kind: 'answer', data: 'z' });
  });
  it('throws on a first part other than 1, gap, duplicate, kind or of change, and resets afterwards', () => {
    const c = new SignalCollector();
    expect(() => c.push(p(2, 2, 'a'))).toThrow();
    c.push(p(1, 3, 'a')); expect(() => c.push(p(3, 3, 'c'))).toThrow();
    c.push(p(1, 3, 'a')); expect(() => c.push(p(1, 3, 'a'))).toThrow();
    c.push(p(1, 3, 'a')); expect(() => c.push(p(2, 3, 'b', 'answer'))).toThrow();
    c.push(p(1, 3, 'a')); expect(() => c.push(p(2, 2, 'b'))).toThrow();
    expect(c.push(p(1, 1, 'ok'))).toEqual({ kind: 'offer', data: 'ok' });
  });
  it('reset() drops partial state', () => {
    const c = new SignalCollector(); c.push(p(1, 2, 'a')); c.reset();
    expect(c.push(p(1, 1, 'x'))).toEqual({ kind: 'offer', data: 'x' });
  });
});

describe('checkSdp', () => {
  it('accepts a minimal valid SDP', () => {
    expect(() => checkSdp(sdp(), 'offer')).not.toThrow();
    expect(() => checkSdp(answerSdp(['a=candidate:1 1 udp 1 192.168.0.2 5000 typ host']), 'answer')).not.toThrow();
    expect(() => checkSdp(sdp().replace('sha-256', 'SHA-256').toUpperCase().replace('M=VIDEO', 'm=video'), 'offer')).not.toThrow;
  });
  it('rejects oversize', () => { expect(() => checkSdp(sdp(['a=' + 'x'.repeat(REMOTE_LAB_LIMITS.sdp)]), 'offer')).toThrow(); });
  it('rejects zero or several m= lines', () => {
    expect(() => checkSdp(`v=0\r\na=fingerprint:sha-256 ${fp}\r\n`, 'offer')).toThrow();
    expect(() => checkSdp(sdp(['m=video 9 UDP/TLS/RTP/SAVPF 96']), 'offer')).toThrow();
  });
  it('rejects a non-video m= line', () => {
    expect(() => checkSdp(sdp([], 'm=audio 9 UDP/TLS/RTP/SAVPF 111'), 'offer')).toThrow();
    expect(() => checkSdp(sdp([], 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel'), 'offer')).toThrow();
  });
  it('rejects a missing or malformed sha-256 fingerprint', () => {
    expect(() => checkSdp(sdp().replace(/a=fingerprint.*\r\n/, ''), 'offer')).toThrow();
    expect(() => checkSdp(sdp().replace('sha-256', 'sha-1'), 'offer')).toThrow();
    expect(() => checkSdp(sdp().replace(/:[0-9a-f]{2}\r\n/, '\r\n'), 'offer')).toThrow();
  });
  it('requires exactly one a=fingerprint: line of any algorithm', () => {
    const line = `a=fingerprint:sha-256 ${fp}`;
    expect(() => checkSdp(sdp().replace('\r\n' + 'a=setup', `\r\n${line}\r\na=setup`), 'offer')).toThrow('fingerprint');
    expect(() => checkSdp(sdp(['a=fingerprint:sha-1 AA:BB']), 'offer')).toThrow('fingerprint');
    expect(() => checkSdp(answerSdp(['a=fingerprint:sha-512 AA:BB']), 'answer')).toThrow('fingerprint');
  });
  it('requires exactly one a=setup: line', () => {
    expect(() => checkSdp(sdp().replace('a=setup:actpass\r\n', ''), 'offer')).toThrow('fingerprint');
    expect(() => checkSdp(sdp(['a=setup:active']), 'offer')).toThrow('fingerprint');
  });
  it('rejects relay candidates', () => {
    expect(() => checkSdp(answerSdp(['a=candidate:1 1 udp 1 10.0.0.1 5000 typ relay raddr 0.0.0.0 rport 0']), 'answer')).toThrow();
  });
  it('requires exactly one direction line: a=sendonly for an offer, a=recvonly for an answer (V4)', () => {
    expect(() => checkSdp(sdp(), 'offer')).not.toThrow();
    expect(() => checkSdp(answerSdp(), 'answer')).not.toThrow();
    for (const bad of ['a=sendrecv', 'a=inactive', 'a=recvonly']) expect(() => checkSdp(sdp([], undefined, bad), 'offer')).toThrow('direction');
    for (const bad of ['a=sendrecv', 'a=inactive', 'a=sendonly']) expect(() => checkSdp(sdp([], undefined, bad), 'answer')).toThrow('direction');
    expect(() => checkSdp(sdp([], undefined, ''), 'offer')).toThrow('direction');
    expect(() => checkSdp(sdp(['a=sendrecv']), 'offer')).toThrow('direction');
    expect(() => checkSdp(sdp(['a=sendonly']), 'offer')).toThrow('direction');
    expect(() => checkSdp(answerSdp(['a=inactive']), 'answer')).toThrow('direction');
  });
  it('accepts LF-only line endings', () => { expect(() => checkSdp(sdp().replace(/\r\n/g, '\n'), 'offer')).not.toThrow(); });
});

describe('formatFingerprint', () => {
  it('groups 64 hex chars into 8 groups of 8', () => {
    const hex = 'abcdef0123456789'.repeat(4);
    expect(formatFingerprint(hex)).toBe('abcdef01 23456789 abcdef01 23456789 abcdef01 23456789 abcdef01 23456789');
  });
  it('rejects invalid input', () => {
    for (const bad of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64)]) expect(() => formatFingerprint(bad)).toThrow();
  });
});

describe('normalizeVerification', () => {
  it('strips whitespace and lower-cases to exactly 16 hex chars', () => {
    expect(normalizeVerification('ABCD EF01\t2345 6789\n')).toBe('abcdef0123456789');
    expect(normalizeVerification('aaaaaaaa bbbbbbbb')).toBe('aaaaaaaabbbbbbbb');
    expect(REMOTE_LAB_LIMITS.verificationHex).toBe(16);
  });
  it('rejects wrong length or non-hex', () => {
    for (const bad of ['', 'abcdef012345678', 'abcdef01234567890', 'abcdef012345', 'abcdef012345678g', 'abcdef012345678é']) expect(normalizeVerification(bad)).toBeNull();
  });
});

describe('verifyFingerprintPrefix', () => {
  const fingerprint = 'abcdef0123456789' + '6789abcdef01'.repeat(4);
  it('matches the normalized 16-char prefix', () => {
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyFingerprintPrefix('abcdef0123456789', fingerprint)).toBe(true);
    expect(verifyFingerprintPrefix(' ABCD ef01 2345 6789 ', fingerprint)).toBe(true);
  });
  it('rejects a deviation anywhere in chars 13 to 16, bad input and bad fingerprints', () => {
    for (const bad of ['abcdef012346' + '6789', 'abcdef0123556789', 'abcdef0123466789', 'abcdef0123456788']) expect(verifyFingerprintPrefix(bad, fingerprint)).toBe(false);
    expect(verifyFingerprintPrefix('bbcdef0123456789', fingerprint)).toBe(false);
    expect(verifyFingerprintPrefix('abcdef012345', fingerprint)).toBe(false);
    expect(verifyFingerprintPrefix('abcdef0123456789', fingerprint.slice(1))).toBe(false);
    expect(verifyFingerprintPrefix('abcdef0123456789', fingerprint.toUpperCase())).toBe(false);
  });
});

describe('REMOTE_LAB_LIMITS', () => {
  it('has a 20 s handshake budget', () => {
    expect(REMOTE_LAB_LIMITS.handshakeMs).toBe(20000);
  });
});
