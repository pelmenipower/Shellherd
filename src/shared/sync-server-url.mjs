// Shared browser/Node validation. Plain HTTP is limited to numeric loopback in the dev lab.
export function normalizeSyncServerUrl(input, allowLoopbackHttp = false) {
  if (typeof input !== 'string' || input.length > 2048 || /[\x00-\x1f\x7f]/.test(input)) return null;
  try {
    const url = new URL(input.trim());
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (url.protocol !== 'https:' && !(allowLoopbackHttp && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return url.origin + '/';
  } catch { return null; }
}
