import { open } from 'node:fs/promises';
import type { ConnectConfig } from 'ssh2';
import type { SftpConnectionNode, SshConnectionNode } from '../../shared/vault/types';

/** No SSH agent is available; classified as code 'agent'. */
export class AgentError extends Error {}

export function agentSocket(platform = process.platform, socket = process.env.SSH_AUTH_SOCK): string {
  if (socket) return socket;
  if (platform === 'win32') return '\\\\.\\pipe\\openssh-ssh-agent';
  throw new AgentError('Kein SSH-Agent gefunden. Starte einen Agent oder wähle eine andere Authentifizierung.');
}

async function readPrivateKey(path: string): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid key file');
    return await file.readFile();
  } finally { await file.close(); }
}

/**
 * Connection settings shared by terminals and file transfers. The returned key buffer belongs to
 * the caller, which must zero it once the handshake is done.
 */
export async function sshConnectConfig(connection: SshConnectionNode | SftpConnectionNode,
  hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => void): Promise<{ config: ConnectConfig; key?: Buffer }> {
  const config: ConnectConfig = { host: connection.host, port: connection.port,
    username: connection.username, readyTimeout: 120_000, keepaliveInterval: 15_000,
    keepaliveCountMax: 3, agentForward: false, tryKeyboard: false,
    hostVerifier: hostVerifier as ConnectConfig['hostVerifier'] };
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
