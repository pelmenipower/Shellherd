import type { resources } from './locales';

type ErrorCatalog = (typeof resources)['de-DE']['errors'];
export type ErrorArea = keyof ErrorCatalog & string;
/** Exactly `<area>.<key>`; no recursion (catalog rule K-2). */
export type ErrorCode = { [A in ErrorArea]: `${A}.${keyof ErrorCatalog[A] & string}` }[ErrorArea];
export type ErrorParams = Record<string, string | number>;
export interface CodedError { code: ErrorCode; params?: ErrorParams; detail?: string }

export const ERROR_MARK = '§';
export const MAX_DETAIL = 500;

export function truncateDetail(text: string): string {
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text;
}

/** `§<code>` or `§<code> {"params":{…},"detail":"…"}`; detail truncated. */
export function encodeError(code: ErrorCode, params?: ErrorParams, detail?: string): string {
  const payload: { params?: ErrorParams; detail?: string } = {};
  if (params && Object.keys(params).length > 0) payload.params = params;
  if (detail) payload.detail = truncateDetail(detail);
  return Object.keys(payload).length > 0
    ? `${ERROR_MARK}${code} ${JSON.stringify(payload)}`
    : `${ERROR_MARK}${code}`;
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
        const { params, detail } = payload as { params?: unknown; detail?: unknown };
        if (params && typeof params === 'object' && !Array.isArray(params)) {
          const clean: ErrorParams = {};
          for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'string' || typeof value === 'number') clean[key] = value;
          }
          if (Object.keys(clean).length > 0) coded.params = clean;
        }
        if (typeof detail === 'string' && detail) coded.detail = detail;
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

  constructor(code: ErrorCode, params?: ErrorParams, detail?: string) {
    super(encodeError(code, params, detail));
    this.code = code;
    this.params = params;
    this.detail = detail;
  }

  toCoded(): CodedError {
    const coded: CodedError = { code: this.code };
    if (this.params) coded.params = this.params;
    if (this.detail) coded.detail = this.detail;
    return coded;
  }

  static from(error: CodedError): AppError {
    return new AppError(error.code, error.params, error.detail);
  }
}
