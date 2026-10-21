import type { CodedError } from './errors';
import type { ConnectionErrorCode } from './connection-errors';
import type { TerminalTarget } from './containers';
import type { KubeTerminalTarget } from './kubernetes';

export const MAX_SSH_SESSIONS = 16;

export interface TerminalSize { cols: number; rows: number }
export interface SshPrepareRequest extends TerminalSize {
  connectionId: string; target?: TerminalTarget; kube?: KubeTerminalTarget;
  /** One attempt without the connection's login block (root shell and start commands); can only switch it off. */
  skipLogin?: boolean;
}
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
  | { type: 'status'; sessionId: string; status: SshStatus;
      /** Translated by the renderer; detail = raw library text (at most 500 characters, never a stack, a config or key material). */
      error?: CodedError;
      /** Card classification; only with status 'error', or 'closed-by-server'/'idle' with status 'closed'. */
      code?: ConnectionErrorCode };
