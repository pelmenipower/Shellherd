import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { KubeConfig, KubernetesObjectApi, Watch } from '@kubernetes/client-node';
import { describe, expect, it, vi } from 'vitest';
import type { KubeTerminalTarget } from '../../shared/kubernetes';
import type { CodedError } from '../../shared/errors';
import { KubeApiError } from './api';
import { createKubeApi, isAltnameError, manualJobBody, openLogs, resourcePath, selectorQuery, toApiError, watchEnd } from './client-api';
import type { LogRequest } from './client-api';

function testConfig(server = 'https://k8s.example:6443'): KubeConfig {
  const config = new KubeConfig();
  config.loadFromString(JSON.stringify({
    apiVersion: 'v1',
    kind: 'Config',
    clusters: [{ name: 'c', cluster: { server, 'insecure-skip-tls-verify': true } }],
    users: [{ name: 'u', user: { token: 'tok' } }],
    contexts: [{ name: 'x', context: { cluster: 'c', user: 'u' } }],
    'current-context': 'x',
  }));
  return config;
}

const logsTarget: KubeTerminalTarget = { namespace: 'shop', pod: 'api-1', container: 'app', mode: 'logs' };
const previousTarget: KubeTerminalTarget = { ...logsTarget, mode: 'previous' };

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/** A fake request whose body errors with AbortError when the request signal is aborted, as the real socket does. */
function fakeLogRequest(status = 200) {
  const calls: { url: string; headers: Record<string, unknown>; signal?: AbortSignal }[] = [];
  const body = new PassThrough();
  const sendRequest: LogRequest = async (url, options) => {
    calls.push({ url: url.toString(), headers: options.headers as Record<string, unknown>, signal: options.signal });
    options.signal?.addEventListener('abort', () => body.destroy(abortError()));
    return { status, body };
  };
  return {
    calls,
    sendRequest,
    push: (text: string) => body.write(text),
    end: () => body.end(),
    fail: (error: Error) => body.destroy(error),
  };
}

function abortError(): Error {
  return Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
}

function fakeIo() {
  return { data: vi.fn<(chunk: Buffer) => void>(), end: vi.fn<(code: number | null, error?: CodedError) => void>() };
}

describe('resourcePath', () => {
  it('builds resource paths', () => {
    expect(resourcePath('pods', 'shop')).toBe('/api/v1/namespaces/shop/pods');
    expect(resourcePath('pods', null)).toBe('/api/v1/pods');
    expect(resourcePath('deployments', 'shop')).toBe('/apis/apps/v1/namespaces/shop/deployments');
    expect(resourcePath('ingresses', null)).toBe('/apis/networking.k8s.io/v1/ingresses');
    expect(resourcePath('nodes', 'ignored')).toBe('/api/v1/nodes');
  });
});

describe('selectorQuery', () => {
  it('builds selector strings', () => {
    expect(selectorQuery({ labels: { app: 'api', tier: 'web' } })).toEqual({ labelSelector: 'app=api,tier=web' });
    expect(selectorQuery({ node: 'worker1' })).toEqual({ fieldSelector: 'spec.nodeName=worker1' });
    expect(selectorQuery()).toEqual({});
  });
});

describe('toApiError', () => {
  it('maps HTTP errors to catalog codes', () => {
    expect(toApiError({ code: 403, body: { message: 'pods "x" is forbidden: User "u" cannot delete resource "pods" in API group "" in the namespace "shop"' } }).coded)
      .toEqual({ code: 'kubernetes.forbiddenResource', params: { resource: 'pods', verb: 'delete', namespace: 'shop' } });
    expect(toApiError({ code: 403 }).coded).toEqual({ code: 'kubernetes.forbidden' });
    expect(toApiError({ code: 401 }).coded).toEqual({ code: 'kubernetes.unauthorized' });
    expect(toApiError({ code: 404 }).coded).toEqual({ code: 'kubernetes.notFound' });
    expect(toApiError({ statusCode: 410 }).code).toBe(410);
    expect(toApiError({ statusCode: 410 }).coded).toEqual({ code: 'kubernetes.watchExpired' });
    expect(toApiError(Object.assign(new Error('x'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID', reason: "Host: 10.0.0.5. is not in the cert's altnames: DNS:kubernetes" })).coded)
      .toEqual({ code: 'kubernetes.tlsAltname', detail: "Host: 10.0.0.5. is not in the cert's altnames: DNS:kubernetes" });
    expect(toApiError(new Error('socket hang up')).coded).toEqual({ code: 'kubernetes.connectionReset' });
    expect(toApiError({ code: 500 }).coded).toEqual({ code: 'kubernetes.apiError' });
  });

  it('maps an ApiException-shaped error without using its message', () => {
    const apiException = Object.assign(new Error('HTTP-Code: 403\nMessage: Forbidden\nBody: {"secret":"x"}\nHeaders: {"authorization":"y"}'), {
      code: 403,
      body: { message: 'pods "x" is forbidden: User "u" cannot delete resource "pods" in API group "" in the namespace "shop"' },
    });
    const error = toApiError(apiException);
    expect(error).toBeInstanceOf(KubeApiError);
    expect(error.coded.code).toBe('kubernetes.forbiddenResource');
    expect(error.message).not.toMatch(/Body|Headers|secret/);
    expect(error.code).toBe(403);
  });

  it('maps undici TLS failures through the cause code and reason', () => {
    const tls = new TypeError('fetch failed', {
      cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID', reason: "Host: 10.0.0.5. is not in the cert's altnames: DNS:kubernetes" },
    });
    const error = toApiError(tls);
    expect(error.coded).toMatchObject({ code: 'kubernetes.tlsAltname', detail: "Host: 10.0.0.5. is not in the cert's altnames: DNS:kubernetes" });
    expect(isAltnameError(error)).toBe(true);

    const untrusted = toApiError(new TypeError('fetch failed', { cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } }));
    expect(untrusted.coded.code).toBe('kubernetes.tlsUntrusted');
    expect(isAltnameError(untrusted)).toBe(false);
  });

  it('never leaks Body or Headers from any error', () => {
    const samples: unknown[] = [
      Object.assign(new Error('HTTP-Code: 500\nBody: {"a":1}\nHeaders: {"b":2}'), { code: 500 }),
      Object.assign(new Error('HTTP-Code: 418\nBody: {"a":1}\nHeaders: {"b":2}'), { code: 418 }),
      new TypeError('fetch failed', { cause: new Error('Body: x Headers: y') }),
      Object.assign(new Error('Body: x Headers: y'), { code: 'EPROTO' }),
    ];
    for (const sample of samples) {
      const message = toApiError(sample).message;
      expect(message).not.toMatch(/Body:|Headers:/);
    }
  });

  it('recognises only the altname mismatch as the altname error', () => {
    expect(isAltnameError(new KubeApiError('x', undefined, { code: 'kubernetes.tlsAltname' }))).toBe(true);
    expect(isAltnameError(new KubeApiError('x', undefined, { code: 'kubernetes.tlsUntrusted' }))).toBe(false);
    expect(isAltnameError(new KubeApiError('x'))).toBe(false);
  });
});

describe('openLogs', () => {
  it('builds the log URL and sends the auth header', async () => {
    const fake = fakeLogRequest();
    const io = fakeIo();
    const stream = openLogs(testConfig(), previousTarget, io, fake.sendRequest);
    await flush();
    expect(fake.calls[0].url).toBe('https://k8s.example:6443/api/v1/namespaces/shop/pods/api-1/log?container=app&follow=false&previous=true&tailLines=500&timestamps=false');
    expect(fake.calls[0].headers.Authorization).toBe('Bearer tok');
    stream.close();
  });

  it('ends with code 0 when the log stream finishes', async () => {
    const fake = fakeLogRequest();
    const io = fakeIo();
    openLogs(testConfig(), logsTarget, io, fake.sendRequest);
    fake.push('line 1\n');
    await flush();
    fake.end();
    await flush();
    expect(io.data).toHaveBeenCalledWith(Buffer.from('line 1\r\n'));
    expect(io.end).toHaveBeenCalledTimes(1);
    expect(io.end).toHaveBeenCalledWith(0, undefined);
  });

  it('formats JSON lines compactly by default and flushes a partial last line at the end', async () => {
    const fake = fakeLogRequest();
    const io = fakeIo();
    openLogs(testConfig(), logsTarget, io, fake.sendRequest);
    fake.push('{"level":"info","msg":"one"}\n{"level":"info","msg":"two"}');
    await flush();
    expect(io.data).toHaveBeenCalledTimes(1);
    expect(io.data).toHaveBeenCalledWith(Buffer.from('INFO  one\r\n'));
    fake.end();
    await flush();
    expect(io.data).toHaveBeenLastCalledWith(Buffer.from('INFO  two'));
    expect(io.end).toHaveBeenCalledWith(0, undefined);
  });

  it('shows the held partial line before a mid-stream body error', async () => {
    const fake = fakeLogRequest();
    const io = fakeIo();
    openLogs(testConfig(), logsTarget, io, fake.sendRequest);
    fake.push('{"level":"info","msg":"held"}');
    await flush();
    expect(io.data).not.toHaveBeenCalled();
    fake.fail(new Error('socket hang up'));
    await flush();
    expect(io.data).toHaveBeenCalledWith(Buffer.from('INFO  held'));
    expect(io.end).toHaveBeenCalledTimes(1);
    expect(io.end.mock.calls[0][0]).toBeNull();
  });

  it('only fixes line ends in raw mode and for previous logs', async () => {
    const fake = fakeLogRequest();
    const io = fakeIo();
    openLogs(testConfig(), { ...previousTarget, format: 'raw' }, io, fake.sendRequest);
    fake.push('{"level":"info","msg":"one"}\n');
    await flush();
    expect(io.data).toHaveBeenCalledWith(Buffer.from('{"level":"info","msg":"one"}\r\n'));
  });

  it('treats an abort after close as a clean end without throwing', async () => {
    const fake = fakeLogRequest();
    const io = fakeIo();
    const stream = openLogs(testConfig(), logsTarget, io, fake.sendRequest);
    fake.push('line 1\n');
    await flush();
    expect(() => stream.close()).not.toThrow();
    expect(() => stream.close()).not.toThrow();
    await flush();
    // The body errored with AbortError after close(); nothing is reported and no error escapes.
    expect(io.end).not.toHaveBeenCalled();
    expect(fake.calls[0].signal?.aborted).toBe(true);
  });

  it('closes a live stream from a real server without an uncaught error', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200);
      const timer = setInterval(() => res.write('tick\n'), 5);
      res.on('close', () => clearInterval(timer));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    try {
      const io = fakeIo();
      const stream = openLogs(testConfig(`http://127.0.0.1:${port}`), logsTarget, io);
      // Wait for the first chunk instead of a fixed delay: under a busy suite it can take longer than 100 ms.
      await vi.waitFor(() => expect(io.data).toHaveBeenCalled(), { timeout: 5_000 });
      stream.close();
      stream.close();
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(io.end).not.toHaveBeenCalled();
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('reports a body error that happens without close as a generic message', async () => {
    const fake = fakeLogRequest();
    const io = fakeIo();
    openLogs(testConfig(), logsTarget, io, fake.sendRequest);
    fake.fail(new TypeError('terminated'));
    await flush();
    expect(io.end).toHaveBeenCalledWith(null, { code: 'kubernetes.apiError' });
  });

  it('explains a 400 on previous logs and keeps the generic message otherwise', async () => {
    const previousIo = fakeIo();
    openLogs(testConfig(), previousTarget, previousIo, fakeLogRequest(400).sendRequest);
    await flush();
    expect(previousIo.end).toHaveBeenCalledWith(null, { code: 'kubernetes.noPreviousContainer' });

    const logsIo = fakeIo();
    openLogs(testConfig(), logsTarget, logsIo, fakeLogRequest(400).sendRequest);
    await flush();
    expect(logsIo.end).toHaveBeenCalledWith(null, { code: 'kubernetes.apiError' });
  });

  it('does not end the terminal after a close that raced the response', async () => {
    const io = fakeIo();
    const sendRequest: LogRequest = (_url, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(abortError()));
    });
    const stream = openLogs(testConfig(), logsTarget, io, sendRequest);
    stream.close();
    await flush();
    expect(io.end).not.toHaveBeenCalled();
  });
});

describe('watchEnd', () => {
  const named = (name: string) => Object.assign(new Error('aborted'), { name });

  it('treats timeouts and aborts that were not ours as a normal end', () => {
    expect(watchEnd(named('TimeoutError'), false)).toBeUndefined();
    expect(watchEnd(named('AbortError'), false)).toBeUndefined();
    expect(watchEnd(new TypeError('fetch failed', { cause: named('TimeoutError') }), false)).toBeUndefined();
    expect(watchEnd(new TypeError('fetch failed', { cause: named('AbortError') }), false)).toBeUndefined();
  });

  it('ignores every end after our own stop()', () => {
    expect(watchEnd(named('AbortError'), true)).toBe('ignore');
    expect(watchEnd(undefined, true)).toBe('ignore');
    expect(watchEnd(named('TimeoutError'), true)).toBe('ignore');
  });

  it('reports a clean close as no error and other failures as safe KubeApiErrors', () => {
    expect(watchEnd(undefined, false)).toBeUndefined();
    const forbidden = watchEnd(Object.assign(new Error('HTTP-Code: 403 Body: x Headers: y'), { statusCode: 403 }), false);
    expect(forbidden).toBeInstanceOf(KubeApiError);
    expect((forbidden as KubeApiError).code).toBe(403);
    expect((forbidden as KubeApiError).message).not.toMatch(/Body:|Headers:/);
  });
});

describe('createKubeApi.watch', () => {
  it('sets the long request timeout, asks the server for a timeout, and forwards ERROR events', async () => {
    let captured: { timeout: number; query: Record<string, unknown>; callback: (type: string, object: unknown) => void; done: (err: unknown) => void } | undefined;
    const controller = new AbortController();
    const spy = vi.spyOn(Watch.prototype, 'watch').mockImplementation(async function (this: Watch, _path, query, callback, done) {
      captured = { timeout: (this as unknown as { requestTimeoutMs: number }).requestTimeoutMs, query, callback, done };
      return controller;
    });
    try {
      const onEvent = vi.fn();
      const onEnd = vi.fn();
      const handle = await createKubeApi(testConfig()).watch('pods', 'shop', undefined, '7', onEvent, onEnd);
      expect(captured?.timeout).toBe(600_000);
      expect(captured?.query).toMatchObject({ resourceVersion: '7', timeoutSeconds: 300 });

      captured?.callback('ERROR', { kind: 'Status', code: 410 });
      expect(onEvent).toHaveBeenCalledWith('ERROR', { kind: 'Status', code: 410 });

      captured?.done(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(onEnd).toHaveBeenLastCalledWith(undefined);

      handle.stop();
      captured?.done(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      expect(onEnd).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('createKubeApi client reuse', () => {
  it('creates the object API client once per createKubeApi', async () => {
    const fakeClient = { read: vi.fn(async () => ({ kind: 'Pod' })), list: vi.fn(async () => ({ items: [], metadata: {} })) };
    const spy = vi.spyOn(KubernetesObjectApi, 'makeApiClient').mockReturnValue(fakeClient as never);
    try {
      const api = createKubeApi(testConfig());
      await api.read({ kind: 'pods', namespace: 'shop', name: 'a' } as never);
      await api.read({ kind: 'pods', namespace: 'shop', name: 'b' } as never);
      await api.list('pods', 'shop');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(fakeClient.read).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('manualJobBody', () => {
  const cron = {
    metadata: { name: 'backup', namespace: 'shop', uid: 'u-1', resourceVersion: '9', labels: { app: 'x' } },
    spec: { schedule: '* * * * *', jobTemplate: { metadata: { labels: { a: 'b' }, annotations: { n: 'v' }, name: 'ignored' }, spec: { template: { spec: {} } } } },
  };

  it('builds an owned batch/v1 job from the template', () => {
    expect(manualJobBody(cron, 'backup-manual-1')).toEqual({
      apiVersion: 'batch/v1', kind: 'Job',
      metadata: {
        name: 'backup-manual-1', namespace: 'shop', labels: { a: 'b' },
        annotations: { n: 'v', 'cronjob.kubernetes.io/instantiate': 'manual' },
        ownerReferences: [{ apiVersion: 'batch/v1', kind: 'CronJob', name: 'backup', uid: 'u-1', controller: true, blockOwnerDeletion: true }],
      },
      spec: { template: { spec: {} } },
    });
  });

  it('omits labels when the template has none and rejects incomplete cronjobs', () => {
    const bare = { ...cron, spec: { jobTemplate: { spec: { x: 1 } } } };
    const body = manualJobBody(bare, 'j') as { metadata: Record<string, unknown> };
    expect('labels' in body.metadata).toBe(false);
    expect(() => manualJobBody({ ...cron, metadata: { name: 'backup', namespace: 'shop' } }, 'j')).toThrow(KubeApiError);
    expect(() => manualJobBody({ metadata: cron.metadata, spec: {} }, 'j')).toThrowError(expect.objectContaining({ coded: { code: 'kubernetes.cronJobIncomplete' } }));
    expect(() => manualJobBody({ metadata: cron.metadata, spec: {} }, 'j')).toThrow(KubeApiError);
  });
});

describe('createKubeApi remove and createJobFrom', () => {
  it('passes the propagation policy at position 6 and creates with the field manager', async () => {
    const cronObject = { metadata: { name: 'backup', namespace: 'shop', uid: 'u' }, spec: { jobTemplate: { spec: { t: 1 } } } };
    const fakeClient = { delete: vi.fn(async () => ({})), create: vi.fn(async () => ({})), read: vi.fn(async () => cronObject) };
    const spy = vi.spyOn(KubernetesObjectApi, 'makeApiClient').mockReturnValue(fakeClient as never);
    try {
      const api = createKubeApi(testConfig());
      await api.remove({ kind: 'jobs', namespace: 'shop', name: 'j' }, { propagationPolicy: 'Background' });
      expect(fakeClient.delete).toHaveBeenCalledWith(expect.objectContaining({ kind: 'Job' }), undefined, undefined, undefined, undefined, 'Background');
      await api.createJobFrom({ kind: 'cronjobs', namespace: 'shop', name: 'backup' }, 'backup-manual-1');
      expect(fakeClient.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'Job' }), undefined, undefined, 'shellherd');
    } finally {
      spy.mockRestore();
    }
  });
});
