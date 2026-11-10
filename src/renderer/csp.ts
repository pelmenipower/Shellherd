// Content-Security-Policy text for the renderer; injected as <meta> by the vite plugin.
export function contentSecurityPolicy(mode: 'development' | 'production', page: 'main' | 'remoteMedia' = 'main'): string {
  const dev = mode === 'development';
  if (page === 'remoteMedia') return remoteMediaPolicy(dev);
  const script = dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'";
  const connect = dev
    ? "connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*"
    : "connect-src 'self'";
  return [
    "default-src 'none'",
    script,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    'media-src blob: mediastream:',
    connect,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

// Isolated media page: no images, no workers, no network in production.
function remoteMediaPolicy(dev: boolean): string {
  return [
    "default-src 'none'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    // Vite injects CSS via <style> in dev (K23).
    dev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    "font-src 'self' data:",
    'media-src mediastream: blob:',
    dev
      ? "connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*"
      : "connect-src 'none'",
    "img-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
