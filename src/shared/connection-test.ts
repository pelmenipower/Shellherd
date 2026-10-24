import type { CodedError } from './errors';

export type ConnectionTestStepId = 'clusterTest' | 'startFolder' | 'command' | 'toolFound' | 'programFound' | 'hostGiven'
  | 'nameResolved' | 'portReachable' | 'login' | 'userGiven' | 'hostKey' | 'credentials' | 'sftp' | 'jumpHost';

/** One checked step of a connection test (dry run); later steps are not run after a failure. */
export interface ConnectionTestStep {
  step: ConnectionTestStepId;
  /** toolFound: { tool } (brand name), portReachable: { port }, jumpHost: { name }. */
  params?: Record<string, string | number>;
  ok: boolean;
  /** Raw data only: path, `host → address`, program file. Never prose. */
  detail?: string;
  /** Explanation or failure reason, e.g. core.testNotInstalled { install }, ssh.* from publicError. */
  note?: CodedError;
}

export interface ConnectionTestResult {
  ok: boolean;
  steps: ConnectionTestStep[];
}
