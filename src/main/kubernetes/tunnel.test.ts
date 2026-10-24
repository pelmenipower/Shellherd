import { connect, createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { openTunnel } from './tunnel';

describe('openTunnel', () => {
  it('listens on loopback only and pipes each connection to a forwarded channel', async () => {
    const targets: string[] = [];
    const remote = new PassThrough();
    const tunnel = await openTunnel(async (host, port) => { targets.push(`${host}:${port}`); return remote; }, { host: '10.0.0.5', port: 6443 });
    expect(tunnel.port).toBeGreaterThan(0);
    const socket = connect(tunnel.port, '127.0.0.1');
    socket.write('ping');
    const received = await new Promise<string>(resolve => remote.once('data', chunk => resolve(String(chunk))));
    expect(received).toBe('ping');
    expect(targets).toEqual(['10.0.0.5:6443']);
    socket.destroy(); tunnel.close();
  });
  it('closes the local socket when forwarding fails', async () => {
    const tunnel = await openTunnel(async () => { throw new Error('nope'); }, { host: 'h', port: 1 });
    const socket = connect(tunnel.port, '127.0.0.1');
    await new Promise(resolve => socket.once('close', resolve));
    tunnel.close();
  });
  it('stops accepting after close', async () => {
    const tunnel = await openTunnel(async () => new PassThrough(), { host: 'h', port: 1 });
    tunnel.close();
    const socket = connect(tunnel.port, '127.0.0.1');
    await expect(new Promise((_, reject) => socket.once('error', reject))).rejects.toThrow();
  });
  it('listens on the given port', async () => {
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as AddressInfo;
    probe.close();
    const tunnel = await openTunnel(async () => new PassThrough(), { host: 'h', port: 1 }, port);
    expect(tunnel.port).toBe(port);
    tunnel.close();
  });
  it('rejects with the raw listen error when the port is taken', async () => {
    const blocker = createServer();
    await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
    const { port } = blocker.address() as AddressInfo;
    try {
      await expect(openTunnel(async () => new PassThrough(), { host: 'h', port: 1 }, port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      blocker.close();
    }
  });
});
