import type { CodedError } from './errors';
import type { TerminalTarget } from './containers';
import type { KubeTerminalTarget } from './kubernetes';

export const MAX_SSH_SESSIONS = 16;

export interface TerminalSize { cols: number; rows: number }
export interface SshPrepareRequest extends TerminalSize { connectionId: string; target?: TerminalTarget; kube?: KubeTerminalTarget }
export interface SshSessionRequest { sessionId: string }
export interface SshInputRequest extends SshSessionRequest { data: string }
export interface SshResizeRequest extends SshSessionRequest, TerminalSize {}
export interface SshAckRequest extends SshSessionRequest { sequence: number }
export type SshStatus = 'connecting' | 'connected' | 'closed' | 'error';
export type SshEvent =
  | { type: 'data'; sessionId: string; sequence: number; data: Uint8Array }
  | { type: 'status'; sessionId: string; status: SshStatus; error?: CodedError };
