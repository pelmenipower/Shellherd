// OpenAI-compatible chat fake for the run-app screenshots. Loopback only, synthetic key only.
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const AI_KEY = 'sk-synthetic-demo';

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

export async function startAiFake({ port = 9335 } = {}) {
  const server = http.createServer((req, res) => {
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
