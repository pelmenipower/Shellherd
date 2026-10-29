import { expect, it } from 'vitest';
import { joinPath, parentPath, pathSegments, resolveGoTo } from './file-browser';
import { bindingFromDraft, bindingName, autoUploadErrors } from './auto-upload-form';

it('navigates native Linux local directories without Windows separators', () => {
  expect(joinPath('local', '/home/alice', 'a.txt')).toBe('/home/alice/a.txt');
  expect(parentPath('local', '/home/alice')).toBe('/home');
  expect(parentPath('local', '/')).toBeNull();
  expect(pathSegments('local', '/home/alice')).toEqual([{ label: '/', path: '/' }, { label: 'home', path: '/home' }, { label: 'alice', path: '/home/alice' }]);
  expect(resolveGoTo('local', '~/project', '/tmp', '/home/alice')).toEqual({ path: '/home/alice/project' });
});
it('keeps Linux auto-upload paths and case-sensitive folder boundaries', () => {
  const base = { id: 'a', enabled: true, localPath: '/home/alice', remotePath: '/srv', excludes: [] };
  const binding = bindingFromDraft(base, { localPath: '/home/alice/Project/', remotePath: '/srv/project', excludes: '' });
  expect(binding.localPath).toBe('/home/alice/Project');
  expect(bindingName(binding)).toBe('Project');
  expect(autoUploadErrors(binding, [{ ...base, id: 'b', localPath: '/home/alice/project' }])).toEqual({});
  expect(autoUploadErrors(binding, [{ ...base, id: 'b', localPath: '/home/alice/Project/sub' }]).localPath).toBeTruthy();
});
