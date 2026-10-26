import { describe, expect, it } from 'vitest';
import type { KubeForwardStatus, KubeRow } from '../../shared/kubernetes';
import { forwardAddress, forwardTargetOf, forwardUrl, parsePort, portLabel, targetText } from './kube-forward';

const status = (port: number): KubeForwardStatus => ({ id: 'f1', target: { kind: 'pods', namespace: 'shop', name: 'api-1', port }, localPort: 18080, open: 0 });
const row = (kind: KubeRow['ref']['kind'], namespace?: string): KubeRow => ({ uid: 'u', ref: { kind, ...(namespace ? { namespace } : {}), name: 'api' }, cells: {}, tone: 'ok', labels: {} });

describe('kube-forward helpers', () => {
  it('parses ports from form fields', () => {
    expect(parsePort('8080', false)).toBe(8080);
    expect(parsePort(' 80 ', false)).toBe(80);
    expect(parsePort('', true)).toBe(0);
    expect(parsePort('', false)).toBeNaN();
    for (const text of ['0', '65536', '8o', '-1', '1e3', '123456']) expect(parsePort(text, true), text).toBeNaN();
  });

  it('writes targets like kubectl and addresses with 127.0.0.1, never localhost', () => {
    expect(targetText({ kind: 'pods', namespace: 'shop', name: 'api-1', port: 8080 })).toBe('api-1:8080');
    expect(targetText({ kind: 'services', namespace: 'shop', name: 'api', port: 80 })).toBe('svc/api:80');
    expect(forwardAddress(status(80))).toBe('127.0.0.1:18080');
    expect(forwardUrl(status(80))).toBe('http://127.0.0.1:18080/');
    expect(forwardUrl(status(443))).toBe('https://127.0.0.1:18080/');
    expect(forwardUrl(status(8443))).toBe('https://127.0.0.1:18080/');
  });

  it('offers targets for namespaced pods and services only and labels ports', () => {
    expect(forwardTargetOf(row('pods', 'shop'), 8080)).toEqual({ kind: 'pods', namespace: 'shop', name: 'api', port: 8080 });
    expect(forwardTargetOf(row('services', 'shop'), 80)).toEqual({ kind: 'services', namespace: 'shop', name: 'api', port: 80 });
    expect(forwardTargetOf(row('deployments', 'shop'), 80)).toBeNull();
    expect(forwardTargetOf(row('pods'), 80)).toBeNull();
    expect(portLabel({ port: 8080, name: 'http' })).toBe('8080 (http)');
    expect(portLabel({ port: 8080 })).toBe('8080');
  });
});
