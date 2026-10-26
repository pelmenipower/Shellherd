export const MAX_LINK_LENGTH = 2048;
/** Normalized href of an http(s) link without user or password, else null. Used by renderer and main. */
export function webLinkHref(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_LINK_LENGTH) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.href;
}
