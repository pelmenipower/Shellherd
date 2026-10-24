import { lookup } from 'node:dns/promises';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { connect } from 'node:net';
import { Client } from 'ssh2';
import type { ConnectionNode, SftpConnectionNode, SshConnectionNode } from '../shared/vault/types';
import type { ConnectionTestResult, ConnectionTestStep } from '../shared/connection-test';
import type { CodedError } from '../shared/errors';
import { isRemoteConnection } from '../shared/vault/connections';
import { sshConnectConfig } from './ssh/client-config';
import type { AskPrompts } from './ssh/auth-prompts';
import type { Jump } from './ssh/jump';
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
  /** SSH step timeout in ms; paused while the host key dialog or a sign-in question is open. */
  timeout?: number;
  /** Sign-in questions of the server; without it keyboard-interactive is not offered. */
  ask?: AskPrompts;
  /** Opens the jump host of the connection; undefined without one. */
  openJump?: (node: SshConnectionNode | SftpConnectionNode) => Promise<Jump | undefined>;
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

function networkError(error: unknown): CodedError {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { code: 'core.testHostUnknown' };
  if (code === 'ECONNREFUSED') return { code: 'core.testConnectionRefused' };
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return { code: 'core.testNoResponse' };
  return { code: 'core.testUnreachable' };
}

/** Checks a (possibly unsaved) connection step by step and disconnects right after. Secrets are never returned. */
export async function testConnection(node: ConnectionNode, dependencies: ConnectionTestDependencies): Promise<ConnectionTestResult> {
  const steps: ConnectionTestStep[] = [];
  const done = (): ConnectionTestResult => ({ ok: steps.every(step => step.ok), steps });
  if (node.protocol === 'kubernetes') { steps.push({ step: 'clusterTest', ok: false, note: { code: 'core.testClusterUnsupported' } }); return done(); }
  if (!isRemoteConnection(node)) {
    const cwd = node.workingDirectory?.trim() || homedir();
    const folder = await stat(cwd).catch(() => null);
    steps.push(folder?.isDirectory() ? { step: 'startFolder', ok: true, detail: cwd } : { step: 'startFolder', ok: false, note: { code: 'core.testFolderMissing', params: { path: cwd } } });
    if (node.protocol === 'aicli') {
      if (node.tool === 'custom') { steps.push({ step: 'command', ok: true, note: { code: 'core.testCustomCommand' } }); return done(); }
      const tool = AI_CLI_TOOLS[node.tool];
      const found = await (dependencies.locate ?? locateCommand)(tool.command);
      const params = { tool: tool.label };
      steps.push(found ? { step: 'toolFound', params, ok: true, detail: found }
        : { step: 'toolFound', params, ok: false, note: { code: 'core.testNotInstalled', params: { install: tool.install } } });
      return done();
    }
    const { file } = localShellCommand(node.protocol);
    const program = await stat(file).catch(() => null);
    steps.push({ step: 'programFound', ok: Boolean(program?.isFile()), detail: file });
    return done();
  }
  if (!node.host.trim()) { steps.push({ step: 'hostGiven', ok: false, note: { code: 'core.testHostMissing' } }); return done(); }
  // Behind a jump host the far side resolves the target, so no local lookup (spec 4.4).
  const sshNode = node.protocol === 'ssh' || node.protocol === 'sftp' ? node : undefined;
  const openJump = sshNode?.jumpHost ? dependencies.openJump : undefined;
  if (!openJump) {
    try {
      const address = await (dependencies.resolve ?? resolveHost)(node.host);
      steps.push({ step: 'nameResolved', ok: true, detail: address === node.host ? undefined : `${node.host} → ${address}` });
    } catch (error) { steps.push({ step: 'nameResolved', ok: false, note: networkError(error) }); return done(); }
  }
  if (node.protocol === 'rdp') {
    try { await (dependencies.probePort ?? probe)(node.host, node.port); steps.push({ step: 'portReachable', params: { port: node.port }, ok: true }); }
    catch (error) { steps.push({ step: 'portReachable', params: { port: node.port }, ok: false, note: networkError(error) }); return done(); }
    steps.push({ step: 'login', ok: true, note: { code: 'core.testRdpCredentials' } });
    return done();
  }
  if (!node.username?.trim()) { steps.push({ step: 'userGiven', ok: false, note: { code: 'core.testUserMissing' } }); return done(); }
  if (sshNode?.jumpHost && openJump) {
    const name = sshNode.jumpHost;
    let jump: Jump | undefined;
    try { jump = await openJump(sshNode); }
    catch (error) { steps.push({ step: 'jumpHost', ok: false, params: { name }, note: publicError(error) }); return done(); }
    if (!jump) { steps.push({ step: 'jumpHost', ok: false, params: { name }, note: { code: 'ssh.jumpHostMissing', params: { id: name } } }); return done(); }
    steps.push({ step: 'jumpHost', ok: true, params: { name: jump.name } });
    await testSsh(sshNode, dependencies, steps, jump);
    return done();
  }
  await testSsh(node, dependencies, steps);
  return done();
}

function testSsh(node: SshConnectionNode | SftpConnectionNode, dependencies: ConnectionTestDependencies, steps: ConnectionTestStep[],
  jump?: Jump): Promise<void> {
  return new Promise(resolve => {
    const client = dependencies.createClient?.() ?? new Client();
    let finished = false;
    let reached = false;
    let keyChecked = false;
    let key: Buffer | undefined;
    const finish = (failure?: Pick<ConnectionTestStep, 'step' | 'params' | 'note'>): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      key?.fill(0);
      if (failure) steps.push({ ...failure, ok: false });
      client.destroy();
      jump?.close();
      resolve();
    };
    const fail = (error: unknown): void => {
      if (!reached) finish({ step: 'portReachable', params: { port: node.port }, note: networkError(error) });
      else if (!keyChecked) finish({ step: 'hostKey', note: publicError(error) });
      else finish({ step: 'login', note: publicError(error) });
    };
    const timeout = dependencies.timeout ?? TIMEOUT;
    const startTimer = (): NodeJS.Timeout => setTimeout(() => fail(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT', level: 'client-timeout' })), timeout);
    let timer = startTimer();
    const resume = (): void => { if (!finished) timer = startTimer(); };
    // A sign-in question may take as long as the user needs, like the host key dialog.
    const ask = dependencies.ask;
    const askPaused: AskPrompts | undefined = ask && ((request, options) => {
      clearTimeout(timer);
      return ask(request, options).finally(resume);
    });
    client.on('connect', () => { reached = true; steps.push({ step: 'portReachable', params: { port: node.port }, ok: true }); });
    client.on('error', fail);
    client.on('close', () => finish());
    client.once('ready', () => {
      steps.push({ step: 'login', ok: true, detail: node.username });
      if (node.protocol !== 'sftp') { finish(); return; }
      client.sftp((error, sftp) => {
        if (error) { finish({ step: 'sftp', note: { code: 'core.testNoSftp' } }); return; }
        sftp.end();
        steps.push({ step: 'sftp', ok: true });
        finish();
      });
    });
    void sshConnectConfig(node, (hostKey, callback) => {
      clearTimeout(timer); // the user may take as long as needed in the dialog
      void dependencies.verifyHost(node.host, node.port, hostKey, () => !finished).then(valid => {
        resume();
        keyChecked = valid;
        if (valid) steps.push({ step: 'hostKey', ok: true });
        else finish({ step: 'hostKey', note: { code: 'core.testHostKeyRejected' } });
        callback(valid && !finished);
      }).catch(error => { resume(); finish({ step: 'hostKey', note: publicError(error) }); callback(false); });
    }, undefined, { client, keyboard: askPaused ? { ask: askPaused, isActive: () => !finished } : undefined, sock: jump?.sock })
      .then(({ config, key: privateKey }) => {
        key = privateKey;
        if (finished) { key?.fill(0); return; }
        client.connect({ ...config, readyTimeout: 120_000, /* our timer governs; ssh2's would fire during the host key dialog */ keepaliveInterval: 0 });
      }).catch(error => finish({ step: 'credentials', note: publicError(error) }));
  });
}
