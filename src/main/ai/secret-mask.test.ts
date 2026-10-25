import { describe, expect, it } from 'vitest';
import type { Vault, VaultNode } from '../../shared/vault/types';
import { MAX_NUMBERS, MAX_STORED_CHARS, SecretMasker, vaultLiterals } from './secret-mask';

// Test secrets are assembled from parts so GitHub secret scanning stays quiet (R13). Never real values.
const j = (...parts: string[]): string => parts.join('');
const one = (text: string): string => new SecretMasker().mask(text, []).text;

const BEGIN_OPENSSH = j('-----BEGIN OPENSSH ', 'PRIVATE KEY-----');
const END_OPENSSH = j('-----END OPENSSH ', 'PRIVATE KEY-----');
const BEGIN_RSA = j('-----BEGIN', ' RSA PRIVATE KEY-----');
const END_RSA = j('-----END', ' RSA PRIVATE KEY-----');
const PGP_BEGIN = j('-----BEGIN', ' PGP PRIVATE KEY BLOCK-----');
const PGP_END = j('-----END', ' PGP PRIVATE KEY BLOCK-----');

// The values of the demo fixture (run-app ai-fake.mjs, DEMO_SECRETS), rebuilt here without importing the .mjs file.
const SYNTHETIC = {
  dbPassword: 'Synth-Pass-4711',
  apiToken: 'synth-token-0815-abcdef',
  awsKeyId: j('AK', 'IA', 'SYNTHETIC0000000'),
  awsSecret: 'synthAWSsecret00000000000000000000000000',
  github: j('gh', 'p_', 'SyntheticDemoToken000000000000000000'),
  slack: j('xo', 'xb-', '0000000000-SyntheticSlack'),
  openai: j('sk', '-proj-', 'SyntheticDemoKey00000000000'),
  jwt: j('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJkZW1vIn0', '.', 'c3ludGhldGljLXNpZ25hdHVyZQ'),
  urlPassword: 'Synth-Url-Pass',
  bearer: 'synthBearerToken0000000000',
  azureKey: 'U3ludGhldGljQWNjb3VudEtleTAwMDA=',
  pemBody: 'c3ludGhldGljLWRlbW8ta2V5LWJvZHktbm90LWEtcmVhbC1rZXk=',
  vaultPassword: 'synthetic-demo',
  vaultApiKey: 'sk-synthetic-demo',
};
const KEPT = ['3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f', `sha256:${'2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae'}`, '0b5e3f9a-6c1d-4e2b-8f7a-9d3c2b1a0e4f'];
const DEMO_ENV = [
  '# Synthetic demo data only',
  `DB_PASSWORD=${SYNTHETIC.dbPassword}`,
  `API_TOKEN="${SYNTHETIC.apiToken}"`,
  `AWS_ACCESS_KEY_ID=${SYNTHETIC.awsKeyId}`,
  `aws_secret_access_key = ${SYNTHETIC.awsSecret}`,
  `GITHUB_TOKEN=${SYNTHETIC.github}`,
  `SLACK_BOT=${SYNTHETIC.slack}`,
  `OPENAI=${SYNTHETIC.openai}`,
  `SESSION=${SYNTHETIC.jwt}`,
  `DATABASE_URL=postgres://app:${SYNTHETIC.urlPassword}@db.intranet.demo:5432/app`,
  `AUTH_HEADER='Authorization: Bearer ${SYNTHETIC.bearer}'`,
  `AZURE_STORAGE=DefaultEndpointsProtocol=https;AccountName=demo;AccountKey=${SYNTHETIC.azureKey};EndpointSuffix=core.windows.net`,
  `# Notfallzugang: demo / ${SYNTHETIC.vaultPassword}`,
  `AI_KEY=${SYNTHETIC.vaultApiKey}`,
  'DEPLOY_KEY:',
  BEGIN_OPENSSH,
  SYNTHETIC.pemBody,
  END_OPENSSH,
  `GIT_COMMIT=${KEPT[0]}`,
  `IMAGE_DIGEST=${KEPT[1]}`,
  `REQUEST_ID=${KEPT[2]}`,
].join('\n');

const vaultOf = (nodes: unknown[], ai?: unknown): Vault => ({ nodes, ai }) as unknown as Vault;

describe('SecretMasker', () => {
  it('hides every synthetic secret of the demo fixture and keeps hashes, commit ids and uuids', () => {
    const { text, numbers } = new SecretMasker().mask(DEMO_ENV, ['sk-synthetic-demo', 'synthetic-demo']);
    expect(Object.entries(SYNTHETIC).filter(([, value]) => text.includes(value)).map(([name]) => name)).toEqual([]);
    for (const value of KEPT) expect(text).toContain(value);
    expect(numbers.size).toBe(14);
  });

  it('masks each token form alone and inside a sentence', () => {
    const tokens = [
      j('AK', 'IA', 'SYNTHETIC0000000'),
      j('gh', 'p_', 'a'.repeat(36)),
      j('github', '_pat_', 'A'.repeat(22)),
      j('xo', 'xb-', '0000000000'),
      j('sk', '-ant-', 'a'.repeat(20)),
      j('sk', '-proj-', 'a'.repeat(20)),
      j('AI', 'za', 'a'.repeat(35)),
      j('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJkZW1vIn0', '.', 'c2ln'),
      j('LS0tLS1CRUdJTi', 'A'.repeat(16)),
    ];
    for (const token of tokens) {
      expect(one(token)).toBe('[SECRET_1]');
      expect(one(`x ${token} y`)).toBe('x [SECRET_1] y');
    }
  });

  it('masks a Slack webhook path', () => {
    expect(one(j('https://hooks', '.slack.com/services/', 'T0000000/B0000000/', 'x'.repeat(24)))).toBe('https://hooks.slack.com/services/[SECRET_1]');
  });

  it('masks an Azure SAS signature', () => {
    expect(one('https://acc.blob.core.windows.net/c?sv=2020&sig=abcdefghijklmnop1234')).toBe('https://acc.blob.core.windows.net/c?sv=2020&sig=[SECRET_1]');
  });

  it('masks each named value rule', () => {
    expect(one('DB_PASSWORD=x9Kq2abcdef')).toBe('DB_PASSWORD=[SECRET_1]');
    expect(one('"password": "p\\"w"')).toBe('"password": "[SECRET_1]"');
    expect(one("export PGPASSWORD='s3cret value'")).toBe("export PGPASSWORD='[SECRET_1]'");
    expect(one('Server=db;User Id=sa;Password=Pa55w0rd!;')).toBe('Server=db;User Id=sa;Password=[SECRET_1];');
    expect(one('--from-literal=password=abc123')).toBe('--from-literal=password=[SECRET_1]');
    expect(one('mysql --password hunter22 -h db')).toBe('mysql --password [SECRET_1] -h db');
    expect(one('$env:API_KEY = "abc12345"')).toBe('$env:API_KEY = "[SECRET_1]"');
    expect(one('x-api-key: abcdef123')).toBe('x-api-key: [SECRET_1]');
    expect(one('Authorization: Basic dXNlcjpwYXNz')).toBe('Authorization: Basic [SECRET_1]');
    expect(one(`Authorization: Bearer ${'a'.repeat(20)}`)).toBe('Authorization: Bearer [SECRET_1]');
    expect(one('postgres://app:pw@db/x')).toBe('postgres://app:[SECRET_1]@db/x');
  });

  it('masks only the body of a complete private key block', () => {
    expect(one(`${BEGIN_RSA}\nMIIEowIBAAKCAQEAabcdefgh\nQWERTYUIOPASDFGHJK\n${END_RSA}\nok`)).toBe(`${BEGIN_RSA}\n[SECRET_1]\n${END_RSA}\nok`);
  });

  it('masks a cut-off private key block up to the end of the text', () => {
    expect(one(`${BEGIN_RSA}\nMIIEowIBAAKCAQEAabcdefgh\nQWERT`)).toBe(`${BEGIN_RSA}\n[SECRET_1]`);
  });

  it('masks the base64 lines above an END line whose BEGIN has scrolled away', () => {
    expect(one(`$ cat key\nMIIEowIBAAKCAQEAabcdefgh\nQWERTYUIOPASDFGHJK\n${END_RSA}`)).toBe(`$ cat key\n[SECRET_1]\n${END_RSA}`);
  });

  it('masks a PGP private key block', () => {
    expect(one(`${PGP_BEGIN}\n\nlQOYBGabcdefghijklmnop\n=abcd\n${PGP_END}`)).toBe(`${PGP_BEGIN}\n\n[SECRET_1]\n${PGP_END}`);
  });

  it('masks data values of a Kubernetes secret and keeps the metadata', () => {
    const secret = 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: db-auth\ndata:\n  username: YWRtaW4=\n  host: ZGIuaW50cmFuZXQ=\ntype: Opaque\n';
    expect(one(secret)).toBe('apiVersion: v1\nkind: Secret\nmetadata:\n  name: db-auth\ndata:\n  username: [SECRET_1]\n  host: [SECRET_2]\ntype: Opaque\n');
  });

  it('keeps data values of a ConfigMap, which is not a secret', () => {
    const configMap = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: db-auth\ndata:\n  username: YWRtaW4=\n  host: ZGIuaW50cmFuZXQ=\ntype: Opaque\n';
    expect(one(configMap)).toBe(configMap);
  });

  it('masks a block value under stringData and keeps the block indicator', () => {
    expect(one('kind: Secret\nstringData:\n  config.yaml: |\n    host: db\n    plainline-secret-value-here\n')).toBe('kind: Secret\nstringData:\n  config.yaml: |\n    host: [SECRET_1]\n    [SECRET_2]\n');
  });

  it('keeps texts that look like secrets but are not', () => {
    const kept = [
      'max_tokens: 4000',
      'token_count: 12',
      'secretName: my-secret',
      'password_min_length: 8',
      '[sudo] password for demo:',
      'Password: ',
      'bypass: true',
      'password=${DB_PASS}',
      'password: <dein Passwort>',
      'password: ***',
      'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      `sha256:${'ab'.repeat(32)}`,
      '0b5e3f9a-6c1d-4e2b-8f7a-9d3c2b1a0e4f',
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPlaceholderKeyDataOnly demo@host',
      'https://user@host/x',
      'git log 3f2a9c1',
    ];
    for (const text of kept) expect(one(text)).toBe(text);
  });

  it('numbers placeholders per value in order of first appearance and keeps them stable', () => {
    const masker = new SecretMasker();
    expect(masker.mask('password=abc123', []).text).toBe('password=[SECRET_1]');
    expect(masker.mask('again password=abc123', []).text).toBe('again password=[SECRET_1]');
    expect(masker.mask('password=zzz999', []).text).toBe('password=[SECRET_2]');
  });

  it('masks a known value later in the same conversation even without a pattern', () => {
    const masker = new SecretMasker();
    masker.mask('DB_PASSWORD=Synth-Pass-4711', []);
    expect(masker.mask('mysql -pSynth-Pass-4711', []).text).toBe('mysql -p[SECRET_1]');
  });

  it('does not search for known values shorter than six characters', () => {
    const masker = new SecretMasker();
    masker.mask('password=abcde', []);
    expect(masker.mask('x abcde y', []).text).toBe('x abcde y');
  });

  it('replaces the longest literal first and reports the numbers used', () => {
    const literals = ['sk-synthetic-demo', 'synthetic-demo'];
    expect(new SecretMasker().mask('sk-synthetic-demo and synthetic-demo', literals).text).toBe('[SECRET_1] and [SECRET_2]');
    expect(new SecretMasker().mask('x sk-synthetic-demo y', literals).text).toBe('x [SECRET_1] y');
    expect([...new SecretMasker().mask('sk-synthetic-demo and synthetic-demo', literals).numbers]).toEqual([1, 2]);
  });

  it('never replaces a value inside an existing placeholder (K2)', () => {
    const masker = new SecretMasker();
    expect(masker.mask('password=SECRET', []).text).toBe('password=[SECRET_1]');
    expect(masker.mask('token=abcdefgh and SECRET', []).text).toBe('token=[SECRET_2] and [SECRET_1]');
  });

  it('keeps an angle-bracket hint such as <your password> unchanged (K1)', () => {
    expect(one('password: <dein Passwort>')).toBe('password: <dein Passwort>');
  });

  it('keeps the known-value list bounded: old finds drop out after 1000 newer ones (K4)', () => {
    const masker = new SecretMasker();
    masker.mask('DB_PASSWORD=first-secret-0', []);
    const flood = (lines: number): string => Array.from({ length: lines }, (_, index) => `pwd=other-${String(index).padStart(4, '0')}`).join('\n');
    masker.mask(flood(1000), []);
    expect(masker.mask('x first-secret-0', []).text).toBe('x first-secret-0');
    const bounded = new SecretMasker();
    bounded.mask('DB_PASSWORD=first-secret-0', []);
    bounded.mask(flood(999), []);
    expect(bounded.mask('x first-secret-0', []).text).toBe('x [SECRET_1]');
  });

  it('keeps every hostile 256 KiB input under one second', () => {
    const units = [
      'a', 'eyJ', 'eyJa.', '-----BEGIN ', '-----END A PRIVATE KEY-----\n', 'password=', 'password: "', 'password=x ',
      'a://', 'a://b:c', 'x:', '"', 'sk-', '--password ', '--token=', '\n', 'AAAAAAAAAAAAAAAAAAAAAAAA\n', 'Bearer ',
      'Authorization: Basic ', 'LS0tLS1CRUdJTi', 'a.', 'a-', 'kind: Secret\ndata:\n  a: b\n', '[SECRET_1]', 'AKIA', 'ghp_',
      'password=<', 'password: <aaaa ', 'kind: Secret\nstringData:\n  a: |\n    bbbbbbbbbbbbbbbbbbbb\n', 'password=SECRET ', 'SECRET',
      'login ', 'ConvertTo-SecureString "', 'glpat-', 'npm_', 'sk_live_',
    ];
    for (const unit of units) {
      const text = unit.repeat(Math.ceil(262_144 / unit.length)).slice(0, 262_144);
      const start = performance.now();
      new SecretMasker().mask(text, []);
      expect(performance.now() - start, JSON.stringify(unit.slice(0, 20))).toBeLessThan(1000);
    }
  }, 60_000);

  it('masks 1000 vault literals in 256 KiB under one second', () => {
    const literals = Array.from({ length: 1000 }, (_, index) => `lit-${String(index).padStart(4, '0')}`);
    const text = 'plain text without any value '.repeat(12_000).slice(0, 262_144);
    const start = performance.now();
    new SecretMasker().mask(text, literals);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('stays under one second per turn when a conversation floods known values (K4)', () => {
    const masker = new SecretMasker();
    // Two turns of 20 000 new values stay below the per-conversation cap (M-2); the cap has its own test.
    for (let turn = 0; turn < 2; turn += 1) {
      const text = Array.from({ length: 20_000 }, (_, index) => `pwd=${turn}t${String(index).padStart(6, 'x')}`).join(' ').slice(0, 262_144);
      const start = performance.now();
      masker.mask(text, []);
      expect(performance.now() - start).toBeLessThan(1000);
    }
  }, 60_000);

  it('stays under 250 ms per round for 60 rounds of 40 messages with new values (M-2)', () => {
    const masker = new SecretMasker();
    for (let round = 0; round < 60; round += 1) {
      const start = performance.now();
      for (let message = 0; message < 40; message += 1) {
        const text = Array.from({ length: 10 }, (_, index) => `pwd=r${round}m${message}v${index}-value`).join('\n');
        masker.mask(text, []);
      }
      expect(performance.now() - start, `round ${round}`).toBeLessThan(250);
    }
  }, 60_000);

  it('refuses new values beyond the cap but still masks known and vault values (M-2)', () => {
    const masker = new SecretMasker();
    const batch = (n: number): string => Array.from({ length: 10 }, (_, index) => `pwd=cap${n}x${index}-value`).join('\n');
    for (let n = 0; n < MAX_NUMBERS / 10; n += 1) masker.mask(batch(n), []);
    expect(() => masker.mask(batch(MAX_NUMBERS / 10), [])).toThrow();
    expect(masker.mask(`x cap${MAX_NUMBERS / 10 - 1}x9-value`, []).text).toMatch(/^x \[SECRET_\d+\]$/);
    expect(masker.mask('vault secret-vault-value', ['secret-vault-value']).text).toMatch(/^vault \[SECRET_\d+\]$/);
  }, 60_000);

  it('masks GitLab, Stripe and npm tokens', () => {
    const tokens = [j('gl', 'pat-', 'a'.repeat(20)), j('sk', '_live_', 'a'.repeat(24)), j('rk', '_live_', 'a'.repeat(24)), j('npm', '_', 'a'.repeat(36))];
    for (const token of tokens) {
      expect(one(token)).toBe('[SECRET_1]');
      expect(one(`x ${token} y`)).toBe('x [SECRET_1] y');
    }
  });

  it('keeps look-alikes of the GitLab, Stripe and npm forms', () => {
    const kept = [
      j('gl', 'pat-', 'a'.repeat(19)),
      j('x', 'glpat-', 'a'.repeat(20)),
      j('sk', '_test_', 'a'.repeat(24)),
      j('pk', '_live_', 'a'.repeat(24)),
      j('npm', '_', 'a'.repeat(35)),
      'npm_config_cache',
    ];
    for (const text of kept) expect(one(text)).toBe(text);
  });

  it('masks the password of a .netrc entry', () => {
    expect(one('machine db login app password Synth-Pw-123')).toBe('machine db login app password [SECRET_1]');
    expect(one('default login app password Synth-Pw-123\n')).toBe('default login app password [SECRET_1]\n');
  });

  it('refuses to remember more than MAX_STORED_CHARS of found text', () => {
    const masker = new SecretMasker();
    const long = (n: number) => `password=${String(n).padStart(6, '0')}${'x'.repeat(4000)}`;
    let rounds = 0;
    expect(() => { for (; rounds < 400; rounds += 1) masker.mask(long(rounds), []); }).toThrow();
    expect(rounds * 4006).toBeGreaterThan(MAX_STORED_CHARS - 4006);
    // Vault values are never refused, even past the cap.
    expect(masker.mask('Synth-Vault-Pw', ['Synth-Vault-Pw']).text).toMatch(/^\[SECRET_\d+\]$/);
  });

  it('masks the password of a multi-line .netrc entry', () => {
    const netrc = 'machine db.intranet\n  login app\n  password Synth-Pw-123\n\nmachine git\n\tlogin ci\n\tpassword Synth-Pw-456\n';
    expect(one(netrc)).toBe('machine db.intranet\n  login app\n  password [SECRET_1]\n\nmachine git\n\tlogin ci\n\tpassword [SECRET_2]\n');
  });

  it('keeps a password line outside a .netrc block', () => {
    const kept = ['Welcome\npassword reset done', 'machine db\n\npassword reset done', 'Password for root: '];
    for (const text of kept) expect(one(text)).toBe(text);
  });

  it('keeps .netrc lines without a password and other password prompts', () => {
    const kept = ['machine db login app', '[sudo] password for demo:', 'Login: admin', 'Password: '];
    for (const text of kept) expect(one(text)).toBe(text);
  });

  it('masks the string of ConvertTo-SecureString, not the flag before it', () => {
    const secure = j('ConvertTo-Secure', 'String');
    expect(one(`${secure} "Synth-Pw-123" -AsPlainText -Force`)).toBe(`${secure} "[SECRET_1]" -AsPlainText -Force`);
    expect(one(`-Password (${secure} -String "Synth-Pw-123")`)).toBe(`-Password (${secure} -String "[SECRET_1]")`);
  });

  it('keeps ConvertTo-SecureString without a literal string', () => {
    const secure = j('ConvertTo-Secure', 'String');
    const kept = [`${secure} $pw -AsPlainText -Force`, `${secure} "$pw" -AsPlainText -Force`];
    for (const text of kept) expect(one(text)).toBe(text);
  });
});

describe('vaultLiterals', () => {
  it('collects passwords, passphrases, RDP passwords and API keys, longest first, with the URL-encoded form', () => {
    const vault = vaultOf([
      { id: 'f1', type: 'folder', name: 'Ordner', children: [
        { id: 'f2', type: 'folder', name: 'tief', children: [{ id: 'a', protocol: 'ssh', authentication: { method: 'password', password: 'p@ss word!' } }] },
      ] },
      { id: 'b', protocol: 'sftp', authentication: { method: 'privateKey', keyPath: 'k', passphrase: 'phrase-123' } },
      { id: 'c', protocol: 'rdp', password: 'rdp-pass-1' },
      { id: 'd', protocol: 'ssh', authentication: { method: 'password', password: 'short' } },
      { id: 'e', protocol: 'ssh', authentication: { method: 'password', password: '        ' } },
    ], { providers: [{ id: 'p', name: 'P', kind: 'openai', model: 'm', apiKey: 'sk-key-123456' }], defaultProviderId: 'p' });
    expect(vaultLiterals(vault)).toEqual(['p%40ss%20word!', 'sk-key-123456', 'p@ss word!', 'phrase-123', 'rdp-pass-1']);
  });

  it('returns nothing without AI settings and without passwords', () => {
    expect(vaultLiterals(vaultOf([{ id: 'a', protocol: 'ssh', authentication: { method: 'agent' } }] as VaultNode[]))).toEqual([]);
  });
});
