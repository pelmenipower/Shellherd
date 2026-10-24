import { describe, expect, it } from 'vitest';
import { MAX_LINK_LENGTH, webLinkHref } from './links';

describe('webLinkHref', () => {
  it('keeps http and https links and returns their normalized href', () => {
    expect(webLinkHref('https://example.org/a?b=1')).toBe('https://example.org/a?b=1');
    expect(webLinkHref('HTTP://Example.org')).toBe('http://example.org/');
  });

  it('refuses every other scheme', () => {
    for (const bad of ['file:///C:/x', 'javascript:alert(1)', 'data:text/html,x', 'ftp://h/', 'mailto:a@b.c']) {
      expect(webLinkHref(bad)).toBeNull();
    }
  });

  it('refuses user or password in the URL', () => {
    expect(webLinkHref('https://u:p@h/')).toBeNull();
    expect(webLinkHref('https://u@h/')).toBeNull();
  });

  it('refuses non-strings, text that is no URL and links over the length limit', () => {
    expect(webLinkHref(null)).toBeNull();
    expect(webLinkHref(42)).toBeNull();
    expect(webLinkHref('kein link')).toBeNull();
    expect(MAX_LINK_LENGTH).toBe(2048);
    expect(webLinkHref(`https://example.org/${'a'.repeat(2048 - 'https://example.org/'.length)}`)).not.toBeNull();
    expect(webLinkHref(`https://example.org/${'a'.repeat(2049 - 'https://example.org/'.length)}`)).toBeNull();
  });
});
