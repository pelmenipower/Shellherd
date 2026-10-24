// Pure SOCKS5 parsing for the dynamic forward: no auth, CONNECT only.

export type SocksGreeting = { ok: true; rest: Buffer } | { ok: false } | { need: true };
export type SocksRequest = { ok: true; host: string; port: number; rest: Buffer } | { ok: false; reply: number } | { need: true };

/** Accepts only when method 0x00 (no authentication) is offered; the caller answers 05 FF otherwise. */
export function parseGreeting(buffer: Buffer): SocksGreeting {
  if (buffer.length >= 1 && buffer[0] !== 5) return { ok: false };
  if (buffer.length < 2) return { need: true };
  const end = 2 + buffer[1];
  if (buffer.length < end) return { need: true };
  return buffer.subarray(2, end).includes(0) ? { ok: true, rest: buffer.subarray(end) } : { ok: false };
}

/** CONNECT only; ATYP 1 (IPv4), 3 (domain), 4 (IPv6). Other commands reply 0x07, other address types 0x08. */
export function parseRequest(buffer: Buffer): SocksRequest {
  if (buffer.length < 4) return { need: true };
  if (buffer[0] !== 5) return { ok: false, reply: 0x01 };
  if (buffer[1] !== 1) return { ok: false, reply: 0x07 };
  const atyp = buffer[3];
  let addressEnd: number;
  if (atyp === 1) {
    addressEnd = 8;
  } else if (atyp === 3) {
    if (buffer.length < 5) return { need: true };
    if (buffer[4] === 0) return { ok: false, reply: 0x01 };
    addressEnd = 5 + buffer[4];
  } else if (atyp === 4) {
    addressEnd = 20;
  } else {
    return { ok: false, reply: 0x08 };
  }
  if (buffer.length < addressEnd + 2) return { need: true };
  const host = atyp === 1 ? Array.from(buffer.subarray(4, 8)).join('.')
    : atyp === 3 ? buffer.toString('utf8', 5, addressEnd)
    : formatIpv6(buffer.subarray(4, 20));
  return { ok: true, host, port: buffer.readUInt16BE(addressEnd), rest: buffer.subarray(addressEnd + 2) };
}

/** 10-byte reply (VER, REP, RSV, ATYP 1, 0.0.0.0, port 0). */
export function reply(code: number): Buffer {
  return Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]);
}

/** Lowercase hex groups, the longest run of two or more zero groups becomes `::` (RFC 5952). */
function formatIpv6(bytes: Buffer): string {
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(i));
  let start = -1;
  let length = 1;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) { i++; continue; }
    let end = i;
    while (end < 8 && groups[end] === 0) end++;
    if (end - i > length) { start = i; length = end - i; }
    i = end;
  }
  const hex = groups.map(group => group.toString(16));
  if (start < 0) return hex.join(':');
  return `${hex.slice(0, start).join(':')}::${hex.slice(start + length).join(':')}`;
}
