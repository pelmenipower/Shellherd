import { describe, expect, it } from 'vitest';
import { LogFormatter, formatLogLine } from './log-format';

const GRAY = '\x1b[90m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const checkpoint = '{"level":"info","ts":"2026-10-14T09:06:50.227849713Z","logger":"postgres","msg":"record","logging_pod":"pg-horizon-tst-1","record":{"log_time":"2026-10-14 09:06:50.227 UTC","error_severity":"LOG","sql_state_code":"00000","message":"checkpoint starting: time","backend_type":"checkpointer"}}';
const failure = '{"level":"info","ts":"2026-10-14T09:07:01.100Z","logger":"postgres","msg":"record","logging_pod":"pg-horizon-tst-1","record":{"log_time":"2026-10-14 09:07:01.100 UTC","user_name":"horizon_app","database_name":"horizon","error_severity":"ERROR","sql_state_code":"42P01","message":"relation \\"hz_user_shortcuts\\" does not exist","query":"SELECT id, action_id FROM hz_user_shortcuts WHERE user_identifier = $1"}}';

const feed = (format: 'compact' | 'raw', ...chunks: string[]) => {
  const formatter = new LogFormatter(format);
  return chunks.map(chunk => formatter.feed(Buffer.from(chunk))).join('') + formatter.flush();
};

describe('LogFormatter raw', () => {
  it('turns bare line feeds into CRLF', () => {
    expect(feed('raw', 'a\nb\r\nc\n')).toBe('a\r\nb\r\nc\r\n');
  });

  it('handles line ends across chunk boundaries without doubling the CR', () => {
    expect(feed('raw', 'a\r', '\nb\n')).toBe('a\r\nb\r\n');
    expect(feed('raw', 'a', '\nb')).toBe('a\r\nb');
  });

  it('leaves JSON lines alone', () => {
    expect(feed('raw', `${checkpoint}\n`)).toBe(`${checkpoint}\r\n`);
  });
});

describe('formatLogLine', () => {
  it('formats the CNPG checkpoint line with grey extras', () => {
    expect(formatLogLine(checkpoint)).toBe(`09:06:50.227 LOG   checkpoint starting: time${GRAY} logger=postgres pod=pg-horizon-tst-1${RESET}`);
  });

  it('colours a SQL error line red and shows state, user, database and query', () => {
    const line = formatLogLine(failure);
    expect(line.startsWith(RED)).toBe(true);
    expect(line.endsWith(RESET)).toBe(true);
    expect(line).toContain('09:07:01.100 ERROR relation "hz_user_shortcuts" does not exist');
    expect(line).toContain('sql_state=42P01');
    expect(line).toContain('user=horizon_app');
    expect(line).toContain('db=horizon');
    expect(line).toContain('query=SELECT id, action_id FROM hz_user_shortcuts WHERE user_identifier = $1');
  });

  it('colours levels and truncates long queries', () => {
    expect(formatLogLine('{"level":"warn","msg":"slow"}')).toBe('\x1b[33mWARN \x1b[0m slow'.replace('m slow', 'm slow'));
    expect(formatLogLine('{"level":"debug","msg":"x"}')).toBe(`${GRAY}DEBUG${RESET} x`);
    const long = formatLogLine(`{"msg":"m","record":{"query":"${'q'.repeat(300)}"}}`);
    expect(long).toContain(`query=${'q'.repeat(200)}…`);
    expect(long).not.toContain('q'.repeat(201));
  });

  it('prints an unreadable time verbatim', () => {
    expect(formatLogLine('{"ts":"yesterday","msg":"m"}')).toBe('yesterday m');
  });

  it('leaves non-JSON lines and unrecognised objects unchanged', () => {
    expect(formatLogLine('plain text')).toBe('plain text');
    expect(formatLogLine('{broken')).toBe('{broken');
    expect(formatLogLine('{"foo":1}')).toBe('{"foo":1}');
    expect(formatLogLine('[1,2]')).toBe('[1,2]');
    expect(formatLogLine('')).toBe('');
  });
});

describe('LogFormatter compact', () => {
  it('formats complete lines with CRLF and holds a partial line until flush', () => {
    const formatter = new LogFormatter('compact');
    expect(formatter.feed(Buffer.from('plain\n{"level":"info","ms'))).toBe('plain\r\n');
    expect(formatter.feed(Buffer.from('g":"half"}'))).toBe('');
    expect(formatter.flush()).toBe('INFO  half');
    expect(formatter.flush()).toBe('');
  });

  it('joins a line that is split across chunks and tolerates CRLF input', () => {
    expect(feed('compact', '{"level":"info",', '"msg":"x"}\r', '\nnext\r\n')).toBe('INFO  x\r\nnext\r\n');
  });

  it('keeps multi-byte characters that are split across chunks', () => {
    const bytes = Buffer.from('{"msg":"ä"}\n');
    const formatter = new LogFormatter('compact');
    const out = formatter.feed(bytes.subarray(0, 9)) + formatter.feed(bytes.subarray(9));
    expect(out).toBe('ä\r\n');
  });

  it('shows the date only when the day changes', () => {
    const out = feed('compact',
      '{"ts":"2026-10-14T23:59:59.900Z","msg":"a"}\n{"ts":"2026-10-14T23:59:59.950Z","msg":"b"}\n{"ts":"2026-10-15T00:00:00.100Z","msg":"c"}\n{"ts":"2026-10-15T00:00:01.000Z","msg":"d"}\n');
    expect(out).toBe('23:59:59.900 a\r\n23:59:59.950 b\r\n2026-10-15 00:00:00.100 c\r\n00:00:01.000 d\r\n');
  });
});
