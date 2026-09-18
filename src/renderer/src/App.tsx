import { useEffect, useState } from 'react';

export default function App() {
  const [version, setVersion] = useState('…');

  useEffect(() => {
    void window.desktopApi.getVersion().then(setVersion);
  }, []);

  return (
    <main className="app-shell">
      <section className="welcome-card">
        <div className="eyebrow">Meilenstein 1</div>
        <h1>Terminus</h1>
        <p className="subtitle">
          Das sichere Grundgerüst läuft. Als Nächstes bauen wir das verschlüsselte
          JSON-Vault.
        </p>

        <div className="status-row">
          <span className="status-dot" aria-hidden="true" />
          <span>Electron, React und TypeScript sind verbunden</span>
        </div>

        <footer>Version {version}</footer>
      </section>
    </main>
  );
}
