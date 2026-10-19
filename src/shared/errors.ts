import type { resources } from './locales';

type ErrorCatalog = (typeof resources)['de-DE']['errors'];
export type ErrorArea = keyof ErrorCatalog & string;
/** Exactly `<area>.<key>`; no recursion (catalog rule K-2). */
export type ErrorCode = { [A in ErrorArea]: `${A}.${keyof ErrorCatalog[A] & string}` }[ErrorArea];
export type ErrorParams = Record<string, string | number>;
export interface CodedError { code: ErrorCode; params?: ErrorParams; detail?: string; causes?: ErrorCause[] }
/** One labelled reason (e.g. per host); depth 1: the child carries no `causes` of its own. */
export interface ErrorCause { label: string; error: CodedError }

export const ERROR_MARK = '§';
export const MAX_DETAIL = 500;

export function truncateDetail(text: string): string {
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text;
}

/** Truncates `detail` of an error and of its causes to MAX_DETAIL (for events that bypass encodeError). */
export function limitError(error: CodedError): CodedError {
  const limited: CodedError = { ...error };
  if (limited.detail) limited.detail = truncateDetail(limited.detail);
  if (limited.causes) limited.causes = limited.causes.map(({ label, error: child }) => ({ label, error: child.detail ? { ...child, detail: truncateDetail(child.detail) } : child }));
  return limited;
}

/** `§<code>` or `§<code> {"params":{…},"detail":"…","causes":[{"label":"…","error":{…}}]}`; detail truncated. */
export function encodeError(code: ErrorCode, params?: ErrorParams, detail?: string, causes?: ErrorCause[]): string {
  const payload: { params?: ErrorParams; detail?: string; causes?: ErrorCause[] } = {};
  if (params && Object.keys(params).length > 0) payload.params = params;
  if (detail) payload.detail = truncateDetail(detail);
  if (causes && causes.length > 0) payload.causes = causes.map(({ label, error }) => ({ label, error: flat(error) }));
  return Object.keys(payload).length > 0
    ? `${ERROR_MARK}${code} ${JSON.stringify(payload)}`
    : `${ERROR_MARK}${code}`;
}

function cleanParams(params: unknown): ErrorParams | undefined {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined;
  const clean: ErrorParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number') clean[key] = value;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/** A child without its own causes. */
function flat({ code, params, detail }: CodedError): CodedError {
  const child: CodedError = { code };
  if (params) child.params = params;
  if (detail) child.detail = truncateDetail(detail);
  return child;
}

const CODE = /^[a-z][A-Za-z0-9]*\.[A-Za-z0-9]+$/;

/** Valid entries only; children are read without their own causes. */
function cleanCauses(value: unknown): ErrorCause[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const causes: ErrorCause[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { label, error } = entry as { label?: unknown; error?: unknown };
    if (typeof label !== 'string' || !error || typeof error !== 'object') continue;
    const { code, params, detail } = error as { code?: unknown; params?: unknown; detail?: unknown };
    if (typeof code !== 'string' || !CODE.test(code)) continue;
    const child: CodedError = { code: code as ErrorCode };
    const clean = cleanParams(params);
    if (clean) child.params = clean;
    if (typeof detail === 'string' && detail) child.detail = truncateDetail(detail);
    causes.push({ label, error: child });
  }
  return causes.length > 0 ? causes : undefined;
}

const DECODE = /^(?:Error invoking remote method '[^']*': )?(?:[A-Za-z]*Error: )?§([a-z][A-Za-z0-9]*\.[A-Za-z0-9]+)(?: (\{[\s\S]*\}))?$/;

/** Accepts an optional `Error invoking remote method '…': ` and an optional `<Name>Error: ` prefix. Foreign text → null. */
export function decodeError(message: string): CodedError | null {
  const match = DECODE.exec(message);
  if (!match) return null;
  const coded: CodedError = { code: match[1] as ErrorCode };
  if (match[2]) {
    try {
      const payload: unknown = JSON.parse(match[2]);
      if (payload && typeof payload === 'object') {
        const { params, detail, causes } = payload as { params?: unknown; detail?: unknown; causes?: unknown };
        const clean = cleanParams(params);
        if (clean) coded.params = clean;
        if (typeof detail === 'string' && detail) coded.detail = detail;
        const validCauses = cleanCauses(causes);
        if (validCauses) coded.causes = validCauses;
      }
    } catch {
      // invalid JSON: code without parameters
    }
  }
  return coded;
}

export function isCodedError(value: unknown): value is CodedError {
  return typeof value === 'object' && value !== null && !(value instanceof Error)
    && typeof (value as { code?: unknown }).code === 'string';
}

/** AppError → toCoded(); CodedError → itself; Error/string with decodable message → decoded; else { code: fallback } (never raw text as detail). */
export function codedFrom(error: unknown, fallback: ErrorCode): CodedError {
  if (error instanceof AppError) return error.toCoded();
  if (isCodedError(error)) return error;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  return (message !== undefined ? decodeError(message) : null) ?? { code: fallback };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly params?: ErrorParams;
  readonly detail?: string;
  readonly causes?: ErrorCause[];

  constructor(code: ErrorCode, params?: ErrorParams, detail?: string, causes?: ErrorCause[]) {
    super(encodeError(code, params, detail, causes));
    if (causes && causes.length > 0) this.causes = causes;
    this.code = code;
    this.params = params;
    this.detail = detail;
  }

  toCoded(): CodedError {
    const coded: CodedError = { code: this.code };
    if (this.params) coded.params = this.params;
    if (this.detail) coded.detail = this.detail;
    if (this.causes) coded.causes = this.causes;
    return coded;
  }

  static from(error: CodedError): AppError {
    return new AppError(error.code, error.params, error.detail, error.causes);
  }
}
