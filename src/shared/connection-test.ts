/** One checked step of a connection test (dry run); later steps are not run after a failure. */
export interface ConnectionTestStep {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  steps: ConnectionTestStep[];
}
