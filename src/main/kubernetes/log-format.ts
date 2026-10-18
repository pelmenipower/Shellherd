import { StringDecoder } from 'node:string_decoder';

export type LogFormat = 'compact' | 'raw';

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';
const MAX_EXTRAS = 6;
const MAX_QUERY_LENGTH = 200;
/** A partial line longer than this is no longer held back for formatting. */
export const MAX_PENDING_LINE = 64 * 1024;

const TIME_PATHS = [['ts'], ['time'], ['timestamp'], ['@timestamp'], ['record', 'log_time']];
const LEVEL_PATHS = [['record', 'error_severity'], ['level'], ['severity'], ['lvl']];
const MESSAGE_PATHS = [['record', 'message'], ['msg'], ['message']];

type Json = Record<string, unknown>;

/** Per-stream state: the day of the previous line, so the date only shows when it changes. */
export interface LogFormatState { day?: string }

function pick(object: Json, paths: string[][]): unknown {
  for (const path of paths) {
    let value: unknown = object;
    for (const key of path) {
      value = value && typeof value === 'object' && !Array.isArray(value) ? (value as Json)[key] : undefined;
    }
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/**
 * Makes a decoded value safe for the terminal: line breaks become CRLF plus an indent, tabs become a space
 * and every other control character (C0, DEL, C1, including ESC) becomes U+FFFD. JSON escapes such as
 * \u001b are inert in raw mode, so compact mode must not turn them into live control characters.
 */
function sanitize(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, '\r\n    ')
    .replace(/\t/g, ' ')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '�');
}

function text(value: unknown): string {
  return sanitize(typeof value === 'string' ? value : (JSON.stringify(value) ?? ''));
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Splits a timestamp value into day and time of day (UTC), or undefined when it is not readable. */
function parseTime(value: unknown): { day: string; time: string } | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value < 1e11 ? value * 1000 : value);
    if (Number.isNaN(date.getTime())) return undefined;
    return fromDate(date);
  }
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:[.,](\d+))?\s*(Z|UTC|[+-]\d{2}:?\d{2})?$/i.exec(value.trim());
  if (!match) return undefined;
  const zone = match[4];
  if (zone && !/^(z|utc)$/i.test(zone)) {
    const date = new Date(value.trim().replace(' ', 'T').replace(/\s+/g, ''));
    return Number.isNaN(date.getTime()) ? undefined : fromDate(date);
  }
  return { day: match[1], time: `${match[2]}.${(match[3] ?? '').padEnd(3, '0').slice(0, 3)}` };
}

function fromDate(date: Date): { day: string; time: string } {
  return {
    day: `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`,
    time: `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}.${String(date.getUTCMilliseconds()).padStart(3, '0')}`,
  };
}

function levelColor(level: string): string {
  if (level === 'ERROR' || level === 'FATAL' || level === 'PANIC') return RED;
  if (level === 'WARN' || level === 'WARNING') return YELLOW;
  if (level === 'DEBUG') return GRAY;
  return '';
}

/** Compact form of one line, without line end. Lines that are not recognised JSON stay unchanged. */
export function formatLogLine(line: string, state: LogFormatState = {}): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return line;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return line;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return line;
  const object = parsed as Json;

  const rawTime = pick(object, TIME_PATHS);
  const rawLevel = pick(object, LEVEL_PATHS);
  const rawMessage = pick(object, MESSAGE_PATHS);
  if (rawTime === undefined && rawLevel === undefined && rawMessage === undefined) return line;

  const sqlState = pick(object, [['record', 'sql_state_code']]);
  const isError = sqlState !== undefined && text(sqlState) !== '00000';

  const parts: string[] = [];
  if (rawTime !== undefined) {
    const time = parseTime(rawTime);
    if (time) {
      parts.push(state.day !== undefined && state.day !== time.day ? `${time.day} ${time.time}` : time.time);
      state.day = time.day;
    } else {
      parts.push(text(rawTime));
    }
  }
  if (rawLevel !== undefined) {
    const level = text(rawLevel).toUpperCase();
    const color = isError ? '' : levelColor(level);
    const padded = level.padEnd(5);
    parts.push(color ? `${color}${padded}${RESET}` : padded);
  }
  if (rawMessage !== undefined) parts.push(text(rawMessage));

  const extras: string[] = [];
  const addExtra = (key: string, paths: string[][], max?: number) => {
    const value = pick(object, paths);
    if (value === undefined) return;
    let shown = text(value);
    if (max !== undefined) {
      const chars = Array.from(shown);
      if (chars.length > max) shown = `${chars.slice(0, max).join('')}…`;
    }
    extras.push(`${key}=${shown}`);
  };
  if (isError) addExtra('sql_state', [['record', 'sql_state_code']]);
  addExtra('user', [['record', 'user_name']]);
  addExtra('db', [['record', 'database_name']]);
  addExtra('query', [['record', 'query']], MAX_QUERY_LENGTH);
  addExtra('logger', [['logger']]);
  addExtra('pod', [['logging_pod']]);
  const rest = extras.slice(0, MAX_EXTRAS).map(extra => ` ${extra}`).join('');

  const body = parts.join(' ');
  if (isError) return `${RED}${body}${rest}${RESET}`;
  return rest ? `${body}${GRAY}${rest}${RESET}` : body;
}

/** Turns log bytes into terminal text with CRLF line ends, in compact or raw form. */
export class LogFormatter {
  private readonly decoder = new StringDecoder('utf8');
  private readonly state: LogFormatState = {};
  private pending = '';
  private lastWasCr = false;
  /** True while the rest of an over-long or non-JSON line is passed through unformatted. */
  private passthrough = false;

  constructor(private readonly format: LogFormat) {}

  feed(chunk: Buffer): string {
    const decoded = this.decoder.write(chunk);
    return this.format === 'raw' ? this.raw(decoded) : this.compact(decoded);
  }

  flush(): string {
    const tail = this.decoder.end();
    if (this.format === 'raw') return this.raw(tail);
    const rest = this.pending + tail;
    this.pending = '';
    return rest ? formatLogLine(rest.replace(/\r$/, ''), this.state) : '';
  }

  private raw(input: string): string {
    let out = '';
    for (const char of input) {
      out += char === '\n' && !this.lastWasCr ? '\r\n' : char;
      this.lastWasCr = char === '\r';
    }
    return out;
  }

  private compact(input: string): string {
    let out = '';
    let pos = 0;
    while (pos < input.length) {
      const newline = input.indexOf('\n', pos);
      if (this.passthrough) {
        const end = newline < 0 ? input.length : newline + 1;
        out += this.raw(input.slice(pos, end));
        if (newline >= 0) this.passthrough = false;
        pos = end;
        continue;
      }
      if (newline < 0) {
        this.pending += input.slice(pos);
        const head = this.pending.trimStart();
        if (this.pending.length > MAX_PENDING_LINE || (head !== '' && !head.startsWith('{'))) {
          out += this.raw(this.pending);
          this.pending = '';
          this.passthrough = true;
        }
        break;
      }
      const line = this.pending + input.slice(pos, newline);
      this.pending = '';
      out += `${formatLogLine(line.replace(/\r$/, ''), this.state)}\r\n`;
      pos = newline + 1;
    }
    return out;
  }
}
