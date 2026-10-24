import { describe, expect, it } from 'vitest';
import { parseGreeting, parseRequest, reply } from './socks5';

describe('parseGreeting', () => {
  it('needs more bytes while the greeting is incomplete', () => {
    expect(parseGreeting(Buffer.alloc(0))).toEqual({ need: true });
    expect(parseGreeting(Buffer.from([5]))).toEqual({ need: true });
    expect(parseGreeting(Buffer.from([5, 2, 0]))).toEqual({ need: true });
  });
  it('accepts when method 0x00 is offered and keeps the following bytes', () => {
    const result = parseGreeting(Buffer.from([5, 2, 2, 0, 9]));
    expect(result).toEqual({ ok: true, rest: Buffer.from([9]) });
  });
  it('rejects when 0x00 is not offered', () => {
    expect(parseGreeting(Buffer.from([5, 1, 2]))).toEqual({ ok: false });
    expect(parseGreeting(Buffer.from([5, 0]))).toEqual({ ok: false });
  });
  it('rejects other versions', () => {
    expect(parseGreeting(Buffer.from([4, 1, 0]))).toEqual({ ok: false });
  });
});

describe('parseRequest', () => {
  const head = (atyp: number, ...rest: number[]) => Buffer.from([5, 1, 0, atyp, ...rest]);

  it('needs more bytes while the request is incomplete', () => {
    expect(parseRequest(Buffer.from([5, 1, 0]))).toEqual({ need: true });
    expect(parseRequest(head(1, 1, 2, 3))).toEqual({ need: true });
    expect(parseRequest(head(3, 11, 0x61))).toEqual({ need: true });
    expect(parseRequest(head(4, 0, 0))).toEqual({ need: true });
  });
  it('parses an IPv4 CONNECT', () => {
    const result = parseRequest(Buffer.from([5, 1, 0, 1, 10, 0, 0, 5, 0x1f, 0x90]));
    expect(result).toEqual({ ok: true, host: '10.0.0.5', port: 8080, rest: Buffer.alloc(0) });
  });
  it('parses a domain CONNECT and keeps bytes after the request', () => {
    const domain = Buffer.from('example.com');
    const buffer = Buffer.concat([Buffer.from([5, 1, 0, 3, domain.length]), domain, Buffer.from([0, 80]), Buffer.from('GET')]);
    expect(parseRequest(buffer)).toEqual({ ok: true, host: 'example.com', port: 80, rest: Buffer.from('GET') });
  });
  it('rejects an empty domain', () => {
    expect(parseRequest(Buffer.from([5, 1, 0, 3, 0, 0, 80]))).toEqual({ ok: false, reply: 0x01 });
  });
  it('parses an IPv6 CONNECT as a canonical string', () => {
    const address = Buffer.alloc(16);
    address.writeUInt16BE(0x2001, 0); address.writeUInt16BE(0x0db8, 2); address.writeUInt16BE(1, 14);
    const result = parseRequest(Buffer.concat([Buffer.from([5, 1, 0, 4]), address, Buffer.from([0x01, 0xbb])]));
    expect(result).toEqual({ ok: true, host: '2001:db8::1', port: 443, rest: Buffer.alloc(0) });
  });
  it('formats the loopback IPv6 address and a zero-free address in full', () => {
    const loopback = Buffer.alloc(16); loopback[15] = 1;
    expect(parseRequest(Buffer.concat([Buffer.from([5, 1, 0, 4]), loopback, Buffer.from([0, 22])]))).toMatchObject({ host: '::1' });
    const full = Buffer.alloc(16);
    for (let i = 0; i < 8; i++) full.writeUInt16BE(0x1000 + i, i * 2);
    expect(parseRequest(Buffer.concat([Buffer.from([5, 1, 0, 4]), full, Buffer.from([0, 22])]))).toMatchObject({ host: '1000:1001:1002:1003:1004:1005:1006:1007' });
  });
  it('replies 0x07 to commands other than CONNECT', () => {
    expect(parseRequest(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]))).toEqual({ ok: false, reply: 0x07 });
    expect(parseRequest(Buffer.from([5, 3, 0, 1]))).toEqual({ ok: false, reply: 0x07 });
  });
  it('replies 0x08 to an unknown address type', () => {
    expect(parseRequest(Buffer.from([5, 1, 0, 9]))).toEqual({ ok: false, reply: 0x08 });
  });
  it('replies 0x01 to another version', () => {
    expect(parseRequest(Buffer.from([4, 1, 0, 1, 1, 2, 3, 4, 0, 80]))).toEqual({ ok: false, reply: 0x01 });
  });
});

describe('reply', () => {
  it('builds a 10-byte reply with 0.0.0.0:0', () => {
    expect(reply(0x05)).toEqual(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
    expect(reply(0x00).length).toBe(10);
  });
});
