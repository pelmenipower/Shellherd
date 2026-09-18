# Meilenstein 1 verstehen

## Warum besteht die Anwendung aus drei Teilen?

Electron verbindet eine Weboberfläche mit einem Desktop-Programm. Damit die
Weboberfläche nicht unkontrolliert auf Dateien und Prozesse zugreifen kann,
teilen wir die Anwendung bewusst auf.

### 1. Main Process

Datei: `src/main/index.ts`

Der Main Process startet die Anwendung und erzeugt das Fenster. Nur dieser
Bereich darf später Dateien auswählen, Vaults speichern und SSH-Prozesse
starten.

```ts
const window = new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});
```

- `contextIsolation` trennt fremden Seiten-Code von unserer Brücke.
- `nodeIntegration: false` verhindert direkten Node.js-Zugriff in React.
- `sandbox: true` schränkt den Renderer zusätzlich ein.

### 2. Preload

Datei: `src/preload/index.ts`

Preload ist unsere kontrollierte Brücke. React bekommt nicht den gesamten
Electron-Zugriff, sondern nur einzeln freigegebene Funktionen.

```ts
contextBridge.exposeInMainWorld('desktopApi', {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
});
```

Später kommen hier beispielsweise `openVault()` und `saveVault()` hinzu. Die
Funktionen nehmen nur klar typisierte Daten entgegen.

### 3. Renderer

Dateien: `src/renderer/src/*`

Der Renderer ist unsere React-Anwendung. Er zeichnet die Oberfläche und hält
den sichtbaren Zustand. Direkter Dateisystem- oder Prozesszugriff ist hier
absichtlich nicht möglich.

## Die erste React-Komponente

`App` ist eine Funktion, die beschreibt, was angezeigt werden soll:

```tsx
export default function App() {
  const [version, setVersion] = useState('…');

  useEffect(() => {
    void window.desktopApi.getVersion().then(setVersion);
  }, []);

  return <main>Version {version}</main>;
}
```

- `useState` speichert einen Wert, dessen Änderung die Anzeige aktualisiert.
- `useEffect` führt Code nach dem ersten Rendern aus.
- Das leere Array `[]` bedeutet: nur einmal beim Start der Komponente.
- TSX erlaubt HTML-ähnliche Elemente direkt innerhalb von TypeScript.

## Was TypeScript hier für uns tut

`global.d.ts` beschreibt die Brücke, die im Browserfenster existiert:

```ts
interface DesktopApi {
  getVersion: () => Promise<string>;
}
```

Wenn wir später einen falschen Methodennamen verwenden oder einen ungeeigneten
Datentyp übergeben, meldet TypeScript den Fehler bereits beim Entwickeln.

## Selbst ausprobieren

1. Ändere den Text in `App.tsx`.
2. Starte die Anwendung mit `npm run dev`.
3. Beobachte, wie Vite die Oberfläche nach einer Änderung aktualisiert.
4. Führe anschließend `npm run typecheck` aus.

## Nächster Lernschritt

Im zweiten Meilenstein definieren wir das unverschlüsselte JSON-Datenmodell im
Arbeitsspeicher. Erst wenn Typen und Validierung stehen, bauen wir die
Verschlüsselung um dieses Modell herum.
