import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { screen } from 'electron';
import type { BrowserWindow, Rectangle } from 'electron';
import type { RdpEvent, RdpOpenRequest, RdpSurfaceMode, ViewportRect } from '../../shared/rdp';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';

export interface RdpTarget { host: string; port: number; username?: string; domain?: string; password?: string; clipboard: boolean }

export interface RdpDependencies {
  executable: string;
  mode: RdpSurfaceMode;
  getTarget: (connectionId: string) => RdpTarget;
  emit: (ownerId: number, event: RdpEvent) => void;
}

interface Session {
  id: string;
  ownerId: number;
  window: BrowserWindow;
  bounds: ViewportRect;
  revision: number;
  failed: boolean;
}

/** Splits `DOMAIN\user`; UPNs (`user@domain`) stay a plain user name. */
export function splitAccount(account?: string): { username?: string; domain?: string } {
  const value = account?.trim();
  if (!value) return {};
  const separator = value.indexOf('\\');
  if (separator <= 0) return { username: value };
  return { domain: value.slice(0, separator), username: value.slice(separator + 1) || undefined };
}

/** Converts a renderer viewport rectangle (CSS px) into physical screen pixels. */
export function toScreenRect(window: BrowserWindow, rect: ViewportRect): Rectangle {
  const zoom = window.webContents.getZoomFactor();
  const content = window.getContentBounds();
  const dip = {
    x: Math.round(content.x + rect.x * zoom), y: Math.round(content.y + rect.y * zoom),
    width: Math.max(1, Math.round(rect.width * zoom)), height: Math.max(1, Math.round(rect.height * zoom)),
  };
  const physical = screen.dipToScreenRect(window, dip);
  return { x: Math.round(physical.x), y: Math.round(physical.y), width: Math.round(physical.width), height: Math.round(physical.height) };
}

/** Owns the native RDP helper process and the RDP sessions of all windows. */
export class RdpSessionManager {
  private helper?: ChildProcessWithoutNullStreams;
  private sessions = new Map<string, Session>();
  private tracked = new WeakSet<BrowserWindow>();

  constructor(private readonly dependencies: RdpDependencies) {}

  open(ownerId: number, window: BrowserWindow, request: RdpOpenRequest): { sessionId: string } {
    if (this.sessions.size >= MAX_SSH_SESSIONS) throw new Error(`Maximal ${MAX_SSH_SESSIONS} Sessions gleichzeitig. Schließe zuerst einen Tab.`);
    const target = this.dependencies.getTarget(request.connectionId);
    const session: Session = { id: randomUUID(), ownerId, window, bounds: request.bounds, revision: 0, failed: false };
    this.track(window);
    this.sessions.set(session.id, session);
    const handle = window.getNativeWindowHandle().readBigUInt64LE(0).toString();
    const account = splitAccount(target.username);
    // The password only travels through the private stdin pipe; without one the control asks for credentials.
    this.send({ type: 'open', sessionId: session.id, server: target.host, port: target.port, username: account.username,
      domain: target.domain?.trim() || account.domain, ...(target.password ? { password: target.password } : {}),
      clipboard: target.clipboard, mode: this.dependencies.mode, parent: handle, visible: request.visible, ...toScreenRect(window, request.bounds) });
    return { sessionId: session.id };
  }

  bounds(ownerId: number, id: string, bounds: ViewportRect): void {
    const session = this.owned(ownerId, id);
    session.bounds = bounds;
    this.sendBounds(session);
  }

  visible(ownerId: number, id: string, visible: boolean): void {
    this.send({ type: 'visible', sessionId: this.owned(ownerId, id).id, visible });
  }

  focus(ownerId: number, id: string): void {
    this.send({ type: 'focus', sessionId: this.owned(ownerId, id).id });
  }

  /** Prototype only: blocks the helper UI thread to test whether Terminus stays responsive. */
  debugHang(ownerId: number, ms: number): void {
    if (!this.hasOwner(ownerId)) throw new Error('Keine aktive RDP-Verbindung.');
    this.send({ type: 'debugHang', ms });
  }

  close(ownerId: number, id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.owned(ownerId, id);
    this.send({ type: 'close', sessionId: id });
  }

  closeOwner(ownerId: number): void {
    for (const session of this.sessions.values()) if (session.ownerId === ownerId) this.send({ type: 'close', sessionId: session.id });
  }

  closeAll(): void {
    for (const session of this.sessions.values()) this.send({ type: 'close', sessionId: session.id });
  }

  hasOwner(ownerId: number): boolean { return [...this.sessions.values()].some(session => session.ownerId === ownerId); }

  /** Ends the helper: closing stdin makes it disconnect all sessions and exit; kill as fallback. */
  dispose(): void {
    const helper = this.helper;
    if (!helper) return;
    this.helper = undefined;
    helper.stdin.end();
    setTimeout(() => { if (helper.exitCode === null) helper.kill(); }, 3_000).unref();
  }

  private owned(ownerId: number, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId) throw new Error('Die RDP-Verbindung ist nicht verfügbar.');
    return session;
  }

  private sendBounds(session: Session): void {
    if (session.window.isDestroyed()) return;
    session.revision += 1;
    this.send({ type: 'bounds', sessionId: session.id, revision: session.revision, ...toScreenRect(session.window, session.bounds) });
  }

  /** Window moves change screen coordinates; owned surfaces (variant B) must follow. */
  private track(window: BrowserWindow): void {
    if (this.tracked.has(window)) return;
    this.tracked.add(window);
    const follow = (): void => { for (const session of this.sessions.values()) if (session.window === window) this.sendBounds(session); };
    window.on('move', follow);
    window.on('resize', follow);
  }

  private ensureHelper(): ChildProcessWithoutNullStreams {
    if (this.helper) return this.helper;
    const helper = spawn(this.dependencies.executable, [], { stdio: 'pipe', windowsHide: true, shell: false });
    helper.stdin.on('error', () => { /* exit handler reports the failure */ });
    helper.stderr.resume();
    createInterface({ input: helper.stdout }).on('line', line => this.receive(line));
    const lost = (): void => {
      if (this.helper !== helper) return;
      this.helper = undefined;
      for (const session of this.sessions.values()) {
        this.dependencies.emit(session.ownerId, { type: 'status', sessionId: session.id, status: 'error', message: 'Der RDP-Helfer wurde unerwartet beendet.' });
      }
      this.sessions.clear();
    };
    helper.on('exit', lost);
    helper.on('error', lost);
    this.helper = helper;
    return helper;
  }

  private send(message: Record<string, unknown>): void {
    this.ensureHelper().stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    let message: { type?: string; sessionId?: string; status?: string; message?: string };
    try { message = JSON.parse(line); } catch { return; }
    if (message.type === 'error') { console.warn('RDP-Helfer:', message.message); return; }
    if (message.type !== 'status' || !message.sessionId) return;
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    const emit = (status: RdpEvent['status'], text?: string): void =>
      this.dependencies.emit(session.ownerId, { type: 'status', sessionId: session.id, status, ...(text ? { message: text } : {}) });
    switch (message.status) {
      case 'connecting': emit('connecting'); break;
      case 'loginComplete': emit('connected'); break;
      case 'disconnected': emit('closed', message.message); break;
      case 'error': session.failed = true; emit('error', message.message); break;
      case 'closed':
        this.sessions.delete(session.id);
        if (!session.failed) emit('closed');
        break;
    }
  }
}
