import type { CodedError } from './errors';
import type { ConnectionErrorCode } from './connection-errors';
import type { TerminalTarget } from './containers';
import type { KubeTerminalTarget } from './kubernetes';

export const MAX_SSH_SESSIONS = 16;

export interface TerminalSize { cols: number; rows: number }
export interface SshPrepareRequest extends TerminalSize {
  connectionId: string; target?: TerminalTarget; kube?: KubeTerminalTarget;
}
export interface SshSessionRequest { sessionId: string }
export interface SshInputRequest extends SshSessionRequest { data: string }
export interface SshResizeRequest extends SshSessionRequest, TerminalSize {}
export interface SshAckRequest extends SshSessionRequest { sequence: number }
export type SshStatus = 'connecting' | 'connected' | 'closed' | 'error';
/** Phase of an ssh2 connection; local shells, pods and local containers only send 'shell', 'jump' only with a jump host. */
export type SshStep = 'jump' | 'reach' | 'hostkey' | 'auth' | 'shell';
export type SshEvent =
  | { type: 'data'; sessionId: string; sequence: number; data: Uint8Array }
  | { type: 'step'; sessionId: string; step: SshStep }
  | { type: 'status'; sessionId: string; status: SshStatus;
      /** Translated by the renderer; detail = raw library text (at most 500 characters, never a stack, a config or key material). */
      error?: CodedError;
      /** Card classification; only with status 'error', or 'closed-by-server'/'idle' with status 'closed'. */
      code?: ConnectionErrorCode }
  | { type: 'forwards'; sessionId: string; forwards: ForwardStatus[] };

export interface AuthPromptField { text: string; echo: boolean }
/** One keyboard-interactive round; server texts are cleaned in Main (control characters removed, lengths capped). */
export interface AuthPromptRequest {
  promptId: string;
  connectionName: string;
  /** `host:port` as configured. */
  host: string;
  title: string;
  instructions: string;
  fields: AuthPromptField[];
}
/** answers null = cancelled. */
export interface AuthPromptAnswer { promptId: string; answers: string[] | null }
export type ForwardKind = 'local' | 'remote' | 'dynamic';
export type ForwardState = 'stopped' | 'starting' | 'active' | 'error' | 'elsewhere';
export interface ForwardStatus {
  id: string; kind: ForwardKind;
  localPort?: number; remotePort?: number; targetHost?: string; targetPort?: number;
  state: ForwardState; error?: CodedError;
  /** Open channels right now. */
  open: number;
}
export interface SshForwardRequest extends SshSessionRequest { forwardId: string; run: boolean }
