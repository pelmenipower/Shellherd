import type { ConnectionErrorCode } from './connection-errors';
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
/** Phase of an ssh2 connection; local shells, pods and local containers only send 'shell'. */
export type SshStep = 'reach' | 'hostkey' | 'auth' | 'shell';
export type SshEvent =
  | { type: 'data'; sessionId: string; sequence: number; data: Uint8Array }
  | { type: 'step'; sessionId: string; step: SshStep }
  | { type: 'status'; sessionId: string; status: SshStatus; message?: string;
      /** Only with status 'error', or 'closed-by-server' with status 'closed'. */
      code?: ConnectionErrorCode;
      /** Raw error text, at most 500 characters; never a stack, a config or key material. */
      detail?: string };
