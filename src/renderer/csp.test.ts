import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './csp';

const PROD = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src blob: mediastream:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

const directive = (csp: string, name: string): string =>
  csp.split('; ').find(d => d.startsWith(`${name} `)) ?? '';

describe('contentSecurityPolicy', () => {
  it('production policy is the literal from the spec', () => {
    expect(contentSecurityPolicy('production')).toBe(PROD);
  });
  it('production script-src has no unsafe-inline/unsafe-eval', () => {
    const s = directive(contentSecurityPolicy('production'), 'script-src');
    expect(s).not.toContain('unsafe-inline');
    expect(s).not.toContain('unsafe-eval');
  });
  it('production has no wildcard and locks object-src and base-uri', () => {
    const csp = contentSecurityPolicy('production');
    expect(csp).not.toContain('*');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });
  it('development allows the dev server and inline preamble', () => {
    const csp = contentSecurityPolicy('development');
    expect(csp).toContain('ws://localhost:*');
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'unsafe-inline'");
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*");
    expect(csp).toContain("object-src 'none'");
  });
});
