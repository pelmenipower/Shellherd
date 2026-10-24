import { open } from 'node:fs/promises';
import type { Duplex } from 'node:stream';
import type { Client, ConnectConfig } from 'ssh2';
import { AppError } from '../../shared/errors';
import type { ErrorCode } from '../../shared/errors';
import type { AuthPromptField } from '../../shared/ssh';
import { DEFAULT_TIMEOUTS } from '../../shared/vault/timeouts';
import type { ConnectionTimeouts, SftpConnectionNode, SshConnectionNode } from '../../shared/vault/types';
import type { AskPrompts } from './auth-prompts';

/** No SSH agent is available; classified as code 'agent'. */
export class AgentError extends AppError {}

/** Keyboard-interactive rounds per connection; more means the server is broken (spec 3.3). */
const MAX_PROMPT_ROUNDS = 6;
const PASSWORD_QUESTION = /pass(word|wort)|kennwort/i;

export interface KeyboardPrompts { ask: AskPrompts; ownerId?: number; isActive: () => boolean }
export interface ConnectExtras { client?: Client; keyboard?: KeyboardPrompts; sock?: Duplex }

export function agentSocket(platform = process.platform, socket = process.env.SSH_AUTH_SOCK): string {
  if (socket) return socket;
  if (platform === 'win32') return '\\\\.\\pipe\\openssh-ssh-agent';
  throw new AgentError('ssh.noAgent');
}

async function readPrivateKey(path: string): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new AppError('ssh.keyFileUnreadable');
    return await file.readFile();
  } finally { await file.close(); }
}

/** Pure: whether a round may take the stored password (spec 3.3). */
export function autoPasswordAnswer(connection: SshConnectionNode | SftpConnectionNode, fields: AuthPromptField[], used: boolean): string | undefined {
  const { authentication } = connection;
  if (authentication.method !== 'password' || used || fields.length !== 1) return undefined;
  const [field] = fields;
  return !field.echo && PASSWORD_QUESTION.test(field.text) ? authentication.password : undefined;
}

/** Emits the error event (the caller's connect promise rejects with it) unless `code` is absent, then destroys the client. */
function abort(client: Client, code?: ErrorCode): void {
  if (code) client.emit('error', new AppError(code));
  client.destroy();
}

function answerKeyboard(client: Client, connection: SshConnectionNode | SftpConnectionNode, keyboard: KeyboardPrompts): void {
  let rounds = 0;
  let passwordUsed = false;
  client.on('keyboard-interactive', (name, instructions, _language, prompts, finish) => {
    rounds++;
    if (rounds > MAX_PROMPT_ROUNDS) { abort(client, 'ssh.promptInvalid'); return; }
    const fields = prompts.map(prompt => ({ text: prompt.prompt, echo: prompt.echo === true }));
    const stored = autoPasswordAnswer(connection, fields, passwordUsed);
    if (stored !== undefined) { passwordUsed = true; finish([stored]); return; }
    void keyboard.ask({ connectionName: connection.name, host: `${connection.host}:${connection.port}`, title: name, instructions, fields },
      { ownerId: keyboard.ownerId, isActive: keyboard.isActive })
      .catch(() => null)
      .then(answers => {
        if (answers !== null) finish(answers);
        // Inactive means the window or session is gone: nobody to tell.
        else abort(client, keyboard.isActive() ? 'ssh.promptCancelled' : undefined);
      });
  });
}

/**
 * Connection settings shared by terminals, file transfers, containers and tests. The returned key buffer belongs to
 * the caller, which must zero it once the handshake is done.
 */
export async function sshConnectConfig(connection: SshConnectionNode | SftpConnectionNode,
  hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => void,
  timeouts: ConnectionTimeouts = DEFAULT_TIMEOUTS, extras: ConnectExtras = {}): Promise<{ config: ConnectConfig; key?: Buffer }> {
  const { client, keyboard, sock } = extras;
  const config: ConnectConfig = { host: connection.host, port: connection.port,
    username: connection.username, readyTimeout: timeouts.connectSeconds * 1000,
    keepaliveInterval: timeouts.keepaliveSeconds * 1000, keepaliveCountMax: timeouts.keepaliveCount, agentForward: false,
    // Without a handler ssh2 would wait for an answer until readyTimeout.
    tryKeyboard: Boolean(client && keyboard),
    hostVerifier: hostVerifier as ConnectConfig['hostVerifier'] };
  if (sock) config.sock = sock;
  if (client && keyboard) answerKeyboard(client, connection, keyboard);
  const auth = connection.authentication;
  if (auth.method === 'password') config.password = auth.password;
  else if (auth.method === 'agent') config.agent = agentSocket();
  else {
    const key = await readPrivateKey(auth.keyPath);
    config.privateKey = key;
    config.passphrase = auth.passphrase;
    return { config, key };
  }
  return { config };
}
