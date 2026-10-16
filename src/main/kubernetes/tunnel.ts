import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';

export interface Tunnel { readonly port: number; close(): void }

/** Local listener on 127.0.0.1 that carries every connection through the SSH host to target. */
export function openTunnel(forward: (host: string, port: number) => Promise<Duplex>, target: { host: string; port: number }): Promise<Tunnel> {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.pause();
    forward(target.host, target.port).then(channel => {
      if (socket.destroyed) { channel.destroy(); return; }
      channel.on('error', () => socket.destroy());
      socket.on('close', () => channel.destroy());
      channel.on('close', () => socket.destroy());
      socket.pipe(channel).pipe(socket);
      socket.resume();
    }, () => socket.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('Der lokale Tunnel konnte nicht starten.')); return; }
      resolve({ port: address.port, close() { server.close(); for (const socket of sockets) socket.destroy(); } });
    });
  });
}
