import { describe, expect, it } from 'vitest';

import { AppError } from '../../shared/errors';
import { helloReady, helloStatusOf, isHelloCancel } from './hello';

describe('Windows Hello in the renderer', () => {
  it('recognizes a canceled prompt, also through IPC', () => {
    expect(isHelloCancel(new AppError('core.helloCanceled'))).toBe(true);
    expect(isHelloCancel(new Error(`Error invoking remote method 'vault:hello-unlock': ${new AppError('core.helloCanceled').message}`))).toBe(true);
    expect(isHelloCancel(new AppError('core.helloStale'))).toBe(false);
    expect(isHelloCancel(new Error('x'))).toBe(false);
  });

  // The cached status counts only for the path it was asked for; a missing path never gets one.
  it('keeps a cached status only for its own vault path', () => {
    const cached = { filePath: 'a.term', status: { available: true, enrolled: true } };
    expect(helloStatusOf(cached, 'a.term')).toEqual(cached.status);
    expect(helloStatusOf(cached, 'b.term')).toBeNull();
    expect(helloStatusOf(cached, null)).toBeNull();
    expect(helloStatusOf(cached, undefined)).toBeNull();
    expect(helloStatusOf(null, 'a.term')).toBeNull();
  });

  it('offers the button only when Windows Hello is set up and the vault enrolled', () => {
    expect(helloReady(null)).toBe(false);
    expect(helloReady({ available: false, enrolled: true })).toBe(false);
    expect(helloReady({ available: true, enrolled: false })).toBe(false);
    expect(helloReady({ available: true, enrolled: true })).toBe(true);
  });
});
