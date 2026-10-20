import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { screen } from 'electron';
import type { BrowserWindow, Rectangle } from 'electron';
import { AppError, truncateDetail } from '../../shared/errors';
import type { CodedError } from '../../shared/errors';
import type { RdpAction, RdpEvent, RdpOpenRequest, RdpStatus, RdpSurfaceMode, ViewportRect } from '../../shared/rdp';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';

/** Set SHELLHERD_RDP_DEBUG=1 to log helper traffic; passwords are masked. */
const debug = process.env.SHELLHERD_RDP_DEBUG === '1';
const timestamp = (): string => new Date().toISOString().slice(11, 23);

export interface RdpTarget{ host: string; port: number; username?: string; domain?: string; password?: string; clipboard: boolean }

export interface RdpDependencies {
  executable: string;
  mode: RdpSurfaceMode;
  getTarget: (connectionId: string) => RdpTarget;
  emit: (ownerId: number, event: RdpEvent) => void;
}

interface Session {
  id: string;
  connectionId: string;
  ownerId: number;
  window: BrowserWindow;
  bounds: ViewportRect;
  revision: number;
  /** Last screen rectangle sent; identical updates from renderer and window events are skipped. */
  sentBounds?: string;
  failed: boolean;
  status: RdpStatus;
}

/** Failure reason of a helper status; the helper's own (German) text is only ever the detail. */
export function rdpStatusError(status: 'disconnected' | 'error', text?: string): CodedError | undefined {
  if (status === 'error') return { code: 'core.rdpFailed', ...(text ? { detail: truncateDetail(text) } : {}) };
  return text ? { code: 'core.rdpDisconnected', detail: truncateDetail(text) } : undefined;
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
  /** Connections whose server rejected dynamic resolution; later sessions resize by reconnect at once. */
  private staticResolution = new Set<string>();

  constructor(private readonly dependencies: RdpDependencies) {}

  open(ownerId: number, window: BrowserWindow, request: RdpOpenRequest): { sessionId: string } {
    if (this.sessions.size >= MAX_SSH_SESSIONS) throw new AppError('core.rdpSessionLimit', { max: MAX_SSH_SESSIONS });
    const target = this.dependencies.getTarget(request.connectionId);
    const session: Session = { id: randomUUID(), connectionId: request.connectionId, ownerId, window, bounds: request.bounds, revision: 0, failed: false, status: 'connecting' };
    this.track(window);
    this.sessions.set(session.id, session);
    const handle = window.getNativeWindowHandle().readBigUInt64LE(0).toString();
    const account = splitAccount(target.username);
    // The password only travels through the private stdin pipe; without one the control asks for credentials.
    this.send({ type: 'open', sessionId: session.id, server: target.host, port: target.port, username: account.username,
      domain: target.domain?.trim() || account.domain, ...(target.password ? { password: target.password } : {}),
      clipboard: target.clipboard, smartResize: process.env.SHELLHERD_RDP_SMARTSIZE !== '0',
      dynamicResolution: !this.staticResolution.has(request.connectionId), mode: this.dependencies.mode, parent: handle, visible: request.visible, ...toScreenRect(window, request.bounds) });
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

  action(ownerId: number, id: string, action: RdpAction): void {
    this.send({ type: 'action', sessionId: this.owned(ownerId, id).id, action });
  }

  close(ownerId: number, id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.owned(ownerId, id);
    this.send({ type: 'close', sessionId: id });
  }

  /** Starts the helper ahead of the first RDP tab; .NET cold start plus virus scanning can take seconds. */
  prewarm(): void {
    if (process.platform === 'win32') { try { this.ensureHelper(); } catch { /* reported on first open */ } }
  }

  /** Re-owns the surface by another window; it stays hidden until the new panel reports its bounds. */
  transferOwner(fromOwner: number, id: string, toOwner: number, window: BrowserWindow): RdpStatus {
    const session = this.owned(fromOwner, id);
    session.ownerId = toOwner;
    session.window = window;
    session.sentBounds = undefined;
    this.track(window);
    this.send({ type: 'visible', sessionId: id, visible: false });
    this.send({ type: 'reparent', sessionId: id, parent: window.getNativeWindowHandle().readBigUInt64LE(0).toString() });
    return session.status;
  }

  closeOwner(ownerId: number): void {
    for (const session of this.sessions.values()) if (session.ownerId === ownerId) this.send({ type: 'close', sessionId: session.id });
  }

  closeAll(): void {
    for (const session of this.sessions.values()) this.send({ type: 'close', sessionId: session.id });
  }

  owns(ownerId: number, id: string): boolean { return this.sessions.get(id)?.ownerId === ownerId; }
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
    if (!session || session.ownerId !== ownerId) throw new AppError('core.rdpUnavailable');
    return session;
  }

  private sendBounds(session: Session): void {
    if (session.window.isDestroyed()) return;
    const rect = toScreenRect(session.window, session.bounds);
    const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (key === session.sentBounds) return;
    session.sentBounds = key;
    session.revision += 1;
    this.send({ type: 'bounds', sessionId: session.id, revision: session.revision, ...rect });
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
        this.dependencies.emit(session.ownerId, { type: 'status', sessionId: session.id, status: 'error', error: { code: 'core.rdpHelperLost' } });
      }
      this.sessions.clear();
    };
    helper.on('exit', lost);
    helper.on('error', lost);
    this.helper = helper;
    return helper;
  }

  private send(message: Record<string, unknown>): void {
    if (debug) {
      const { password, ...visible } = message;
      console.log(`[rdp ${timestamp()}] ->`, JSON.stringify({ ...visible, ...(password ? { password: '***' } : {}) }));
    }
    this.ensureHelper().stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    if (debug) console.log(`[rdp ${timestamp()}] <-`, line);
    let message: { type?: string; sessionId?: string; status?: string; message?: string; active?: boolean; dynamicResolution?: boolean };
    try { message = JSON.parse(line); } catch { return; }
    const session = message.sessionId ? this.sessions.get(message.sessionId) : undefined;
    if (message.type === 'error') {
      // Only a failed open carries a sessionId; the helper never created a surface for it.
      if (!session) { console.warn('RDP-Helfer:', message.message); return; }
      session.failed = true;
      session.status = 'error';
      this.dependencies.emit(session.ownerId, { type: 'status', sessionId: session.id, status: 'error', error: rdpStatusError('error', message.message) });
      this.sessions.delete(session.id);
      return;
    }
    if (!session) return;
    if (message.type === 'capability' && message.dynamicResolution === false) { this.staticResolution.add(session.connectionId); return; }
    if (message.type === 'resizing') {
      this.dependencies.emit(session.ownerId, { type: 'resizing', sessionId: session.id, active: message.active === true });
      return;
    }
    if (message.type !== 'status') return;
    const emit = (status: RdpStatus, error?: CodedError): void => {
      session.status = status;
      this.dependencies.emit(session.ownerId, { type: 'status', sessionId: session.id, status, ...(error ? { error } : {}) });
    };
    switch (message.status) {
      case 'connecting': emit('connecting'); break;
      case 'loginComplete': emit('connected'); break;
      case 'disconnected': emit('closed', rdpStatusError('disconnected', message.message)); break;
      case 'error': session.failed = true; emit('error', rdpStatusError('error', message.message)); break;
      case 'closed':
        this.sessions.delete(session.id);
        if (!session.failed) emit('closed');
        break;
    }
  }
}
