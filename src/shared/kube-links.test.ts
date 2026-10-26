import { describe, expect, it } from 'vitest';
import { argoAppOf, argoAppParts, argoAppUrl, digestOf, harborImageUrl, httpsBase, linkHost, parseImage } from './kube-links';

const ARGO = 'https://argocd.example.test';
const HARBOR = 'https://harbor.example.test';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const BACKSLASH = String.fromCharCode(92);
const tracking = (value: string) => ({ 'argocd.argoproj.io/tracking-id': value });

describe('httpsBase', () => {
  it('normalizes https addresses: lower-case host, default port and trailing slashes removed, path prefix kept', () => {
    expect(httpsBase('https://Argo.Example.com/')).toBe('https://argo.example.com');
    expect(httpsBase('https://h.example.test:443/x/')).toBe('https://h.example.test/x');
    expect(httpsBase(' https://h.example.test ')).toBe('https://h.example.test');
    expect(httpsBase('https://ops.example.com/argo-cd')).toBe('https://ops.example.com/argo-cd');
    expect(httpsBase('https://h.example.test:8443')).toBe('https://h.example.test:8443');
    expect(httpsBase('https://bücher.example')).toBe('https://xn--bcher-kva.example');
  });

  it('is stable: a normalized address normalizes to itself', () => {
    for (const raw of ['https://Argo.Example.com/', 'https://h.example.test/a b/', `https://h.example.test${BACKSLASH}x`, 'https://bücher.example/x/../y', 'https://[::1]:8443/']) {
      const base = httpsBase(raw);
      expect(base).not.toBeNull();
      expect(httpsBase(base)).toBe(base);
    }
  });

  it('refuses everything but plain https', () => {
    for (const raw of ['http://h.example.test', 'javascript:alert(1)', 'file:///C:/x', 'data:text/html,x', 'https://u:p@h.example.test', 'https://u@h.example.test',
      'https://h.example.test/?a=1', 'https://h.example.test/#x', 'https://h%2Fevil.com', 'https://evil.com%2F@h.example.test', `https://h.example.test/${'x'.repeat(513)}`, 'h.example.test', '']) {
      expect(httpsBase(raw)).toBeNull();
    }
    for (const raw of [null, undefined, 42, {}, ['https://h.example.test']]) expect(httpsBase(raw)).toBeNull();
  });

  it('gives the host with a non-default port for menu hints', () => {
    expect(linkHost('https://h.example.test:8443/x')).toBe('h.example.test:8443');
    expect(linkHost('https://h.example.test:443')).toBe('h.example.test');
    expect(linkHost('http://h.example.test')).toBe('');
  });
});

describe('argoAppOf', () => {
  it('takes the tracking annotation when it names this object, before the label', () => {
    expect(argoAppOf({ name: 'api', namespace: 'shop', annotations: tracking('shop:apps/Deployment:shop/api') })).toBe('shop');
    expect(argoAppOf({ name: 'api', namespace: 'shop', annotations: tracking('team-a_shop:apps/Deployment:shop/api') })).toBe('team-a_shop');
    expect(argoAppOf({ name: 'api', namespace: 'shop', labels: { 'argocd.argoproj.io/instance': 'other' }, annotations: tracking('shop:apps/Deployment:shop/api') })).toBe('shop');
    expect(argoAppOf({ name: 'shop', annotations: tracking('shop:/Namespace:/shop') })).toBe('shop');
  });

  it('ignores a copied annotation of another object and falls back to the label', () => {
    const label = { 'argocd.argoproj.io/instance': 'fallback' };
    expect(argoAppOf({ name: 'api', namespace: 'shop', labels: label, annotations: tracking('shop:apps/Deployment:shop/other') })).toBe('fallback');
    expect(argoAppOf({ name: 'api', namespace: 'shop', labels: label, annotations: tracking('shop:apps/Deployment:prod/api') })).toBe('fallback');
    expect(argoAppOf({ name: 'api', namespace: 'shop', annotations: tracking('shop:apps/Deployment:prod/api') })).toBeUndefined();
  });

  it('takes only valid application names, never host or path parts', () => {
    expect(argoAppOf({ name: 'api', labels: { 'argocd.argoproj.io/instance': 'shop' } })).toBe('shop');
    expect(argoAppOf({ name: 'api', labels: { 'argocd.argoproj.io/instance': 'team-a_shop' } })).toBe('team-a_shop');
    for (const value of ['evil.example.test/x', 'a b', 'A', 'x:y', 'shop_', '_shop', 'a_b_c', '-a', 'a.', '..', 'x'.repeat(254)]) {
      expect(argoAppOf({ name: 'api', labels: { 'argocd.argoproj.io/instance': value } })).toBeUndefined();
    }
    expect(argoAppOf({ name: 'checkout', namespace: 'shop', annotations: tracking('evil.example.test/x:apps/Deployment:shop/checkout') })).toBeUndefined();
    expect(argoAppOf({ name: 'api', namespace: 'shop', annotations: tracking('Shop:apps/Deployment:shop/api') })).toBeUndefined();
    expect(argoAppOf({ name: 'api', labels: { 'app.kubernetes.io/instance': 'shop' } })).toBeUndefined();
    expect(argoAppOf({ name: 'api', labels: { 'argocd.argoproj.io/instance': 7 }, annotations: ['x'] })).toBeUndefined();
  });

  it('splits namespace_name and caps the length', () => {
    expect(argoAppParts('shop')).toEqual({ name: 'shop' });
    expect(argoAppParts('team-a_shop')).toEqual({ namespace: 'team-a', name: 'shop' });
    expect(argoAppParts('x'.repeat(253))).toEqual({ name: 'x'.repeat(253) });
    expect(argoAppParts('x'.repeat(254))).toBeNull();
    expect(argoAppParts(`${'a'.repeat(64)}_b`)).toBeNull();
  });
});

describe('argoAppUrl', () => {
  it('builds the application page under the address, path prefix kept', () => {
    expect(argoAppUrl(ARGO, 'shop')).toBe(`${ARGO}/applications/shop`);
    expect(argoAppUrl(ARGO, 'team-a_shop')).toBe(`${ARGO}/applications/team-a/shop`);
    expect(argoAppUrl('https://ops.example.com/argo-cd', 'shop')).toBe('https://ops.example.com/argo-cd/applications/shop');
    expect(argoAppUrl(`${ARGO}/`, 'shop')).toBe(`${ARGO}/applications/shop`);
  });

  it('never leaves the host of the address and refuses invalid names or addresses', () => {
    expect(argoAppUrl(ARGO, 'evil.com')).toBe(`${ARGO}/applications/evil.com`);
    for (const app of ['evil.com/x', '//evil.com', '..', 'a b', '']) expect(argoAppUrl(ARGO, app)).toBeNull();
    expect(argoAppUrl('http://argocd.example.test', 'shop')).toBeNull();
    expect(argoAppUrl('', 'shop')).toBeNull();
  });
});

describe('parseImage and harborImageUrl', () => {
  it('links a tag to the repository page and a digest to the artifact page', () => {
    expect(harborImageUrl(HARBOR, 'harbor.example.test/shop/api:2.4.1')).toBe(`${HARBOR}/harbor/projects/shop/repositories/api/artifacts-tab`);
    expect(harborImageUrl(HARBOR, `harbor.example.test/shop/api@${DIGEST}`)).toBe(`${HARBOR}/harbor/projects/shop/repositories/api/artifacts-tab/artifacts/${DIGEST}`);
    expect(harborImageUrl(HARBOR, `harbor.example.test/shop/api:1@${DIGEST}`)).toBe(`${HARBOR}/harbor/projects/shop/repositories/api/artifacts-tab/artifacts/${DIGEST}`);
    expect(harborImageUrl(HARBOR, 'harbor.example.test/shop/api:1', DIGEST)).toBe(`${HARBOR}/harbor/projects/shop/repositories/api/artifacts-tab/artifacts/${DIGEST}`);
    expect(harborImageUrl(HARBOR, 'harbor.example.test/shop/api:1', 'sha256:x/../../evil')).toBe(`${HARBOR}/harbor/projects/shop/repositories/api/artifacts-tab`);
    expect(harborImageUrl(HARBOR, 'harbor.example.test/shop/team/api:1')).toBe(`${HARBOR}/harbor/projects/shop/repositories/team%2Fapi/artifacts-tab`);
    expect(parseImage('harbor.example.test/shop/team/api:1')).toEqual({ host: 'harbor.example.test', project: 'shop', repository: 'team/api', tag: '1' });
  });

  it('matches the host with port and case, :443 counts as no port', () => {
    expect(harborImageUrl(HARBOR, 'HARBOR.example.test/shop/api')).not.toBeNull();
    expect(harborImageUrl(HARBOR, 'harbor.example.test:443/shop/api')).not.toBeNull();
    expect(harborImageUrl(HARBOR, 'harbor.example.test:8443/shop/api')).toBeNull();
    expect(harborImageUrl('https://harbor.example.test:8443', 'harbor.example.test:8443/shop/api')).toBe('https://harbor.example.test:8443/harbor/projects/shop/repositories/api/artifacts-tab');
    expect(harborImageUrl('https://bücher.example', 'xn--bcher-kva.example/shop/api')).toBe('https://xn--bcher-kva.example/harbor/projects/shop/repositories/api/artifacts-tab');
  });

  it('refuses other hosts, Docker Hub short names and anything outside the OCI patterns', () => {
    for (const image of ['registry.local/shop/api:1', 'nginx:1', 'library/nginx', 'harbor.example.test/shop', 'harbor.example.test/shop/api:1#@evil.com',
      'harbor.example.test/shop/../x', 'harbor.example.test/shop/%2F%2Fevil.com/x', 'harbor.example.test/shop/api:1@sha256:bad', 'user@harbor.example.test/shop/api',
      'harbor.example.test/shop//api', `harbor.example.test${BACKSLASH}shop${BACKSLASH}api`, `harbor.example.test/shop/api${BACKSLASH}..`, 'harbor.example.test/Shop/api',
      'harbor.example.test/shop/api:', 'harbor.example.test/shop/api:1:2', 'harbor.example.test/shop/api:..', 'bücher.example/shop/api', 'harbor.example.test./shop/api',
      '//harbor.example.test/shop/api', 'evil.com/harbor.example.test/shop/api']) {
      expect(harborImageUrl(HARBOR, image)).toBeNull();
    }
    expect(harborImageUrl('http://harbor.example.test', 'harbor.example.test/shop/api')).toBeNull();
  });

  it('keeps every link on the origin of the address, whatever the cluster sends', () => {
    const hostile = ['evil.com', 'a@b', '//evil.com', '..', '%2e%2e', 'shop:x', 'x'.repeat(300), 'harbor.example.test@evil.com/shop/api', 'harbor.example.test/shop/api:1@sha256:' + 'f'.repeat(64)];
    for (const base of [ARGO, 'https://ops.example.com/argo-cd', 'https://h.example.test:8443']) {
      for (const value of hostile) {
        for (const link of [argoAppUrl(base, value), harborImageUrl(base, value), harborImageUrl(base, `h.example.test:8443/shop/${value}`)]) {
          if (link !== null) expect(new URL(link).origin).toBe(new URL(base).origin);
        }
      }
    }
  });
});

describe('digestOf', () => {
  it('takes the digest of the running image of the same repository', () => {
    expect(digestOf('harbor.example.test/shop/api:2.4.1', `harbor.example.test/shop/api@${DIGEST}`)).toBe(DIGEST);
    expect(digestOf('harbor.example.test/shop/api:2.4.1', `docker-pullable://harbor.example.test/shop/api@${DIGEST}`)).toBe(DIGEST);
    expect(digestOf('harbor.example.test:5000/shop/api', `harbor.example.test:5000/shop/api@${DIGEST}`)).toBe(DIGEST);
  });

  it('ignores another repository, a bare digest and missing ids', () => {
    expect(digestOf('harbor.example.test/shop/api', `mirror.example.test/shop/api@${DIGEST}`)).toBeUndefined();
    expect(digestOf('harbor.example.test/shop/api', DIGEST)).toBeUndefined();
    expect(digestOf('harbor.example.test/shop/api', undefined)).toBeUndefined();
    expect(digestOf('harbor.example.test/shop/api', 'harbor.example.test/shop/api@sha256:bad')).toBeUndefined();
  });
});
