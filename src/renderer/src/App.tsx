import {
  useEffect,
  useState,
} from 'react';

import type {
  FormEvent,
  ReactNode,
} from 'react';

import type {
  Vault,
  VaultNode,
} from '../../shared/vault/types';

type Screen = 'home' | 'create' | 'open' | 'vault';

function createEmptyVault(name: string): Vault {
  const now = new Date().toISOString();

  return {
    format: 'terminus-vault',
    version: 1,

    id: crypto.randomUUID(),
    name: name.trim(),

    createdAt: now,
    updatedAt: now,

    nodes: [],
    workspaces: [],
    settings: {
      theme: 'dark',
      autoLockMinutes: 15,
      confirmBeforeClosingSession: true,
    },
  };
}

function countConnections(nodes: VaultNode[]): number {
  return nodes.reduce((count, node) => {
    if (node.type === 'connection') {
      return count + 1;
    }

    return count + countConnections(node.children);
  }, 0);
}

function renderNodes(nodes: VaultNode[]): ReactNode {
  if (nodes.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⌁</div>
        <h3>Noch keine Verbindungen</h3>
        <p>
          Als Nächstes bauen wir das Anlegen von Ordnern und
          SSH-Verbindungen.
        </p>
      </div>
    );
  }

  return (
    <ul className="node-list">
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="node-row">
            <span className="node-icon">
              {node.type === 'folder' ? '▾' : '›_'}
            </span>

            <div>
              <strong>{node.name}</strong>

              {node.type === 'connection' && (
                <span className="node-address">
                  {node.username
                    ? `${node.username}@`
                    : ''}
                  {node.host}:{node.port}
                </span>
              )}
            </div>
          </div>

          {node.type === 'folder' &&
            renderNodes(node.children)}
        </li>
      ))}
    </ul>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (
      error.message.includes('authenticate') ||
      error.message.includes('Unsupported state')
    ) {
      return 'Das Passwort ist falsch oder die Vault-Datei wurde verändert.';
    }
  }

  return 'Der Vault konnte nicht verarbeitet werden.';
}

export default function App() {
  const [version, setVersion] = useState('…');
  const [screen, setScreen] = useState<Screen>('home');

  const [vault, setVault] = useState<Vault | null>(null);
  const [vaultPath, setVaultPath] = useState<string | null>(
    null,
  );

  const [vaultName, setVaultName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] =
    useState('');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.desktopApi
      .getVersion()
      .then(setVersion)
      .catch(() => setVersion('unbekannt'));
  }, []);

  function resetForm(): void {
    setVaultName('');
    setPassword('');
    setPasswordConfirmation('');
    setError(null);
  }

  function navigateTo(nextScreen: Screen): void {
    resetForm();
    setScreen(nextScreen);
  }

  async function handleCreateVault(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!vaultName.trim()) {
      setError('Bitte gib dem Vault einen Namen.');
      return;
    }

    if (password.length < 8) {
      setError(
        'Das Passwort muss mindestens 8 Zeichen lang sein.',
      );
      return;
    }

    if (password !== passwordConfirmation) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }

    const newVault = createEmptyVault(vaultName);

    setBusy(true);

    try {
      const result = await window.desktopApi.saveVault({
        vault: newVault,
        password,
        suggestedName: `${vaultName.trim()}.terminus`,
      });

      if (result.canceled) {
        return;
      }

      setVault(newVault);
      setVaultPath(result.filePath);
      setScreen('vault');
      resetForm();
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setPassword('');
      setPasswordConfirmation('');
      setBusy(false);
    }
  }

  async function handleOpenVault(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!password) {
      setError('Bitte gib das Vault-Passwort ein.');
      return;
    }

    setBusy(true);

    try {
      const result = await window.desktopApi.openVault({
        password,
      });

      if (result.canceled) {
        return;
      }

      setVault(result.vault);
      setVaultPath(result.filePath);
      setScreen('vault');
      resetForm();
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  function lockVault(): void {
    setVault(null);
    setVaultPath(null);
    resetForm();
    setScreen('home');
  }

  if (screen === 'vault' && vault) {
    const connectionCount = countConnections(vault.nodes);

    return (
      <main className="vault-shell">
        <header className="app-header">
          <div className="brand">
            <span className="brand-mark">›_</span>
            <span>Terminus</span>
          </div>

          <button
            className="secondary-button"
            type="button"
            onClick={lockVault}
          >
            Vault sperren
          </button>
        </header>

        <section className="vault-content">
          <aside className="sidebar">
            <div className="sidebar-heading">
              <span>Vault</span>
              <span className="connection-count">
                {connectionCount}
              </span>
            </div>

            {renderNodes(vault.nodes)}
          </aside>

          <section className="workspace">
            <div className="vault-heading">
              <div>
                <div className="eyebrow">
                  Verschlüsselter Vault geöffnet
                </div>
                <h1>{vault.name}</h1>

                {vault.comment && (
                  <p className="subtitle">{vault.comment}</p>
                )}
              </div>

              <div className="security-badge">
                <span className="status-dot" />
                Entschlüsselt
              </div>
            </div>

            <div className="workspace-placeholder">
              <span className="terminal-prompt">$</span>
              <h2>Bereit für die erste SSH-Verbindung</h2>
              <p>
                Dateizugriff, Verschlüsselung und IPC funktionieren.
                Als Nächstes kommt der Connection-Editor.
              </p>
            </div>

            <footer className="vault-footer">
              <span>{vaultPath}</span>
              <span>Version {version}</span>
            </footer>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="welcome-card">
        <div className="brand large-brand">
          <span className="brand-mark">›_</span>
          <span>Terminus</span>
        </div>

        {screen === 'home' && (
          <>
            <div className="eyebrow">Secure SSH Workspace</div>
            <h1>Deine Server.<br />Dein Vault.</h1>

            <p className="subtitle">
              SSH-Verbindungen, Ordner und Workspaces in einer
              lokal verschlüsselten Datei.
            </p>

            <div className="action-grid">
              <button
                className="primary-button"
                type="button"
                onClick={() => navigateTo('create')}
              >
                <span>＋</span>
                Neuen Vault erstellen
              </button>

              <button
                className="secondary-button"
                type="button"
                onClick={() => navigateTo('open')}
              >
                <span>↗</span>
                Vault öffnen
              </button>
            </div>

            <div className="status-row">
              <span className="status-dot" />
              <span>
                Argon2id und AES-256-GCM aktiv
              </span>
            </div>
          </>
        )}

        {screen === 'create' && (
          <form onSubmit={handleCreateVault}>
            <div className="eyebrow">Neuer Vault</div>
            <h2>Vault erstellen</h2>

            <label>
              Name
              <input
                autoFocus
                value={vaultName}
                onChange={(event) =>
                  setVaultName(event.target.value)
                }
                placeholder="Meine Server"
                disabled={busy}
              />
            </label>

            <label>
              Passwort
              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                autoComplete="new-password"
                disabled={busy}
              />
            </label>

            <label>
              Passwort wiederholen
              <input
                type="password"
                value={passwordConfirmation}
                onChange={(event) =>
                  setPasswordConfirmation(event.target.value)
                }
                autoComplete="new-password"
                disabled={busy}
              />
            </label>

            {error && (
              <div className="error-message">{error}</div>
            )}

            <div className="form-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => navigateTo('home')}
              >
                Zurück
              </button>

              <button
                className="primary-button"
                type="submit"
                disabled={busy}
              >
                {busy
                  ? 'Vault wird verschlüsselt …'
                  : 'Vault erstellen'}
              </button>
            </div>
          </form>
        )}

        {screen === 'open' && (
          <form onSubmit={handleOpenVault}>
            <div className="eyebrow">Vorhandener Vault</div>
            <h2>Vault öffnen</h2>

            <p className="form-description">
              Gib das Passwort ein und wähle anschließend deine
              `.terminus`-Datei aus.
            </p>

            <label>
              Passwort
              <input
                autoFocus
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                autoComplete="current-password"
                disabled={busy}
              />
            </label>

            {error && (
              <div className="error-message">{error}</div>
            )}

            <div className="form-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => navigateTo('home')}
              >
                Zurück
              </button>

              <button
                className="primary-button"
                type="submit"
                disabled={busy}
              >
                {busy
                  ? 'Vault wird entschlüsselt …'
                  : 'Datei auswählen'}
              </button>
            </div>
          </form>
        )}

        <footer>Terminus {version}</footer>
      </section>
    </main>
  );
}