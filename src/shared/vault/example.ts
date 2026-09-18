import type { Vault } from './types';

export const exampleVault = {
  format: 'terminus-vault',
  version: 1,

  id: 'vault-example',
  name: 'Meine Server',
  comment: 'Lokale Entwicklungs-Vault',

  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),

  nodes: [
    {
      id: 'folder-development',
      type: 'folder',
      name: 'Entwicklung',
      comment: 'Nicht produktive Systeme',

      children: [
        {
          id: 'connection-dev-api',
          type: 'connection',
          name: 'Development API',
          comment: 'Lokaler Testserver',

          host: 'dev-api.example.local',
          port: 22,
          username: 'developer',

          authentication: {
            method: 'agent',
          },

          tags: ['development', 'api'],
          color: '#22c55e',
        },
      ],
    },
  ],

  workspaces: [
    {
      id: 'workspace-development',
      name: 'Entwicklung',

      layout: {
        type: 'pane',
        connectionIds: ['connection-dev-api'],
        activeConnectionId: 'connection-dev-api',
      },
    },
  ],

  settings: {
    theme: 'dark',
    autoLockMinutes: 15,
    confirmBeforeClosingSession: true,
  },
} satisfies Vault;