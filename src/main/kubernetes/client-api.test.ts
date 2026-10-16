import { describe, expect, it } from 'vitest';
import { resourcePath, selectorQuery, toApiError } from './client-api';

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
  it('translates HTTP errors into German messages', () => {
    expect(toApiError({ code: 403, body: { message: 'pods "x" is forbidden: User "u" cannot delete resource "pods" in API group "" in the namespace "shop"' } }).message)
      .toBe('Keine Berechtigung: pods/delete in shop');
    expect(toApiError({ code: 401 }).message).toBe('Nicht angemeldet. Die Zugangsdaten der kubeconfig wurden abgelehnt.');
    expect(toApiError({ code: 404 }).message).toBe('Die Ressource gibt es nicht (mehr).');
    expect(toApiError({ statusCode: 410 }).code).toBe(410);
    expect(toApiError(Object.assign(new Error('x'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID', reason: "Host: 10.0.0.5. is not in the cert's altnames: DNS:kubernetes" })).message)
      .toBe("TLS: Das Zertifikat des API-Servers passt nicht zum Namen (Host: 10.0.0.5. is not in the cert's altnames: DNS:kubernetes).");
    expect(toApiError(new Error('socket hang up')).message).toBe('Die Verbindung zum API-Server ist abgebrochen.');
  });
});
