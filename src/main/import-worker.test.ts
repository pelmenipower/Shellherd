import { describe, expect, it } from 'vitest';

import { answer } from './import-worker';

const HOME = 'C:/Users/demo';

describe('answer', () => {
  it('replies with the preview of a valid request', () => {
    const reply = answer({ source: 'openssh', text: 'Host web\n  HostName 10.0.0.1\n', home: HOME });
    expect(reply).toMatchObject({ ok: true, preview: { candidates: [{ key: 'web', host: '10.0.0.1' }] } });
  });

  it('passes the code of an AppError through', () => {
    const reply = answer({ source: 'mremoteng', text: '<Connections FullFileEncryption="true"></Connections>', home: HOME });
    expect(reply).toEqual({ ok: false, error: { code: 'core.importEncrypted' } });
  });

  it('maps any other failure to importUnreadable', () => {
    const reply = answer({ source: 'putty', text: null as unknown as string, home: HOME });
    expect(reply).toEqual({ ok: false, error: { code: 'core.importUnreadable' } });
  });
});
