import { utils } from 'ssh2';

/** Host key for test servers. ssh2 generates an ed25519 key its own parser rejects about 1 in 300 times, so draw again until it parses. */
export function testHostKey(): string {
  for (;;) {
    const key = utils.generateKeyPairSync('ed25519').private;
    if (!(utils.parseKey(key) instanceof Error)) return key;
  }
}
