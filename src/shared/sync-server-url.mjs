// Shared browser/Node validation (pure JS, no node:* imports). Plain HTTP is limited to numeric loopback
// in the dev lab and, with explicit opt-in, to numeric private/tunnel addresses.
export function isPrivateTunnelAddress(hostname) {
  if (typeof hostname !== 'string') return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (v4) {
    if (v4.slice(1).some((o) => (o.length > 1 && o.startsWith('0')) || Number(o) > 255)) return false;
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = /^\[?([0-9a-f]{1,4}):/i.exec(hostname);
  if (!v6) return false;
  return (parseInt(v6[1], 16) & 0xfe00) === 0xfc00;
}

export function normalizeSyncServerUrl(input, options = false) {
  if (typeof input !== 'string' || input.length > 2048 || /[\x00-\x1f\x7f]/.test(input)) return null;
  const opts = options === true ? { loopback: true } : options && typeof options === 'object' ? options : {};
  const loopback = opts.loopback === true;
  const priv = opts.private === true;
  try {
    const url = new URL(input.trim());
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (url.protocol === 'http:') {
      const ok = (loopback && ['127.0.0.1', '[::1]'].includes(url.hostname)) || (priv && isPrivateTunnelAddress(url.hostname));
      if (!ok) return null;
    } else if (url.protocol !== 'https:') return null;
    return url.origin + '/';
  } catch { return null; }
}

export function needsPrivateNetwork(input) {
  return normalizeSyncServerUrl(input, { private: true }) !== null && normalizeSyncServerUrl(input, { loopback: true }) === null;
}
