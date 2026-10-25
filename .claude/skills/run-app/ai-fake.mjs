// OpenAI-compatible chat fake for the run-app screenshots. Loopback only, synthetic key only.
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const AI_KEY = 'sk-synthetic-demo';

const RUN_DIR = process.env.SHELLHERD_RUN_DIR ?? path.join(os.tmpdir(), 'shellherd-run');
const PACKAGE_JSON = path.resolve(import.meta.dirname, '../../../package.json');

// The app detects commands by <command> tags, not by markdown fences.
const ANSWER =
  'Der Dienst läuft, aber die Platte ist zu 42 % belegt. Prüfe die größten Ordner:\n' +
  '<command>du -xh --max-depth=1 /var | sort -h | tail -5</command>';
const TEST_PROMPTS = new Set(['Verbindungstest', 'Connection test']);

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
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/releases/latest') return latestRelease(res, runDir);
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return json(res, 404, 'not found');
    if (req.headers.authorization !== `Bearer ${AI_KEY}`) return json(res, 401, 'Incorrect API key provided');
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      let messages = [];
      try {
        messages = JSON.parse(raw).messages ?? [];
      } catch {
        // malformed body: fall through to the default answer
      }
      const last = [...messages].reverse().find((m) => m?.role === 'user');
      const content = typeof last?.content === 'string' ? last.content.trim() : '';
      stream(req, res, TEST_PROMPTS.has(content) ? 'OK' : ANSWER);
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
