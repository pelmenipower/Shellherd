# SSH Vault

Lokaler SSH-Verbindungsmanager mit verschlüsselten, portablen JSON-Vaults.

## Entwicklungsstand

Meilenstein 1 stellt die sichere Electron-Prozessarchitektur bereit:

- `src/main`: Desktop-Prozess mit Zugriff auf Betriebssystemfunktionen
- `src/preload`: schmale, kontrollierte Brücke zur Oberfläche
- `src/renderer`: React-Oberfläche ohne direkten Node.js-Zugriff

## Lokal starten

```bash
npm install
npm run dev
```

## Qualität prüfen

```bash
npm run typecheck
npm run build
```

## Nächster Meilenstein

Definition des JSON-Datenmodells und Erstellen, Verschlüsseln sowie Öffnen einer
`.sshvault`-Datei.
