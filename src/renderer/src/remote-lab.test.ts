import { describe, expect, it } from 'vitest';
import { REMOTE_END_KEYS, REMOTE_ERROR_KEYS, endKey, errorKey, groupFingerprint, secondsLeft } from './remote-lab';

describe('remote-lab helpers', () => {
  it('maps every error code and end reason to a remoteLab key', () => {
    expect(Object.keys(REMOTE_ERROR_KEYS)).toHaveLength(16);
    expect(Object.keys(REMOTE_END_KEYS)).toHaveLength(8);
    for (const [code, key] of Object.entries(REMOTE_ERROR_KEYS)) expect(key).toBe(`remoteLab:errors.${code}`);
    for (const [reason, key] of Object.entries(REMOTE_END_KEYS)) expect(key).toBe(`remoteLab:ended.${reason}`);
    expect(errorKey('limit')).toBe('remoteLab:errors.limit');
    expect(endKey('declined')).toBe('remoteLab:ended.declined');
  });

  it('rounds the remaining seconds up and never goes negative', () => {
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_001, 0)).toBe(11);
    expect(secondsLeft(0, 5_000)).toBe(0);
  });

  it('groups a fingerprint in eight blocks', () => {
    expect(groupFingerprint('a'.repeat(64)).split(' ')).toHaveLength(8);
  });
});
