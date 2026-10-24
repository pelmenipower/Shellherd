import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTerminalLink } from './terminal-links';

const openExternal = vi.fn(() => Promise.resolve());
Object.assign(globalThis, { window: { desktopApi: { openExternal } } });

afterEach(() => openExternal.mockClear());

describe('openTerminalLink', () => {
  it('opens http(s) links only with Ctrl held', () => {
    openTerminalLink({ ctrlKey: true }, 'https://example.org/a');
    expect(openExternal).toHaveBeenCalledWith('https://example.org/a');
    openTerminalLink({ ctrlKey: false }, 'https://example.org/a');
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it('ignores other protocols and credentials', () => {
    openTerminalLink({ ctrlKey: true }, 'file:///C:/x');
    openTerminalLink({ ctrlKey: true }, 'javascript:alert(1)');
    openTerminalLink({ ctrlKey: true }, 'https://u:p@h/');
    expect(openExternal).not.toHaveBeenCalled();
  });
});
