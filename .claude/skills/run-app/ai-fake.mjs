// OpenAI-compatible chat fake for the run-app screenshots. Loopback only, synthetic key only.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const AI_KEY = 'sk-synthetic-demo';

// Synthetic secrets for the masking scene, split so secret scanners stay quiet. Never real values.
const join = (...parts) => parts.join('');
export const DEMO_SECRETS = {
  dbPassword: 'Synth-Pass-4711',
  apiToken: 'synth-token-0815-abcdef',
  awsKeyId: join('AK', 'IA', 'SYNTHETIC0000000'),
  awsSecret: 'synthAWSsecret00000000000000000000000000',
  github: join('gh', 'p_', 'SyntheticDemoToken000000000000000000'),
  slack: join('xo', 'xb-', '0000000000-SyntheticSlack'),
  openai: join('sk', '-proj-', 'SyntheticDemoKey00000000000'),
  jwt: join('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJkZW1vIn0', '.', 'c3ludGhldGljLXNpZ25hdHVyZQ'),
  urlPassword: 'Synth-Url-Pass',
  bearer: 'synthBearerToken0000000000',
  azureKey: 'U3ludGhldGljQWNjb3VudEtleTAwMDA=',
  pemBody: 'c3ludGhldGljLWRlbW8ta2V5LWJvZHktbm90LWEtcmVhbC1rZXk=',
  // Vault values of the demo setup: web-01's password and the Demo-KI key.
  vaultPassword: 'synthetic-demo',
  vaultApiKey: AI_KEY,
};
/** Must reach the fake unchanged: hashes, commit ids and uuids are no secrets. */
export const DEMO_KEPT = ['3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f', 'sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae', '0b5e3f9a-6c1d-4e2b-8f7a-9d3c2b1a0e4f'];
/** Output of `cat ~/.env` on the demo server (sshd.mjs). */
export const DEMO_ENV = [
  '# Synthetic demo data only',
  `DB_PASSWORD=${DEMO_SECRETS.dbPassword}`,
  `API_TOKEN="${DEMO_SECRETS.apiToken}"`,
  `AWS_ACCESS_KEY_ID=${DEMO_SECRETS.awsKeyId}`,
  `aws_secret_access_key = ${DEMO_SECRETS.awsSecret}`,
  `GITHUB_TOKEN=${DEMO_SECRETS.github}`,
  `SLACK_BOT=${DEMO_SECRETS.slack}`,
  `OPENAI=${DEMO_SECRETS.openai}`,
  `SESSION=${DEMO_SECRETS.jwt}`,
  `DATABASE_URL=postgres://app:${DEMO_SECRETS.urlPassword}@db.intranet.demo:5432/app`,
  `AUTH_HEADER='Authorization: Bearer ${DEMO_SECRETS.bearer}'`,
  `AZURE_STORAGE=DefaultEndpointsProtocol=https;AccountName=demo;AccountKey=${DEMO_SECRETS.azureKey};EndpointSuffix=core.windows.net`,
  `# Notfallzugang: demo / ${DEMO_SECRETS.vaultPassword}`,
  `AI_KEY=${DEMO_SECRETS.vaultApiKey}`,
  'DEPLOY_KEY:',
  join('-----BEGIN OPENSSH ', 'PRIVATE KEY-----'),
  DEMO_SECRETS.pemBody,
  join('-----END OPENSSH ', 'PRIVATE KEY-----'),
  `GIT_COMMIT=${DEMO_KEPT[0]}`,
  `IMAGE_DIGEST=${DEMO_KEPT[1]}`,
  `REQUEST_ID=${DEMO_KEPT[2]}`,
].join('\n');
/** Every chat request body the fake received, one JSON line each; headers are never written. */
export const AI_REQUEST_LOG = 'ai-requests.jsonl';

const RUN_DIR = process.env.SHELLHERD_RUN_DIR ?? path.join(os.tmpdir(), 'shellherd-run');
const PACKAGE_JSON = path.resolve(import.meta.dirname, '../../../package.json');

// The app detects commands by <command> tags, not by markdown fences.
const ANSWER =
  'Der Dienst läuft, aber die Platte ist zu 42 % belegt. Prüfe die größten Ordner:\n' +
  '<command>du -xh --max-depth=1 /var | sort -h | tail -5</command>';
// Answer to a Kubernetes analysis: one reading and one changing command, so the scene can check that neither gets a button.
const KUBE_ANSWER =
  'Der Container main beendet sich mit Exit-Code 1: Laut Log des vorherigen Containers ist die Datenbank db.shop.svc:5432 nicht erreichbar (connection refused). Prüfe zuerst den Datenbank-Service:\n' +
  '<command>kubectl -n shop get endpoints db</command>\n' +
  'Ändert den Cluster: Ein Neustart hilft erst, wenn die Datenbank erreichbar ist.\n' +
  '<command>kubectl -n shop rollout restart deployment/checkout</command>';
const TEST_PROMPTS = new Set(['Verbindungstest', 'Connection test']);
// Answers with the first placeholder it sees, like a model that keeps [SECRET_n] unchanged.
const maskedAnswer = secret => `Die Anmeldung an der Datenbank scheitert. Teste den Zugang:\n<command>PGPASSWORD='${secret}' psql -h db.intranet.demo -U app -c 'select 1'</command>`;

const json = (res, status, message) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message } }));
};

// Split into deltas of 6-12 characters (tags may be cut, the app's parser copes).
function chunks(text) {
  const out = [];
  for (let i = 0, n = 0; i < text.length; i += n) {
    n = 6 + (out.length % 7);
    out.push(text.slice(i, i + n));
  }
  return out;
}

function stream(req, res, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const parts = chunks(text);
  const timer = setInterval(() => {
    const part = parts.shift();
    if (part === undefined) {
      clearInterval(timer);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    const chunk = { id: 'chatcmpl-demo', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: part } }] };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }, 40);
  res.on('close', () => clearInterval(timer));
}

// Stands in for GitHub's releases/latest. With RUN_DIR/update-available it offers the next minor version.
function latestRelease(res, runDir) {
  const { version } = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
  const [major, minor] = version.split('.').map(Number);
  const offered = existsSync(path.join(runDir, 'update-available')) ? `${major}.${minor + 1}.0` : version;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ tag_name: `v${offered}`, draft: false, prerelease: false }));
}

export async function startAiFake({ port = 9335, runDir = RUN_DIR } = {}) {
  mkdirSync(runDir, { recursive: true });
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/releases/latest') return latestRelease(res, runDir);
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return json(res, 404, 'not found');
    if (req.headers.authorization !== `Bearer ${AI_KEY}`) return json(res, 401, 'Incorrect API key provided');
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      appendFileSync(path.join(runDir, AI_REQUEST_LOG), `${raw.replace(/[\r\n]+/g, ' ')}\n`);
      let messages = [];
      try {
        messages = JSON.parse(raw).messages ?? [];
      } catch {
        // malformed body: fall through to the default answer
      }
      const last = [...messages].reverse().find((m) => m?.role === 'user');
      const content = typeof last?.content === 'string' ? last.content.trim() : '';
      const secret = /\[SECRET_\d+\]/.exec(content)?.[0];
      const system = messages.find((m) => m?.role === 'system')?.content ?? '';
      const kube = typeof system === 'string' && /Kubernetes-Assistent|Kubernetes assistant/.test(system);
      stream(req, res, TEST_PROMPTS.has(content) ? 'OK' : kube ? KUBE_ANSWER : secret ? maskedAnswer(secret) : ANSWER);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    port: server.address().port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const { port } = await startAiFake({ port: Number(process.env.AI_FAKE_PORT ?? 9335) });
  console.log(`ai-fake ready on ${port}`);
}
