# Härtung – Validierung (bindend)

Urteil: **ready after corrections**. 2 Blocker (beide mit Fix), 6 Korrekturen, 3 Rulings. Dieser Anhang geht Spec `2026-10-25-haertung-design.md` und Plan vor. Was hier nicht geändert wird, gilt aus der Spec **wörtlich** (Rulings 2, Vertrag 3, Zerlegung 4, Doku 5, run-app 6, Nicht-Ziele 7, Tests 10).

Geprüft gegen den Stand `c0fda4d` (Electron 44.4.2, Node 24.21, zod 4.6.5, TypeScript 5.9.3). Ausgangslage: `npm run typecheck` grün, `npx vitest run` 155 Dateien / 2398 Tests grün.

## 1. Vertrag: was bindend ist

- Alle Code-Blöcke aus Spec 3.1 bis 3.9 sind gedanklich gegen den echten Code kompiliert. Bis auf K1 bis K6 unten stimmen sie: Importe (`recentKey`, `isVaultFile`, `decodeImport`, `MAX_IMPORT_BYTES`, `windowRegistry.requireMain`, `vaultSessionManager`, `errorText`, `useNativeSurfaceBlock`, `formatNumber`, `compareText`, `foldCase`), Fehlercodes (`core.importTooLarge`, `core.importUnreadable`, `core.invalidRequest` sind vorhanden), IPC-Muster (`IPC_CHANNELS`-Einträge nach `removeRecentVault` in `src/shared/ipc.ts:104`, `DesktopApi` nach `:286`, Preload mit Literalen wie `src/preload/index.ts:39-40`), `handle(...)` in `vault/ipc.ts` mit `guard` und `toVaultAppError` (AppError geht unverändert durch, `ipc-error.ts:5`).
- `ErrorCode` und `t()` sind aus den de-DE-Katalogen typisiert (`src/shared/errors.ts:3-6`, `src/shared/i18n.d.ts`). Deshalb legt **jeder Task die Keys an, die sein Code benutzt** (Spec 4 bleibt so). Ausnahme ist nur H1/H2 in derselben Welle.
- Die Zeilenanker der Spec stimmen (`index.ts:213`, `:219-220`, `:292`, `:345-358`; `vault/ipc.ts:67`, `:161-164`, `:184`; `recent-vaults.ts:61`; `SettingsDialog.tsx:22`, `:115`, `:121`, `:163`; `App.tsx:85`, `:275-278`, `:831-834`, `:958-960`; `handbuch.md:64`, `:68`, `:72`, `:611`; `manual.md:65`, `:69`, `:600`).
- i18n-Regeln (`i18n-catalog.test.ts` a bis g): Alle neuen Texte der Spec bestehen die Prüfungen. Es gibt keine `...`, kein „Bitte“, kein ` …` in en-US und kein `„` in en-US. In de-DE steht `“` nie nach Leerzeichen. Die Platzhalter sind paritätisch, es gibt keine Plural-Keys, und jeder Key steht als volles Literal im Code. Die JSX-Zeilen der Spec lösen Regel (g) nicht aus (Texte nur in `{t(…)}`).
- Design-Regeln (`design-tokens.test.ts`): Das CSS aus Spec 3.8 nutzt nur vorhandene Tokens (`--space-4/6/8/10/12`, `--radius-md`, `--fs-sm/md`, `--font-mono`, `--control-sm`, `--color-border`, `--color-text`, `--color-text-muted`). R12 greift nicht (`--color-text` ist nicht `--text`). R14 bis R16 greifen nicht. Es gibt keine Bewegung. Mit K3 bleibt das so.

## 2. Blocker

### B1 – Fensterschutz fehlt für Nebenfenster, die während der Sperre entstehen (Sicherheit)
`workspace:open-windows` prüft den Vault einmal und erzeugt dann Fenster in einer Schleife mit `await registry.whenReady(…)` dazwischen (`src/main/window-ipc.ts:206-213`). Sperrt der Nutzer oder die Auto-Sperre während dieser Schleife, entsteht das nächste Nebenfenster **nach** `protectWindows(true)`. Es bleibt ungeschützt, obwohl die Sperre aktiv ist. `protectWindows` erreicht nur Fenster, die beim Sperren schon da sind. Die Annahme „Neue Nebenfenster entstehen gesperrt nicht“ (Spec 0.1) gilt für `tab:transfer` (dort liegt kein `await` zwischen der Prüfung und `createSecondary`), aber **nicht** für diese Schleife.

**Fix (Task D, `src/main/index.ts`), bindend statt des `protectWindows`-Blocks aus Spec 3.7:**
- Modulebene, direkt nach `let lastFocusedId: number | undefined;` (`:60`):
  ```ts
  /** True while the vault is locked: windows created meanwhile start excluded from screen capture too. */
  let captureBlocked = false;
  ```
- In `createWindow`, direkt nach `windowRegistry.register(window, role);` (`:118`):
  ```ts
    if (captureBlocked) window.setContentProtection(true);
  ```
- Direkt nach `announce` (`:348`) statt des Spec-Blocks:
  ```ts
    // While locked, every Shellherd window is left out of screen capture and sharing (Windows: WDA_EXCLUDEFROMCAPTURE).
    const protectWindows = (on: boolean): void => {
      captureBlocked = on;
      for (const target of [windowRegistry.main(), ...windowRegistry.secondaries()]) if (target && !target.isDestroyed()) target.setContentProtection(on);
    };
  ```
- Die Aufrufe in `onSessionChange`, `onLock`, `onUnlock` und `AutoLock.lock` bleiben wörtlich wie in Spec 3.7.

### B2 – CHANGELOG-Überschrift mit Platzhalter bricht `version.test.ts`
Spec 5 schreibt `## [0.24.0] – <Datum des Merges>`. `parseChangelog` erkennt nur `## [x.y.z] – JJJJ-MM-TT` (`src/shared/version.ts:7-18`). Mit dem Platzhalter wäre `releases[0].version` gleich `0.23.0`, und `src/shared/version.test.ts:10-20` schlägt nach Welle 1 fehl.
**Fix (Task E):** Die Überschrift lautet wörtlich `## [0.24.0] – 2026-10-25`, in `CHANGELOG.md` und in `CHANGELOG.en.md`, direkt über `## [0.23.0] – 2026-10-25`, mit Leerzeile davor und danach. Beide Dateien bekommen genau 4 Punkte (Paritätstest `version.test.ts:22-25`). Die Version 0.24.0 steht in `package.json:4` und in `package-lock.json` an **beiden** Root-Stellen (`:3` und `packages[""]` `:9`), sonst nirgends.

## 3. Korrekturen (wörtlicher Ersatz)

### K1 – siehe B1 (Task D).

### K2 – siehe B2 (Task E).

### K3 – `KnownHostsDialog` trägt **nicht** die Klasse `settings-dialog` (H1, H2, I)
Grund: `dialog.settings-dialog[open]` dient in run-app als Kennung der Einstellungen (`screens.mjs:291`, `:300`, `demo-setup.mjs:114-126`). Mit derselben Klasse am Unterdialog wäre die Rücksprungprüfung aus Spec 6.4 Schritt 7 schon erfüllt, während der Unterdialog noch offen ist.
- `KnownHostsDialog.tsx` (H1): Das `className` des `<dialog>` lautet wörtlich `"confirm-dialog known-hosts-dialog"`. Der Rest der Komponente bleibt wie in Spec 3.8.
- `settings-ui.css` (H1): Zeile 2 und 3 ersetzen durch
  ```css
  .settings-dialog, .known-hosts-dialog { width: min(640px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); padding: var(--space-20); border-radius: var(--radius-lg); overflow: auto; }
  .settings-dialog h2, .known-hosts-dialog h2 { margin: 0 0 var(--space-12); font-size: var(--fs-xl); }
  ```
  Dazu die letzte Zeile des Spec-Blocks ersetzen durch
  ```css
  .known-hosts-dialog .form-actions { justify-content: space-between; align-items: center; margin-top: var(--space-16); }
  ```
  Alle übrigen Zeilen des Spec-CSS bleiben wörtlich.
- run-app 6.4 Schritt 7 (Task I), die Wartebedingung wörtlich:
  ```js
  await waitFor('zurück in den Einstellungen', `document.querySelector('dialog.settings-dialog[open]') && !document.querySelector('dialog.known-hosts-dialog[open]') && document.activeElement?.textContent === 'Server-Schlüssel verwalten'`);
  ```

### K4 – Import liest nach dem Dialog nur bei weiter entsperrtem Vault (F)
Der native Dialog kann über eine Sperre hinweg offen bleiben. Danach ginge die Hostliste an einen gesperrten Renderer. In `known-hosts-ipc.ts` folgt direkt nach `if (picked.canceled || !file) return { canceled: true };`:
```ts
    // Locked while the dialog was open: read nothing and send no host names.
    vaultSessionManager.getSnapshot();
```

### K5 – Hostnamen mit Unterstrich (B)
`my_host` ist in OpenSSH erlaubt. Mit der Spec-Regex würde er als „Muster“ übersprungen. In `known-hosts-parse.ts` lautet sie wörtlich:
```ts
const HOST = /^[a-z0-9_.:%-]{1,253}$/;
```
Pflichttest (B, zusätzlich zu 10.1): `parseKnownHosts('my_host ssh-ed25519 <blob>')` ergibt einen Schlüssel `{ kind: 'plain', name: 'my_host', port: 22 }`.

### K6 – Pflichttest auf Handler-Ebene für die Freigabeliste (C)
Der Spion-Test aus 10.3 („weder `stat` noch `readFile`“) prüft nur die reine Funktion. Bindend ist zusätzlich die neue Datei `src/main/vault/ipc.test.ts`. Sie folgt dem Muster aus `src/main/ssh/ipc.test.ts:11-23` und wird wörtlich so übernommen:
```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/ipc';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>(),
  userData: '',
  read: vi.fn(),
  showOpen: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: mocks.showOpen, showSaveDialog: vi.fn() },
  ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => mocks.handlers.set(channel, handler) },
}));
vi.mock('./storage', () => ({ readEncryptedVaultFile: mocks.read, writeEncryptedVaultFile: vi.fn(), backupVaultFile: vi.fn(), saveVault: vi.fn() }));

import { registerVaultIpcHandlers } from './ipc';

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> => mocks.handlers.get(channel)!({} as IpcMainInvokeEvent, ...args);

describe('vault path grants in the IPC handlers', () => {
  beforeAll(() => {
    mocks.userData = mkdtempSync(join(tmpdir(), 'shellherd-vault-ipc-'));
    registerVaultIpcHandlers();
  });
  beforeEach(() => {
    mocks.read.mockReset();
    mocks.read.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  });

  it('refuses network, device and unknown paths before any file access', async () => {
    for (const filePath of ['\\\\srv\\s\\v.term', '//srv/s/v.term', '\\/srv\\s\\v.term', '\\\\?\\UNC\\srv\\s\\v.term', '\\\\.\\pipe\\v.term', 'C:\\never\\granted.term']) {
      await expect(invoke(IPC_CHANNELS.unlockVault, { filePath, password: 'x' })).rejects.toMatchObject({ code: 'core.vaultPathNotAllowed' });
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('grants a dropped local file and opens it in another spelling', async () => {
    await expect(invoke(IPC_CHANNELS.vaultDropFile, '\\\\srv\\s\\v.term')).rejects.toMatchObject({ code: 'core.vaultPathNotAllowed' });
    expect(await invoke(IPC_CHANNELS.vaultDropFile, 'C:/drop/v.term')).toBe('C:\\drop\\v.term');
    await expect(invoke(IPC_CHANNELS.unlockVault, { filePath: 'c:\\DROP\\v.term', password: 'x' })).rejects.toMatchObject({ code: 'core.vaultFileNotFound' });
    expect(mocks.read.mock.calls[0]?.[0]).toBe('c:\\DROP\\v.term');
  });

  it('grants the file picked in the native dialog, also on a share', async () => {
    mocks.showOpen.mockResolvedValue({ canceled: false, filePaths: ['\\\\srv\\share\\picked.term'] });
    expect(await invoke(IPC_CHANNELS.selectVaultFile)).toEqual({ canceled: false, filePath: '\\\\srv\\share\\picked.term' });
    await expect(invoke(IPC_CHANNELS.unlockVault, { filePath: '\\\\srv\\share\\picked.term', password: 'x' })).rejects.toMatchObject({ code: 'core.vaultFileNotFound' });
    expect(mocks.read.mock.calls[0]?.[0]).toBe('\\\\srv\\share\\picked.term');
  });
});
```
Läuft der Test wegen eines anderen Imports von `vault/ipc.ts` nicht, darf der Umsetzer nur weitere `vi.mock`-Zeilen ergänzen. Die drei `it`-Blöcke und ihre Erwartungen bleiben unverändert.

## 4. Rulings

- **V-R1 Kein Umbau von `unlockVault` auf den normalisierten Pfad.** `unlockVault` öffnet weiter den rohen `request.filePath`, geprüft wird `recentKey` (resolve plus Kleinschreibung). Belegt mit Electron 44.4.2 (Node 24.21): `fs.promises.readFile` löst den Pfad vor dem Öffnen selbst auf. `\??\C:\Windows\win.ini` und `\??\UNC\127.0.0.1\C$\…` ergeben `ENOENT`, weil sie als `C:\??\…` aufgelöst werden. `\\?\C:\…` und `\\.\C:\…` öffnen nur, was ihr eigener Schlüssel sagt. Damit gilt: Das geöffnete Ziel entspricht dem geprüften Schlüssel, bis auf Groß- und Kleinschreibung. Wo dieselbe Schreibweise auf zwei verschiedene Dateien zeigen kann (Ordner mit Groß-/Kleinschreibung, Unicode-Faltung), sind beide lokal. Das löst keine NTLM-Anmeldung aus.
- **V-R2 `list()` läuft nicht über die Queue.** Alle Schreiber (`verifyNext`, `importKeys`, `remove`) laufen über `enqueue`, lesen frisch und schreiben `...stored`. Ein Schreibvorgang geht also nie verloren. `list()` liest eine atomar ersetzte Datei, denn libuv öffnet mit `FILE_SHARE_DELETE`, und `rename` scheitert daran nicht. Hingenommen wird: Steht gerade eine Server-Schlüssel-Rückfrage offen, warten `Importieren` und `Entfernen`, bis sie beantwortet ist. Der Dialog zeigt so lange `pending`.
- **V-R3 Die 8 Zeilen Größenprüfung und Lesen in `known-hosts-ipc.ts` bleiben dupliziert** (wie `readText` in `import-source.ts:143-153`). Ein Export aus `import-source.ts` hätte eine weitere Datei in Task F gezogen, ohne dass das Verhalten anders wäre.

## 5. Sicherheitsprüfung (Ergebnis)

| Frage | Ergebnis |
|---|---|
| Normalisierung, Groß-/Kleinschreibung | Der Schlüssel ist `recentKey` (win32.resolve, toLowerCase). Freigaben kommen nur aus vertrauenswürdigen Quellen, der Renderer kann nur genau diese Ziele treffen. Siehe V-R1. |
| `\\?\`, `\\.\`, `\??\` | Drop: Die Regex `^[A-Za-z]:[\\/]` lehnt sie ab. Unlock: Sie gehen nur durch, wenn genau dieser Schlüssel freigegeben ist, und der Dialog liefert solche Pfade nie. `\??\` wird zu `C:\??\…` (V-R1). Test in K6. |
| `//`, `\/` | Beide werden zu `\\srv\…` aufgelöst. Das trifft nur eine UNC-Datei, die der Nutzer selbst im Dialog gewählt hat. `missing()` probt sie nicht mehr (Spec 3.6). Test in K6. |
| 8.3-Kurznamen | Sie ergeben einen anderen Schlüssel und werden abgelehnt (sichere Richtung, Spec Risiko 4). |
| Symlinks, Junctions | Junctions können nicht auf entfernte Ziele zeigen. Ein lokaler Symlink auf UNC muss schon existieren, und ihn anzulegen braucht `SeCreateSymbolicLink` oder den Entwicklermodus. Der Renderer kann keinen anlegen. Restrisiko hingenommen. Task E nimmt es **nicht** ins Handbuch auf, der Orchestrator ergänzt Spec-Risiko 4 im Ledger. |
| Race zwischen Prüfung und Öffnen | Die Freigabeliste wächst nur. Die Prüfung arbeitet nur auf dem String. Zwischen Prüfung und `unlock` liegt nur das Lesen von `settings.json`. Es gibt kein TOCTOU mit Netzwirkung. |
| Alle Aufrufer von `unlockVault` | Renderer: das Formular „Vault öffnen“ (`App.tsx:406`, Pfade aus Dialog, `Zuletzt benutzt`, `lastVaultFile`, Explorer-Start, zweite Instanz, Drop) und der Sperrbildschirm (`:636`, `lockedVault`). Jede Quelle ist durch Spec 3.6, 3.7 und 3.8 abgedeckt. In Main öffnet nur `saveVault` außerdem eine Datei, mit dem Pfad aus dem nativen Speichern-Dialog (`vault/ipc.ts:103-121`). |
| Speicherpfad bei „Speichern unter“ | Neuer Vault: Der Pfad kommt nur aus `showSaveDialog`, der Renderer liefert nur `basename(suggestedName)`. `saveCurrentVault` schreibt nur `session.filePath`. Keiner der beiden nimmt einen Renderer-Pfad an, eine Prüfung ist nicht nötig. |
| HMAC `[host]:port` | Korrekt. Das HMAC-SHA1 nutzt das base64-decodierte Salt als Schlüssel und läuft über `host` (Port 22) oder `[host]:port`, wie OpenSSH `host_hash`/`put_host_port`. `verifyNext` übergibt den kleingeschriebenen Namen, wie OpenSSH. Salt und Hash werden zuerst auf 20 Byte geprüft und dann gepaddet gespeichert (Schema `BASE64_20`). |
| Vorrang revoked > bestätigt > importiert | Lückenlos. `revoked` wird vor `hosts` geprüft. Ein bestätigter Eintrag beendet die Prüfung (Treffer oder `hostKeyChanged`). Importierte Einträge zählen nur ohne bestätigten. Die Rückfrage kommt nur, wenn alles andere fehlt. Ein Import speichert nie Klartext für bestätigte Adressen und nie widerrufene Schlüssel. Die Queue verhindert Änderungen während der Rückfrage. |
| Datei beim parallelen Schreiben / `verifyNext` | Konsistent (V-R2). Die Pflicht aus R3.2 (`...stored`) erfüllt Spec 3.4 in allen drei Schreibern. |
| Fensterschutz: manuell | `onLock` (`vault/ipc.ts:232`) |
| Fensterschutz: automatisch | `AutoLock.lock`, im `finally`, also auch wenn `lock()` wirft |
| Fensterschutz: Nebenfenster während der Sperre | Lücke, Fix B1. `tab:transfer` ist dicht. Die Nebenfenster in `workspace:open-windows` deckt erst B1 ab. |
| Fensterschutz: aufheben | `onUnlock` (auch nach `saveVault`) und `onSessionChange` (Wechsel, Trennen, anderer Vault). Ein falsches Passwort lässt den Schutz an. |

## 6. Endgültige Wellen und Tasks (exklusive Dateien)

Gate nach **jeder** Welle: `npm run typecheck` und `npx vitest run` vollständig grün. Umsetzer schreiben nur ihre Dateien und committen nie. Innerhalb einer Welle darf ein Task den Vertrag eines Nachbarn derselben Welle benutzen.

| Welle | Task | Dateien (exklusiv) | Inhalt | Pflicht-Tests |
|---|---|---|---|---|
| 1 | **A** Vertrag | `src/shared/known-hosts.ts` (neu), `src/shared/known-hosts.test.ts` (neu), `src/shared/ipc.ts`, `src/preload/index.ts` | Spec 3.1, 3.2 | 3.1 (`hostLabel`, 3 Fälle) |
| 1 | **B** Parser | `src/main/ssh/known-hosts-parse.ts` (neu), `src/main/ssh/known-hosts-parse.test.ts` (neu) | Spec 3.3 mit K5 | alle fetten aus 10.1 plus K5 |
| 1 | **C** Vault-Freigabe | `src/main/vault/path-grants.ts` (neu), `src/main/vault/path-grants.test.ts` (neu), `src/main/vault/recent-vaults.ts`, `src/main/vault/recent-vaults.test.ts`, `src/main/vault/ipc.ts`, `src/main/vault/ipc.test.ts` (neu), `src/shared/locales/{de-DE,en-US}/errors/core.json` | Spec 3.6 | 10.3 (Tabelle `droppedVaultPath`, `VaultPathGrants`, `vaultPathAllowed`, `RecentVaults.has`, `missing()`) plus K6 wörtlich |
| 1 | **D** Fensterschutz und Argv-Freigabe | `src/main/index.ts` | Spec 3.7 mit B1 | keine (run-app 6.1/6.2) |
| 1 | **E** Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json` | Spec 5 mit B2 | `version.test.ts` grün |
| 2 | **F** Speicher und IPC | `src/main/ssh/known-hosts.ts`, `src/main/ssh/known-hosts.test.ts`, `src/main/ssh/known-hosts-ipc.ts` (neu), `src/main/index.ts` (nur Import plus `registerKnownHostsIpc(knownHosts);` nach `:292`), `src/shared/locales/{de-DE,en-US}/errors/ssh.json`, `src/shared/locales/{de-DE,en-US}/main.json` | Spec 3.4, 3.5 mit K4 | alle fetten aus 10.2 |
| 2 | **H1** Dialog | `src/renderer/src/known-hosts-view.ts` (neu), `src/renderer/src/known-hosts-view.test.ts` (neu), `src/renderer/src/components/KnownHostsDialog.tsx` (neu), `src/renderer/src/settings-ui.css`, `src/shared/locales/{de-DE,en-US}/app.json` | Spec 3.8 (ohne Settings/App), alle `app.json`-Keys aus 3.9, K3 | 10.4 |
| 2 | **H2** Einbindung | `src/renderer/src/components/SettingsDialog.tsx`, `src/renderer/src/App.tsx`, `src/shared/locales/{de-DE,en-US}/terminal.json` | Spec 3.8 (Settings, App, Drop), `terminal.json` aus 3.9 | keine (run-app 6.3/6.4) |
| 3 | **I** Demo | `.claude/skills/run-app/import-fixtures.mjs`, `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Spec 6.0 bis 6.5 mit K3 (Schritt 7) | `fakes.test.mjs` bleibt grün |

- `src/main/index.ts`: D in Welle 1, F in Welle 2, also nie gleichzeitig.
- Die Texte aus Spec 3.5, 3.6 und 3.9 sind wörtlich zu übernehmen. Nur Spec 5 wird durch B2 geändert, die übrigen Texte nicht. In de-DE und en-US stehen die Keys an derselben Stelle (nach `vaultFileMissing`, `hostKeyRejected`, `importMRemoteNg`).
- Nach Welle 3 erledigt der Orchestrator: run-app nach Spec 6 und `vault-path`/`host-keys`, jeden Screenshot ansehen, M1 von Hand, danach den Handbuchsatz aus Spec 5 Punkt 2 nach dem Ergebnis von M1 anpassen.
