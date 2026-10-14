import { lookup } from 'node:dns/promises';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { connect } from 'node:net';
import { Client } from 'ssh2';
import type { ConnectionNode, SftpConnectionNode, SshConnectionNode } from '../shared/vault/types';
import type { ConnectionTestResult, ConnectionTestStep } from '../shared/connection-test';
import { isRemoteConnection } from '../shared/vault/connections';
import { sshConnectConfig } from './ssh/client-config';
import { localShellCommand, publicError } from './ssh/session';
import { locateCommand } from './ssh/locate';
import { AI_CLI_TOOLS } from '../shared/ai-cli';

const TIMEOUT = 15_000;

export interface ConnectionTestDependencies {
  verifyHost: (host: string, port: number, key: Buffer, isActive: () => boolean) => Promise<boolean>;
  /** Injected so tests never open network connections. */
  createClient?: () => Client;
  resolve?: (host: string) => Promise<string>;
  probePort?: (host: string, port: number) => Promise<void>;
  locate?: (command: string) => Promise<string | null>;
}

function probe(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); }, 8_000);
    socket.once('connect', () => { clearTimeout(timer); socket.end(); resolve(); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

const resolveHost = async (host: string): Promise<string> => (await lookup(host)).address;

function networkError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Der Hostname ist unbekannt. Prüfe die Schreibweise oder den DNS.';
  if (code === 'ECONNREFUSED') return 'Der Server lehnt die Verbindung auf diesem Port ab.';
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'Keine Antwort. Eine Firewall oder ein falscher Port ist wahrscheinlich.';
  return 'Der Server ist nicht erreichbar.';
}

/** Checks a (possibly unsaved) connection step by step and disconnects right after. Secrets are never returned. */
export async function testConnection(node: ConnectionNode, dependencies: ConnectionTestDependencies): Promise<ConnectionTestResult> {
  const steps: ConnectionTestStep[] = [];
  const done = (): ConnectionTestResult => ({ ok: steps.every(step => step.ok), steps });
  if (!isRemoteConnection(node)) {
    const cwd = node.workingDirectory?.trim() || homedir();
    const folder = await stat(cwd).catch(() => null);
    steps.push(folder?.isDirectory() ? { label: 'Startordner vorhanden', ok: true, detail: cwd } : { label: 'Startordner vorhanden', ok: false, detail: `„${cwd}“ existiert nicht.` });
    if (node.protocol === 'aicli') {
      if (node.tool === 'custom') { steps.push({ label: 'Befehl', ok: true, detail: 'Eigene Befehle werden erst beim Start geprüft.' }); return done(); }
      const tool = AI_CLI_TOOLS[node.tool];
      const found = await (dependencies.locate ?? locateCommand)(tool.command);
      steps.push(found ? { label: `${tool.label} gefunden`, ok: true, detail: found } : { label: `${tool.label} gefunden`, ok: false, detail: `Nicht installiert. Installation: ${tool.install}` });
      return done();
    }
    const { file } = localShellCommand(node.protocol);
    const program = await stat(file).catch(() => null);
    steps.push({ label: 'Programm gefunden', ok: Boolean(program?.isFile()), detail: file });
    return done();
  }
  if (!node.host.trim()) { steps.push({ label: 'Host angegeben', ok: false, detail: 'Bitte gib einen Host ein.' }); return done(); }
  try {
    const address = await (dependencies.resolve ?? resolveHost)(node.host);
    steps.push({ label: 'Name aufgelöst', ok: true, detail: address === node.host ? undefined : `${node.host} → ${address}` });
  } catch (error) { steps.push({ label: 'Name aufgelöst', ok: false, detail: networkError(error) }); return done(); }
  if (node.protocol === 'rdp') {
    try { await (dependencies.probePort ?? probe)(node.host, node.port); steps.push({ label: `Port ${node.port} erreichbar`, ok: true }); }
    catch (error) { steps.push({ label: `Port ${node.port} erreichbar`, ok: false, detail: networkError(error) }); return done(); }
    steps.push({ label: 'Anmeldung', ok: true, detail: 'Benutzer und Passwort prüft der Remotedesktop erst beim Verbinden.' });
    return done();
  }
  if (!node.username?.trim()) { steps.push({ label: 'Benutzer angegeben', ok: false, detail: 'Bitte gib einen Benutzernamen ein.' }); return done(); }
  await testSsh(node, dependencies, steps);
  return done();
}

function testSsh(node: SshConnectionNode | SftpConnectionNode, dependencies: ConnectionTestDependencies, steps: ConnectionTestStep[]): Promise<void> {
  return new Promise(resolve => {
    const client = dependencies.createClient?.() ?? new Client();
    let finished = false;
    let reached = false;
    let keyChecked = false;
    let key: Buffer | undefined;
    const finish = (failure?: { label: string; detail: string }): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      key?.fill(0);
      if (failure) steps.push({ ...failure, ok: false });
      client.destroy();
      resolve();
    };
    const fail = (error: unknown): void => {
      if (!reached) finish({ label: `Port ${node.port} erreichbar`, detail: networkError(error) });
      else if (!keyChecked) finish({ label: 'Server-Schlüssel geprüft', detail: publicError(error) });
      else finish({ label: 'Anmeldung', detail: publicError(error) });
    };
    const timer = setTimeout(() => fail(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT', level: 'client-timeout' })), TIMEOUT);
    client.on('connect', () => { reached = true; steps.push({ label: `Port ${node.port} erreichbar`, ok: true }); });
    client.on('error', fail);
    client.on('close', () => finish());
    client.once('ready', () => {
      steps.push({ label: 'Anmeldung', ok: true, detail: `als ${node.username}` });
      if (node.protocol !== 'sftp') { finish(); return; }
      client.sftp((error, sftp) => {
        if (error) { finish({ label: 'SFTP verfügbar', detail: 'Der Server bietet kein SFTP an.' }); return; }
        sftp.end();
        steps.push({ label: 'SFTP verfügbar', ok: true });
        finish();
      });
    });
    void sshConnectConfig(node, (hostKey, callback) => {
      void dependencies.verifyHost(node.host, node.port, hostKey, () => !finished).then(valid => {
        keyChecked = valid;
        if (valid) steps.push({ label: 'Server-Schlüssel geprüft', ok: true });
        else finish({ label: 'Server-Schlüssel geprüft', detail: 'Der Server-Schlüssel wurde nicht bestätigt.' });
        callback(valid && !finished);
      }).catch(error => { finish({ label: 'Server-Schlüssel geprüft', detail: publicError(error) }); callback(false); });
    }).then(({ config, key: privateKey }) => {
      key = privateKey;
      if (finished) { key?.fill(0); return; }
      client.connect({ ...config, readyTimeout: TIMEOUT, keepaliveInterval: 0 });
    }).catch(error => finish({ label: 'Anmeldedaten gelesen', detail: publicError(error) }));
  });
}
