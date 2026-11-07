import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { KubernetesConnectionNode } from '../../shared/vault/types';
import { DIRECT_FILE_MAX_BYTES, expandHome, openDirect, readLocalKubeconfig } from './direct';
import type { LocalFiles } from './direct';

const files = (over: Partial<LocalFiles> = {}): LocalFiles => ({
  stat: vi.fn(async () => ({ isFile: () => true, size: 10 })),
  readFile: vi.fn(async () => 'text'),
  ...over,
});
const node = (kubeconfig: unknown) => ({ protocol: 'kubernetes', kubeconfig }) as unknown as KubernetesConnectionNode;
const unreadable = (file: string) => expect.objectContaining({ code: 'kubernetes.kubeconfigFileUnreadable', params: { path: file } });

describe('expandHome', () => {
  it('resolves ~/ and ~\ against the given home and leaves other paths alone', () => {
    expect(expandHome('~/.kube/config', '/h')).toBe(path.join('/h', '.kube/config'));
    expect(expandHome('~\\.kube\\config', '/h')).toBe(path.join('/h', '.kube\\config'));
    expect(expandHome('/etc/k', '/h')).toBe('/etc/k');
  });
});

describe('readLocalKubeconfig', () => {
  it('reads the expanded path once', async () => {
    const f = files();
    const result = await readLocalKubeconfig('/etc/kube', f);
    expect(result).toEqual({ text: 'text', path: '/etc/kube' });
    expect(f.readFile).toHaveBeenCalledWith('/etc/kube', 'utf8');
  });
  it('turns any failure into kubeconfigFileUnreadable with the path as entered', async () => {
    const f = files({ stat: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } });
    await expect(readLocalKubeconfig('/nope', f)).rejects.toThrowError(unreadable('/nope'));
  });
  it('rejects non-files and big files without reading', async () => {
    const dir = files({ stat: async () => ({ isFile: () => false, size: 0 }) });
    await expect(readLocalKubeconfig('/dev/zero', dir)).rejects.toThrowError(unreadable('/dev/zero'));
    const big = files({ stat: async () => ({ isFile: () => true, size: DIRECT_FILE_MAX_BYTES + 1 }) });
    await expect(readLocalKubeconfig('/big', big)).rejects.toThrowError(unreadable('/big'));
    expect(dir.readFile).not.toHaveBeenCalled();
    expect(big.readFile).not.toHaveBeenCalled();
  });
  it('rejects UNC, device, relative and control-character paths without touching the disk', async () => {
    const f = files();
    for (const bad of ['\\\\server\\share\\c', '//server/c', '/\\server\\share\\c', '\\\\?\\C:\\c', 'rel/c', '/a\nb', '/a\0b']) {
      await expect(readLocalKubeconfig(bad, f)).rejects.toThrowError(unreadable(bad));
    }
    expect(f.stat).not.toHaveBeenCalled();
  });
});

describe('openDirect', () => {
  it('returns inline text with its policy', async () => {
    expect(await openDirect(node({ source: 'inline', text: 'T' }))).toEqual({ kubeconfig: 'T', source: 'inline', policy: { source: 'inline' } });
    expect((await openDirect(node({ source: 'inline', text: 'T', execConsent: 'cmd a' }))).policy).toEqual({ source: 'inline', execConsent: 'cmd a' });
  });
  it('reads a file and sets its folder as policy dir', async () => {
    const result = await openDirect(node({ source: 'file', path: '/k/dir/config' }), files());
    expect(result).toEqual({ kubeconfig: 'text', source: '/k/dir/config', policy: { source: 'file', dir: path.dirname('/k/dir/config') } });
  });
  it('refuses auto and path sources', async () => {
    await expect(openDirect(node({ source: 'auto' }))).rejects.toThrow();
  });
});
