import { utils } from 'ssh2';
import { describe, expect, it } from 'vitest';
import { testHostKey } from './test-host-key';

describe('testHostKey', () => {
  it('always returns a key ssh2 can parse', () => {
    for (let i = 0; i < 500; i++) expect(utils.parseKey(testHostKey())).not.toBeInstanceOf(Error);
  });
});
