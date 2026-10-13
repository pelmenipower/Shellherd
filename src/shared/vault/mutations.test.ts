import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  addNode,
  removeNode,
  removeNodeFromVault,
  updateNode,
} from './mutations';

import type {
  FolderNode,
  Vault,
  VaultNode,
} from './types';

describe('addNode', () => {
  it('adds a node to the root level', () => {
    const nodes: VaultNode[] = [];

    const folder: FolderNode = {
      id: 'folder-production',
      type: 'folder',
      name: 'Produktion',
      children: [],
    };

    const result = addNode(nodes, folder);

    expect(result).toEqual([folder]);

    // Das ursprüngliche Array bleibt unverändert.
    expect(nodes).toEqual([]);
  });

  it('adds a node to a nested folder', () => {
    const nodes: VaultNode[] = [
      {
        id: 'folder-root',
        type: 'folder',
        name: 'Root',
        children: [
          {
            id: 'folder-linux',
            type: 'folder',
            name: 'Linux',
            children: [],
          },
        ],
      },
    ];

    const connection: VaultNode = {
      id: 'connection-api',
      type: 'connection', protocol: 'ssh',
      name: 'API Server',
      host: 'api.example.local',
      port: 22,
      username: 'developer',
      authentication: {
        method: 'agent',
      },
      tags: ['production'],
    };

    const result = addNode(
      nodes,
      connection,
      'folder-linux',
    );

    const rootFolder = result[0];

    expect(rootFolder.type).toBe('folder');

    if (rootFolder.type !== 'folder') {
      throw new Error('Root muss ein Ordner sein.');
    }

    const linuxFolder = rootFolder.children[0];

    expect(linuxFolder.type).toBe('folder');

    if (linuxFolder.type !== 'folder') {
      throw new Error('Linux muss ein Ordner sein.');
    }

    expect(linuxFolder.children).toEqual([
      connection,
    ]);
  });

  it('rejects an unknown parent folder', () => {
    expect(() =>
      addNode(
        [],
        {
          id: 'folder-new',
          type: 'folder',
          name: 'Neuer Ordner',
          children: [],
        },
        'folder-missing',
      ),
    ).toThrow('wurde nicht gefunden');
  });
});

describe('updateNode', () => {
  it('updates a node on the root level', () => {
    const nodes: VaultNode[] = [
      {
        id: 'folder-production',
        type: 'folder',
        name: 'Produktion',
        children: [],
      },
    ];

    const result = updateNode(
      nodes,
      'folder-production',
      (node) => ({
        ...node,
        name: 'Produktionsserver',
      }),
    );

    expect(result[0].name).toBe(
      'Produktionsserver',
    );

    // Das ursprüngliche Objekt bleibt unverändert.
    expect(nodes[0].name).toBe('Produktion');
  });

  it('updates a connection inside a nested folder', () => {
    const nodes: VaultNode[] = [
      {
        id: 'folder-root',
        type: 'folder',
        name: 'Root',
        children: [
          {
            id: 'folder-linux',
            type: 'folder',
            name: 'Linux',
            children: [
              {
                id: 'connection-api',
                type: 'connection', protocol: 'ssh',
                name: 'Alter API-Server',
                host: 'old.example.local',
                port: 22,
                authentication: {
                  method: 'agent',
                },
                tags: [],
              },
            ],
          },
        ],
      },
    ];

    const result = updateNode(
      nodes,
      'connection-api',
      (node) => ({
        ...node,
        name: 'Neuer API-Server',
      }),
    );

    const root = result[0];

    if (root.type !== 'folder') {
      throw new Error('Root muss ein Ordner sein.');
    }

    const linux = root.children[0];

    if (linux.type !== 'folder') {
      throw new Error('Linux muss ein Ordner sein.');
    }

    expect(linux.children[0].name).toBe(
      'Neuer API-Server',
    );
  });

  it('rejects an unknown node ID', () => {
    expect(() =>
      updateNode(
        [],
        'node-missing',
        (node) => node,
      ),
    ).toThrow('wurde nicht gefunden');
  });
});

describe('removeNode', () => {
  it('removes a node from the root level', () => {
    const nodes: VaultNode[] = [
      {
        id: 'folder-production',
        type: 'folder',
        name: 'Produktion',
        children: [],
      },
      {
        id: 'folder-development',
        type: 'folder',
        name: 'Entwicklung',
        children: [],
      },
    ];

    const result = removeNode(
      nodes,
      'folder-production',
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(
      'folder-development',
    );

    // Das ursprüngliche Array bleibt unverändert.
    expect(nodes).toHaveLength(2);
  });

  it('removes a connection from a nested folder', () => {
    const nodes: VaultNode[] = [
      {
        id: 'folder-root',
        type: 'folder',
        name: 'Root',
        children: [
          {
            id: 'folder-linux',
            type: 'folder',
            name: 'Linux',
            children: [
              {
                id: 'connection-api',
                type: 'connection', protocol: 'ssh',
                name: 'API Server',
                host: 'api.example.local',
                port: 22,
                authentication: {
                  method: 'agent',
                },
                tags: [],
              },
            ],
          },
        ],
      },
    ];

    const result = removeNode(
      nodes,
      'connection-api',
    );

    const root = result[0];

    if (root.type !== 'folder') {
      throw new Error('Root muss ein Ordner sein.');
    }

    const linux = root.children[0];

    if (linux.type !== 'folder') {
      throw new Error('Linux muss ein Ordner sein.');
    }

    expect(linux.children).toEqual([]);
  });

  it('removes an entire folder subtree', () => {
    const nodes: VaultNode[] = [
      {
        id: 'folder-production',
        type: 'folder',
        name: 'Produktion',
        children: [
          {
            id: 'connection-api',
            type: 'connection', protocol: 'ssh',
            name: 'API Server',
            host: 'api.example.local',
            port: 22,
            authentication: {
              method: 'agent',
            },
            tags: [],
          },
        ],
      },
    ];

    const result = removeNode(
      nodes,
      'folder-production',
    );

    expect(result).toEqual([]);
  });

  it('rejects an unknown node ID', () => {
    expect(() =>
      removeNode([], 'node-missing'),
    ).toThrow('wurde nicht gefunden');
  });
});

describe('removeNodeFromVault', () => {
  it('removes all folder connections from workspace layouts', () => {
    const vault: Vault = {
      format: 'terminus-vault',
      version: 2,
      id: 'vault-test',
      name: 'Test Vault',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',

      nodes: [
        {
          id: 'folder-production',
          type: 'folder',
          name: 'Produktion',
          children: [
            {
              id: 'connection-api',
              type: 'connection', protocol: 'ssh',
              name: 'API',
              host: 'api.local',
              port: 22,
              authentication: {
                method: 'agent',
              },
              tags: [],
            },
            {
              id: 'connection-database',
              type: 'connection', protocol: 'ssh',
              name: 'Datenbank',
              host: 'database.local',
              port: 22,
              authentication: {
                method: 'agent',
              },
              tags: [],
            },
          ],
        },
        {
          id: 'connection-jump-host',
          type: 'connection', protocol: 'ssh',
          name: 'Jump Host',
          host: 'jump.local',
          port: 22,
          authentication: {
            method: 'agent',
          },
          tags: [],
        },
      ],

      workspaces: [
        {
          id: 'workspace-production',
          name: 'Produktion',
          layout: {
            type: 'split',
            direction: 'horizontal',
            ratio: 0.5,
            first: {
              type: 'pane',
              connectionIds: [
                'connection-api',
                'connection-jump-host',
              ],
              activeConnectionId: 'connection-api',
            },
            second: {
              type: 'pane',
              connectionIds: [
                'connection-database',
                'connection-jump-host',
              ],
              activeConnectionId:
                'connection-database',
            },
          },
        },
      ],

      settings: {
        theme: 'dark',
        autoLockMinutes: 15,
        confirmBeforeClosingSession: true,
      },
    };

    const result = removeNodeFromVault(
      vault,
      'folder-production',
    );

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe(
      'connection-jump-host',
    );

    const layout = result.workspaces[0].layout;

    if (layout.type !== 'split') {
      throw new Error(
        'Das Layout muss ein Split sein.',
      );
    }

    expect(layout.first).toEqual({
      type: 'pane',
      connectionIds: ['connection-jump-host'],
      activeConnectionId:
        'connection-jump-host',
    });

    expect(layout.second).toEqual({
      type: 'pane',
      connectionIds: ['connection-jump-host'],
      activeConnectionId:
        'connection-jump-host',
    });

    // Der ursprüngliche Vault bleibt unverändert.
    expect(vault.nodes).toHaveLength(2);
  });
});